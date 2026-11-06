import Foundation
import FoundationModels
@main struct Cold { static func main() async {
    let t0 = ContinuousClock.now
    let s = LanguageModelSession(model: SystemLanguageModel(useCase: .general, guardrails: .permissiveContentTransformations), instructions: "Reply with the word OK only.")
    do {
        let r = try await s.respond(to: "ping", options: GenerationOptions(temperature: 0.1, maximumResponseTokens: 50))
        let d = (ContinuousClock.now - t0).components
        print("first-call-in-process", r.content, Double(d.seconds)*1000 + Double(d.attoseconds)/1e15, "ms")
    } catch { print("err", error) }
    let t1 = ContinuousClock.now
    let s2 = LanguageModelSession(model: SystemLanguageModel(useCase: .general, guardrails: .permissiveContentTransformations), instructions: "Reply with the word OK only.")
    _ = try? await s2.respond(to: "ping", options: GenerationOptions(temperature: 0.1, maximumResponseTokens: 50))
    let d2 = (ContinuousClock.now - t1).components
    print("second-call", Double(d2.seconds)*1000 + Double(d2.attoseconds)/1e15, "ms")
}}
