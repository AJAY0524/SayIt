# FoundationModels API 事實彙整（Issue #4）

調查日期：2026-11-06。環境：macOS 27.2、Apple Intelligence 已啟用、Swift 6.4.2。

## 來源與標記

- **SDK**：`SDK/System/Library/Frameworks/FoundationModels.framework/Versions/A/Modules/FoundationModels.swiftmodule/arm64e-apple-macos.swiftinterface`（共 3831 行，簡稱 `[SDK:行號]`）。SDK 為 macOS 27.2，可看到 26.0／26.4／27.0 的 `@available` 標註。
- **Apple 文件 JSON**：`https://developer.apple.com/tutorials/data/documentation/foundationmodels/<symbol>.json`（簡稱 `[DOC:symbol]`）。
- **實測探針（probe）**：`/private/tmp/claude-501/fm-api-probe/p.swift`、`q.swift`（簡稱 `[PROBE]`），在本機 macOS 27.2 實際執行。
- 標記「未驗證」＝沒有取得一手來源，不可當事實使用。
- 注意：本機只有 Command Line Tools，沒有 Xcode，找不到 `FoundationModelsMacros` 外掛，**`@Generable`／`@Guide` 巨集無法編譯**；探針改用 `DynamicGenerationSchema` 驗證結構化輸出。

## 1. `SystemLanguageModel.availability`

- 型別 `SystemLanguageModel.Availability`：`.available`、`.unavailable(UnavailableReason)` 兩個 case [SDK:353-357]；另有 `isAvailable: Bool` [SDK:271]。
- `UnavailableReason` 共三種 [SDK:362-370]：
  - `deviceNotEligible`（裝置不支援）
  - `appleIntelligenceNotEnabled`（使用者未開啟 Apple Intelligence）
  - `modelNotReady`（模型資產尚未就緒，如下載中）
- 三個值與 Apple 文件頁的列舉一致 [DOC:systemlanguagemodel/availability-swift.enum/unavailablereason]。各 case 的官方文字說明（例如 `modelNotReady` 是否只代表下載中）文件 JSON 抽不到描述，**括號中的語意為依命名推斷，未驗證**。
- 本機實測：`availability: available`、`isAvailable: true` [PROBE p]。三種 unavailable 狀態在本機無法重現，**未實測**。
- macOS 27 另有 `PrivateCloudComputeLanguageModel`（雲端模型），其 `UnavailableReason` 為 `deviceNotEligible`、`systemNotReady`，並有 `quotaUsage` [SDK:46-90, 213]；SayIt 若只用裝置端模型可不處理。

## 2. Context window、溢位錯誤、token 計數

- `SystemLanguageModel.contextSize: Int` 自 macOS 26.0 引入，26.4 之前以 back-deploy 實作並**回傳固定 4096**；macOS 27 起回傳 `_contextSize`（實際值）[SDK:438-466]。
- 官方文件：context size 是單一 session 內「輸入 prompt 與產生回應合計」可用的 token 總數 [DOC:systemlanguagemodel/contextsize]。
- **本機實測 `contextSize = 8192`**（macOS 27.2，`variant` 為 "AFM 3 Core Advanced"）[PROBE p]。結論：macOS 26.x 為 4096（來自 SDK back-deploy 程式碼）、macOS 27 為 8192（僅本機一台實測，其他機型／variant 未驗證；`SystemLanguageModel.Variant` 有 `core3`、`coreAdvanced3` 兩種 [SDK:470-500]，不同 variant 的 contextSize 是否不同未驗證）。
- 溢位錯誤：
  - macOS 27+：`LanguageModelError.contextSizeExceeded(ContextSizeExceeded)`，內含 `contextSize`、`tokenCount` [SDK:1555-1597]。實測訊息：`Content contains 102948 tokens, which exceeds the maximum allowed context size of 8192.`，且 `contextSize=8192`、`tokenCount=102948` 可從 payload 取得 [PROBE q]。
  - 舊版 `LanguageModelSession.GenerationError.exceededContextWindowSize` 在 27.0 起標示 deprecated，改用上者 [SDK:3719-3722]。
  - 只有輸出被 `maximumResponseTokens` 截斷時**不拋錯**，直接提早結束 [DOC:generationoptions/maximumresponsetokens]。
- **token 計數 API 有**（macOS／iOS 26.4+）：`SystemLanguageModel.tokenCount(for:)`，重載支援 prompt、`Instructions`、`[Tool]`、`GenerationSchema`、`Transcript.Entry` 集合，皆為 `async throws -> Int` [SDK:405-436]。
  - 實測：`"你好，這是一段測試文字。"`（12 字）= 9 tokens；一句約 20 字的繁中 instructions = 62 tokens（含框架 overhead）；三欄位 schema = 105 tokens [PROBE p]。
  - 中文 token 密度：實測約 0.5～1 token／字（短句），大量重複紀錄文字 `big` 約 102,891 tokens／約 12 萬字，約 0.85 token／字（粗估，僅供參考）。

## 3. 回應的 token 用量

- macOS 27.0+：`LanguageModelSession.Response<Content>.usage: Usage` [SDK:2046]；串流 `Snapshot.usage` [SDK:2271]；session 也有 `usage` 屬性 [SDK:2010]（累計語意未驗證）。
- `Usage` 結構 [SDK:2057-2090]：`input.totalTokenCount`、`input.cachedTokenCount`、`output.totalTokenCount`、`output.reasoningTokenCount`、`totalTokenCount`、`metadata`。型別皆為非可選 `Int`。
- 實測 [PROBE p]：純文字回應 `input=101, output=27`；結構化回應 `input=178, output=25`；`cachedTokenCount=0`、`reasoningTokenCount=0`。
- macOS 26.x 的 `Response` **沒有 `usage`**（`@available(macOS 27.0)`），但可用 `tokenCount(for:)`（26.4+）自行估算輸入端；輸出端無 API，只能對輸出文字再呼叫 `tokenCount(for:)`。

## 4. 語言支援與繁／簡

- `supportedLanguages: Set<Locale.Language>` 與 `supportsLocale(_:) -> Bool`（同步，26.0+）[SDK:398-402]。
- **本機實測支援清單**（24 項）：da、de、en-AU／GB／IN／US、es-419／US／ES、fr、fr-CA、it、ja、ko、nb、nl、pt、pt-PT、sv、tr、vi，以及中文三項：`zh-TW`（Hant／TW）、`zh-HK`（Hant／HK）、`zh`（Hans／CN）[PROBE p]。`supportsLocale` 對 `zh-Hant-TW`、`zh-TW`、`zh-HK`、`zh-Hans-CN` 皆回 true。結論：**zh-Hant（台灣、香港）在清單內**。
- 不支援語言的錯誤：`LanguageModelError.unsupportedLanguageOrLocale`（含 `languageCode`）[SDK:1689-1692]。
- 簡體偏向：兩組同一句繁中口語稿，instructions 「不指定字體」與「一律使用繁體中文（台灣）」，輸出都是繁體（「資料庫」「記憶體」「伺服器」）[PROBE q]。只有 1 句樣本，**不足以斷言不會偏簡體**；建議 system prompt 仍明寫繁體台灣用語，並在後續票以更多樣本評測。（Apple 文件頁 metadata 的 `availableLanguages` 只列 `zh-CN` 一種中文，與 SDK 實測清單的 zh-TW／zh-HK 不同，以 SDK 與實測為準。）

## 5. Guardrail

- 型別：macOS 27+ 為 `LanguageModelError.guardrailViolation(GuardrailViolation)`（僅 `debugDescription`、`metadata`）[SDK:1558, 1612-1624]；舊版 `GenerationError.guardrailViolation` 於 27.0 deprecated [SDK:3727-3730]。另有 `refusal`（模型拒答，含 `explanation`）[SDK:1559, 1625-1637]。`LanguageModelError` 為 `@nonexhaustive`，switch 需有 default [SDK:1555]。
- 可調整性：只有兩組 `SystemLanguageModel.Guardrails`：`.default` 與 `.permissiveContentTransformations`，在 `SystemLanguageModel(useCase:guardrails:)` 指定 [SDK:336-345, 392-394]。permissive 模式下，**產生 `String` 的請求不再拋 `guardrailViolation`**，但模型仍可能以文字拒答；產生非 `String`（結構化）型別時行為與 default 相同，仍會拋錯 [DOC:systemlanguagemodel/guardrails/permissivecontenttransformations]。無法完全關閉。
- 實測觸發：把「這是很長的文字。」重複 6000 次當輸入，拋 `LanguageModelError`，訊息 `May contain unsafe content`（歸類為 guardrail 一類，但具體 case 未逐一印出，**case 名稱未確認**）[PROBE q]。表示輸入內容異常（重複／類亂碼）也可能誤觸，而非只有敏感內容。
- 語音轉文字場景含髒話、醫療、法律等口語內容，建議用 `.permissiveContentTransformations`（文字轉文字）。

## 6. `GenerationOptions`

- 欄位 [SDK:3373-3430]：`temperature: Double?`、`maximumResponseTokens: Int?`、`samplingMode: SamplingMode?`（`.greedy`、`.random(top:seed:)`、`.random(probabilityThreshold:seed:)`）[SDK:3436-3450]、macOS 27 新增 `toolCallingMode`（`allowed`／`required`／`disallowed`）[SDK:3466-3471]。舊欄位 `sampling` 已改名 `samplingMode`（deprecated）。
- macOS 27 另有 `ContextOptions(includeSchemaInPrompt:reasoningLevel:)`，`reasoningLevel` 為 `light`／`moderate`／`deep`／`custom` [SDK:3306-3318]，用在新版 `respond(... contextOptions:)` 重載。
- 實測 `GenerationOptions(temperature: 0, maximumResponseTokens: 200)` 可正常使用 [PROBE p]。

## 7. Guided generation（結構化輸出）

- `@Generable`／`@Guide` 巨集 [SDK:1134-1149]，`Generable` 協定要求 `generationSchema` [SDK:1152]；`respond(to:generating:)` 回傳型別化結果；也可用 `respond(to:schema:)` 傳 `GenerationSchema` 取得 `GeneratedContent`，其 `jsonString` 為 JSON [SDK:1356-1358, 2175-2183]。`DynamicGenerationSchema` 可在執行期定義 schema（欄位、`anyOf` 列舉、陣列）[SDK:3324-3345]。
- 實測（用 `DynamicGenerationSchema`，欄位 `isCorrection: Bool`、`from`、`to`）：輸入「不對，應該是『台積電』不是『台機電』」→ `{"isCorrection": true, "to": "台積電", "from": "台機電"}`，usage input=178／output=25 [PROBE p]。結論：**可穩定產生可解析 JSON，欄位順序不固定**。僅 1 筆樣本，正確率未評測。
- `@Generable` 巨集本機無法編譯（缺 `FoundationModelsMacros`，需 Xcode），**巨集路徑未實測**。若 SayIt 的 Swift bridge 用 `swiftc`／Cargo 建置，需確認 CI 是否有 Xcode；否則用 `DynamicGenerationSchema` 即可繞過。
- `schema` 本身佔 context（本例 105 tokens）；`includeSchemaInPrompt` 可控制是否塞進 prompt [SDK:2175]。結構化輸出下 guardrail 無 permissive 緩解（見第 5 節）。

## 8. 最低系統版本與 macOS 26／27 差異

| 項目 | macOS 26.0 | 26.4 | 27.0 |
|---|---|---|---|
| `SystemLanguageModel`、`availability`、`supportedLanguages`、`GenerationOptions`、`@Generable` | 有 | 有 | 有 |
| `contextSize` | 有（固定 4096） | 有（back-deploy 寫法，值待驗證） | 有（實測 8192） |
| `tokenCount(for:)` | 無 | **有** | 有 |
| `Response.usage` | 無 | 無 | **有** |
| `LanguageModelError`（含 `contextSizeExceeded`、`guardrailViolation`、`rateLimited`、`timeout`） | 無（用 `GenerationError`） | 無 | **有**，舊錯誤 deprecated |
| `SystemLanguageModel.Error.assetsUnavailable` | 無 | 無 | 有 [SDK:612-640] |
| `SystemLanguageModel.variant`、`PrivateCloudComputeLanguageModel`、`toolCallingMode` | 無 | 無 | 有 |
| `Adapter` 初始化 | 有 | deprecated | obsoleted [SDK:392-398, 503] |

- 最低系統版本：**macOS 26.0**（`SystemLanguageModel` 標註 `macOS 26.0`）[SDK:260-262]。`tokenCount` 的 26.4 門檻、`Response.usage` 的 27.0 門檻皆見上表引用行。
- 26.0～26.3 之間 `contextSize` 行為（固定 4096）來自 back-deploy 程式碼，非實機驗證。

## 對 SayIt 的影響

1. **狀態列原因文案**：就緒狀態直接對應三種原因：`deviceNotEligible`（硬體不支援，永久）、`appleIntelligenceNotEnabled`（引導使用者到系統設定開啟）、`modelNotReady`（顯示「模型準備中」並輪詢重試；是否一定為下載中未驗證，文案寫「尚未就緒」較安全）。另要處理 macOS 27 的 `SystemLanguageModel.Error.assetsUnavailable`。`availability` 是 `Observable`，可訂閱變化 [SDK:291]。
2. **Context 預算**：macOS 27 實測 8192、macOS 26.x 為 4096（程式碼推得）。1.5～2K tokens 的 system prompt（以繁中約 0.6～1 token／字估，需用 `tokenCount(for: Instructions)` 實測）加 50 個詞彙（約 150～400 tokens）在 8192 尚寬裕；在 4096 則只剩約 1.5～2K 給「輸入逐字稿＋輸出」，長口述需切段或縮減 prompt。實作時應每次啟動以 `contextSize` 動態取值，並在送出前用 `tokenCount` 檢查，超過則截斷詞彙表。schema 也會佔 token（本例 105）。
3. **溢位處理**：macOS 27 抓 `LanguageModelError.contextSizeExceeded`，payload 有 `contextSize`／`tokenCount` 可直接算超出多少；macOS 26 需抓舊 `GenerationError.exceededContextWindowSize`（兩套錯誤型別都要接）。
4. **用量統計**：macOS 27 有精確 `usage.input/output.totalTokenCount`；macOS 26.x 沒有，統計欄位需允許 `null`（或在 26.4+ 用 `tokenCount(for:)` 估算，26.0～26.3 則無）。`cachedTokenCount`、`reasoningTokenCount` 目前實測皆為 0，可選擇性記錄。
5. **修正偵測 JSON**：用 guided generation 可得合法 JSON，不必自己解析自由文字。建議用 `DynamicGenerationSchema` 或在有 Xcode 的環境用 `@Generable`；先用本機單筆實測驗證可行，準確率與誤判率需另票用多筆樣本評測。
6. **繁體輸出**：語言清單含 zh-TW／zh-HK；system prompt 仍應明示「繁體中文（台灣用語）」。簡體偏向目前僅 1 句樣本，不能當結論。
7. **Guardrail**：文字潤飾請用 `.permissiveContentTransformations`；但結構化（JSON）請求仍受 default guardrail 約束，修正偵測失敗時需降級（回傳原文、不阻塞貼上）。重複／異常輸入也可能誤觸 guardrail，需 catch 後回退。
8. **未驗證清單**：三種 unavailable 的實機重現與官方語意、macOS 26.x 實機 contextSize、不同 variant 的 contextSize、`@Generable` 巨集路徑、guardrail 實測錯誤 case 名稱、繁簡偏向的統計結論。
