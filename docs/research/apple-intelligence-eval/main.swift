import Foundation
import FoundationModels

// Usage: fmeval <cases.json> <out.jsonl> [idPrefix,idPrefix...]
func ms(_ d: Duration) -> Double {
    let c = d.components
    return Double(c.seconds) * 1000 + Double(c.attoseconds) / 1e15
}

func classify(_ error: Error) -> (kind: String, detail: String, extra: [String: Any]) {
    var extra: [String: Any] = [:]
    var kind = "other"
    if let e = error as? LanguageModelError {
        switch e {
        case .contextSizeExceeded(let c):
            kind = "contextSizeExceeded"; extra["contextSize"] = c.contextSize; extra["tokenCount"] = c.tokenCount
        case .guardrailViolation: kind = "guardrailViolation"
        case .refusal(let r): kind = "refusal"; extra["explanation"] = String(describing: r)
        case .rateLimited: kind = "rateLimited"
        default: kind = "LanguageModelError.other"
        }
    }
    return (kind, "\(error)", extra)
}

@main struct Eval {
    static func main() async {
        let args = CommandLine.arguments
        guard args.count >= 3 else { print("usage: fmeval cases.json out.jsonl [filter]"); return }
        let data = try! Data(contentsOf: URL(fileURLWithPath: args[1]))
        let cases = try! JSONSerialization.jsonObject(with: data) as! [[String: Any]]
        let filters = args.count > 3 ? args[3].split(separator: ",").map(String.init) : []
        FileManager.default.createFile(atPath: args[2], contents: nil)
        let out = FileHandle(forWritingAtPath: args[2])!
        try? out.seekToEnd()

        let base = SystemLanguageModel.default
        print("availability:", base.availability, "contextSize:", base.contextSize, "variant:", base.variant.displayName)

        let permissive = SystemLanguageModel(useCase: .general, guardrails: .permissiveContentTransformations)
        let strict = SystemLanguageModel(useCase: .general, guardrails: .default)

        let termSchema = DynamicGenerationSchema(name: "Terms", description: "語音辨識寫錯、使用者改正的專有名詞或技術術語", properties: [
            .init(name: "terms", description: "符合條件的詞彙陣列，沒有則為空陣列", schema: DynamicGenerationSchema(arrayOf: DynamicGenerationSchema(type: String.self)))
        ])
        let schema = try! GenerationSchema(root: termSchema, dependencies: [])
        let textSchemaDyn = DynamicGenerationSchema(name: "Proofread", description: "校對後的逐字稿", properties: [
            .init(name: "text", description: "校對後的逐字稿全文，只含校對結果，不含說明", schema: DynamicGenerationSchema(type: String.self))
        ])
        let textSchema = try! GenerationSchema(root: textSchemaDyn, dependencies: [])

        for c in cases {
            let id = c["id"] as! String
            if !filters.isEmpty && !filters.contains(where: { id.hasPrefix($0) }) { continue }
            let instr = c["instructions"] as! String
            let prompt = c["prompt"] as! String
            let kind = c["kind"] as! String
            let temp = (c["temperature"] as? Double) ?? 0.1
            let maxTok = c["maxTokens"] as? Int
            let runs = c["runs"] as! Int
            let model = (c["guardrails"] as! String) == "default" ? strict : permissive

            // token counts (static part, once per case)
            var instrTok = -1, promptTok = -1, schemaTok = -1
            instrTok = (try? await model.tokenCount(for: Instructions(instr))) ?? -1
            promptTok = (try? await model.tokenCount(for: prompt)) ?? -1
            if kind == "json-schema" { schemaTok = (try? await model.tokenCount(for: schema)) ?? -1 }
            if kind == "json-text-schema" { schemaTok = (try? await model.tokenCount(for: textSchema)) ?? -1 }

            for run in 1...runs {
                var rec: [String: Any] = ["id": id, "run": run, "usePoint": c["usePoint"] as Any, "tid": c["tid"] as Any,
                    "kind": kind, "guardrails": c["guardrails"] as Any, "promptMode": c["promptMode"] as Any,
                    "instrTokens": instrTok, "promptTokens": promptTok, "schemaTokens": schemaTok]
                let session = LanguageModelSession(model: model, instructions: instr)
                var opts = GenerationOptions(temperature: temp)
                if let m = maxTok { opts = GenerationOptions(temperature: temp, maximumResponseTokens: m) }
                let t0 = ContinuousClock.now
                do {
                    var text = ""
                    if kind == "json-text-schema" {
                        let r = try await session.respond(to: prompt, schema: textSchema, options: opts)
                        text = r.content.jsonString
                        rec["usageIn"] = r.usage.input.totalTokenCount; rec["usageOut"] = r.usage.output.totalTokenCount
                    } else if kind == "json-schema" {
                        let r = try await session.respond(to: prompt, schema: schema, options: opts)
                        text = r.content.jsonString
                        rec["usageIn"] = r.usage.input.totalTokenCount; rec["usageOut"] = r.usage.output.totalTokenCount
                    } else {
                        let r = try await session.respond(to: prompt, options: opts)
                        text = r.content
                        rec["usageIn"] = r.usage.input.totalTokenCount; rec["usageOut"] = r.usage.output.totalTokenCount
                    }
                    rec["latencyMs"] = ms(ContinuousClock.now - t0)
                    rec["ok"] = true
                    rec["output"] = text
                    rec["outputTokensSelf"] = (try? await model.tokenCount(for: text)) ?? -1
                } catch {
                    rec["latencyMs"] = ms(ContinuousClock.now - t0)
                    rec["ok"] = false
                    let k = classify(error)
                    rec["errorKind"] = k.kind; rec["error"] = k.detail
                    for (a, b) in k.extra { rec[a] = b }
                }
                let line = try! JSONSerialization.data(withJSONObject: rec, options: [.withoutEscapingSlashes])
                out.write(line); out.write("\n".data(using: .utf8)!)
                let lat = String(format: "%.0f", rec["latencyMs"] as! Double)
                print(id, "run", run, rec["ok"] as! Bool ? "ok" : "ERR \(rec["errorKind"] ?? "")", "\(lat)ms", "in=\(rec["usageIn"] ?? "-") out=\(rec["usageOut"] ?? "-")")
            }
        }
    }
}
