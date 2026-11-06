import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// ---------------------------------------------------------------------------
// C ABI (all `public @_cdecl`, see swift-rs 1.0.9 / Xcode 27 note)
//   sayit_fm_availability() -> Int32
//   sayit_fm_build_info()   -> const char*   (static string)
//   sayit_fm_generate(request_json, ctx, cb) -> Int64 (handle, > 0)
//   sayit_fm_cancel(handle)
// Callback contract: invoked EXACTLY ONCE per generate call, on an arbitrary
// thread. kind: 0 = ok, 1 = error, 2 = cancelled. payload is a JSON C string
// valid only during the callback.
// ---------------------------------------------------------------------------

public typealias SayItCallback = @convention(c) (UnsafeMutableRawPointer?, Int32, UnsafePointer<CChar>?) -> Void

private let registryLock = NSLock()
nonisolated(unsafe) private var registry: [Int64: Task<Void, Never>] = [:]
nonisolated(unsafe) private var nextHandle: Int64 = 1

// MARK: - SDK-conditional compilation
// The macOS 27 SDK ships FoundationModels module version 2.x, the 26.5 SDK 1.5.x.
#if canImport(FoundationModels, _version: 2.0)
private let sdkHasMacOS27API = true
#else
private let sdkHasMacOS27API = false
#endif

private let buildInfoString: StaticString = {
    #if canImport(FoundationModels, _version: 2.0)
    return "fm=sdk27"
    #elseif canImport(FoundationModels)
    return "fm=sdk26"
    #else
    return "fm=none"
    #endif
}()

@_cdecl("sayit_fm_build_info")
public func sayit_fm_build_info() -> UnsafePointer<CChar> {
    return UnsafeRawPointer(buildInfoString.utf8Start).assumingMemoryBound(to: CChar.self)
}

/// 1 available | 2 deviceNotEligible | 3 appleIntelligenceNotEnabled | 4 modelNotReady
/// 0 unavailable(unknown reason) | -1 OS older than 26 | -2 SDK without FoundationModels
@_cdecl("sayit_fm_availability")
public func sayit_fm_availability() -> Int32 {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available: return 1
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible: return 2
            case .appleIntelligenceNotEnabled: return 3
            case .modelNotReady: return 4
            @unknown default: return 0
            }
        @unknown default: return 0
        }
    }
    return -1
    #else
    return -2
    #endif
}

private func jsonString(_ obj: [String: Any]) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
          let s = String(data: d, encoding: .utf8) else { return "{\"code\":\"internal\"}" }
    return s
}

private func emit(_ cb: SayItCallback, _ ctx: UnsafeMutableRawPointer?, _ kind: Int32, _ obj: [String: Any]) {
    jsonString(obj).withCString { cb(ctx, kind, $0) }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
private func classify(_ error: Error) -> [String: Any] {
    var out: [String: Any] = ["type": String(reflecting: type(of: error)), "message": "\(error)"]
    #if canImport(FoundationModels, _version: 2.0)
    if #available(macOS 27.0, *), let e = error as? LanguageModelError {
        if case .contextSizeExceeded(let d) = e {
            out["code"] = "context_size_exceeded"
            out["context_size"] = d.contextSize
            out["token_count"] = d.tokenCount
            return out
        }
        if case .guardrailViolation = e { out["code"] = "guardrail"; return out }
        if case .unsupportedLanguageOrLocale = e { out["code"] = "unsupported_language"; return out }
    }
    #endif
    if let e = error as? LanguageModelSession.GenerationError {
        switch e {
        case .exceededContextWindowSize: out["code"] = "context_size_exceeded"
        case .guardrailViolation: out["code"] = "guardrail"
        case .unsupportedLanguageOrLocale: out["code"] = "unsupported_language"
        case .assetsUnavailable: out["code"] = "model_not_ready"
        case .rateLimited: out["code"] = "rate_limited"
        case .concurrentRequests: out["code"] = "busy"
        case .refusal: out["code"] = "refusal"
        default: out["code"] = "unknown_generation_error"
        }
        return out
    }
    out["code"] = "unknown"
    return out
}
#endif

// Sync helper: NSLock.lock() is unavailable from async contexts in Swift 6 mode.
private func forget(_ handle: Int64) {
    registryLock.lock()
    registry[handle] = nil
    registryLock.unlock()
}

@_cdecl("sayit_fm_generate")
public func sayit_fm_generate(_ requestJson: UnsafePointer<CChar>, _ ctx: UnsafeMutableRawPointer?, _ cb: SayItCallback) -> Int64 {
    let reqData = Data(String(cString: requestJson).utf8)
    let req = (try? JSONSerialization.jsonObject(with: reqData)) as? [String: Any] ?? [:]
    let ctxBits = UInt(bitPattern: ctx)

    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        guard let prompt = req["prompt"] as? String else {
            emit(cb, ctx, 1, ["code": "bad_request", "message": "prompt missing"])
            return -1
        }
        let instructions = req["instructions"] as? String
        let temperature = req["temperature"] as? Double
        let maxTokens = req["max_tokens"] as? Int

        registryLock.lock()
        let handle = nextHandle; nextHandle += 1
        let task = Task.detached { () -> Void in
            let c = UnsafeMutableRawPointer(bitPattern: ctxBits)
            do {
                let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)
                let session = LanguageModelSession(model: model, instructions: instructions)
                var opts = GenerationOptions()
                if let t = temperature { opts.temperature = t }
                if let m = maxTokens { opts.maximumResponseTokens = m }
                let r = try await session.respond(to: prompt, options: opts)
                try Task.checkCancellation()
                var out: [String: Any] = ["text": r.content]
                #if canImport(FoundationModels, _version: 2.0)
                if #available(macOS 27.0, *) {
                    out["input_tokens"] = r.usage.input.totalTokenCount
                    out["output_tokens"] = r.usage.output.totalTokenCount
                }
                #endif
                if out["input_tokens"] == nil { out["input_tokens"] = NSNull(); out["output_tokens"] = NSNull() }
                forget(handle)
                emit(cb, c, 0, out)
            } catch is CancellationError {
                forget(handle)
                emit(cb, c, 2, ["code": "cancelled"])
            } catch {
                forget(handle)
                emit(cb, c, 1, classify(error))
            }
        }
        registry[handle] = task
        registryLock.unlock()
        return handle
    }
    emit(cb, ctx, 1, ["code": "os_too_old", "message": "macOS 26 required"])
    return -1
    #else
    emit(cb, ctx, 1, ["code": "sdk_without_foundation_models", "message": "built without FoundationModels"])
    return -1
    #endif
}

@_cdecl("sayit_fm_cancel")
public func sayit_fm_cancel(_ handle: Int64) {
    registryLock.lock()
    let t = registry[handle]
    registryLock.unlock()
    t?.cancel()
}
