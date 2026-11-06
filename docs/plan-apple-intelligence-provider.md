# 計畫：LLM 模型服務新增 Apple Intelligence（裝置上）

> 建立：2026-11-06 · 狀態：**規格定稿，待拆票實作**（AJ 授權代決） · 地圖：AJAY0524/SayIt#2 · 規格票：#13（見文末「實作票」）
> 單一來源（數字與理由都在這些檔，本檔只引用不重抄理由）：
> - 橋接：`docs/adr-apple-intelligence-swift-bridge.md`（下稱「ADR」，含文末「後續修訂」）
> - context 預算與各使用點降級：`docs/research/apple-intelligence-decisions.md`（下稱「決策檔」；與 ADR 衝突時以決策檔與 ADR「後續修訂」為準）
> - API 事實：`docs/research/foundation-models-api.md`；品質實測：`docs/research/apple-intelligence-eval.md`
> - 拍板 demo（規格的一部分，**與文字衝突時以 demo 為準**）：`docs/demos/apple-intelligence-settings/index.html`＋`README.md`

## 要解決什麼

「LLM 模型服務」目前只有 4 家雲端服務，全走前端 `fetch`。新增「Apple Intelligence（裝置上）」：macOS 上用系統內建的 FoundationModels 在本機整理文字，**資料不會離開您的 Mac**。SayIt 的 5 個使用點都要能用；撐不住的使用點依決策檔降級並在 UI 註明。

## 範圍

- Rust↔Swift 橋接、三個 Tauri command、`build.rs` 的 macOS Swift 建置、最低 macOS 13.0。
- 前端：新 provider `apple`、「LLM 就緒」閘門取代 API key 閘門、Apple 轉接層（invoke＋取消＋逾時）、5 個使用點的降級、用量統計 $0／token null。
- 設定頁 Apple Intelligence 卡片、就緒狀態列、降級提示；五語系文案。
- 測試、CI、發版文件。

## 不做

- 串流輸出（ADR D5：v1 不串流）、guided generation／`schema`（ADR 後續修訂 4）、切段整理（決策檔 #8 第 3 點）。
- Apple 專用精簡提示詞、動態刪減詞彙表（決策檔 #8 第 5、6 點）。
- 失敗時改走雲端 provider（地圖 Notes 定案，**絕不**）。
- Windows 支援；裝置上 STT；本機 LLM（llama.cpp 等）；改寫結果「一鍵還原」（決策檔 ②）。

## 1. 橋接（照 ADR，不重述）

- Swift 套件 `src-tauri/swift/SayItFM/`、`build.rs` 自寫 `swift build`（不用 swift-rs、不動 `Cargo.lock`）、Rust 模組 `src-tauri/src/plugins/apple_intelligence.rs`（非 macOS 為 stub）。見 ADR D1～D3、D7。
- 三個 command（ADR D5 表格）：`apple_intelligence_availability`、`apple_intelligence_generate`、`apple_intelligence_cancel`。不新增 event。
- 依 ADR「後續修訂」：Rust 逾時 **120 s**；`generate` 內做 context 預檢與 `maxTokens` 夾限；錯誤 payload 前端一律看 camelCase；v1 不帶 `schema`；`reason` 新增 `intel_mac`。
- 前端看到的型別（`src/types/appleIntelligence.ts`，命名照 CLAUDE.md 型別慣例）：

```ts
type AppleIntelligenceUnavailableReason =
  | "unsupported_platform" | "intel_mac" | "os_too_old"
  | "device_not_eligible" | "apple_intelligence_not_enabled"
  | "model_not_ready" | "unknown";
type AppleIntelligenceAvailability =
  | { state: "available" }
  | { state: "unavailable"; reason: AppleIntelligenceUnavailableReason };
interface AppleIntelligenceGenerateResult { text: string; inputTokens: number | null; outputTokens: number | null }
interface AppleIntelligenceErrorPayload {
  code: "cancelled" | "context_size_exceeded" | "guardrail" | "unsupported_language" | "model_not_ready"
      | "rate_limited" | "busy" | "refusal" | "os_too_old" | "sdk_without_foundation_models"
      | "bad_request" | "timeout" | "unknown";
  message: string;
  preflight?: boolean; estimatedTokens?: number; contextSize?: number; tokenCount?: number;
  method?: "token_count" | "char_estimate";
}
```

（`timeout` 是 Rust 120 s 安全網到期時回的碼，ADR 原清單沒有，本規格補上。）

## 2. 就緒狀態模型

就緒狀態＝目前選中的 LLM 模型服務「現在能不能被呼叫」。雲端服務看 API key；Apple Intelligence 看系統可用性。

```ts
type LlmReadiness =
  | { ready: true }
  | { ready: false; reason: "missing_api_key" }
  | { ready: false; reason: AppleIntelligenceUnavailableReason };
```

Apple Intelligence 的判斷順序（全在 Rust `availability` 內，前端不自行判斷平台以外的條件）：

| 順序 | 條件 | `reason` | demo 狀態 | 偵測方式 |
|---|---|---|---|---|
| 1 | 非 macOS | `unsupported_platform` | （Windows 不顯示卡片） | Rust `cfg` stub |
| 2 | 實體硬體為 Intel | `intel_mac` | Intel Mac | `sysctl hw.optional.arm64` 不存在或為 0。**不能看執行檔架構**：x64 版在 Apple 晶片上走 Rosetta 時 `availability` 實測為可用（ADR 探針） |
| 3 | macOS < 26.0 | `os_too_old` | macOS 太舊 | Swift `if #available(macOS 26.0, *)` 不成立 |
| 4 | FoundationModels 回報不可用 | `device_not_eligible`／`apple_intelligence_not_enabled`／`model_not_ready` | 對應三種 | `SystemLanguageModel.default.availability`；macOS 27 的 `assetsUnavailable` → `model_not_ready` |
| 5 | 其他（含 `sdk_without_foundation_models` 建置） | `unknown` | 新增「無法判斷」狀態（demo 無，文案見 §7） | — |

**何時讀**：HUD（`index.html`）與 Dashboard（`main-window.html`）是兩個 webview、各有一份 Pinia，所以**不靠跨視窗快取**。每個呼叫點在呼叫前執行 `await settingsStore.refreshLlmReadiness()`（取代現行 `refreshLlmApiKey()`）：雲端服務照舊重讀 store 內的 key；Apple 呼叫一次 `apple_intelligence_availability`（同步讀屬性，預期毫秒級，**未實測**；若實測 > 50 ms 再改成 5 秒快取）。設定頁進入時與按「重新檢查」時也讀一次。

## 3. API key 閘門 → 「LLM 就緒」閘門

`useSettingsStore` 介面變更：

| 現在 | 改成 | 說明 |
|---|---|---|
| `hasLlmApiKey`（computed） | `isLlmReady`（computed，讀最近一次 `llmReadiness`） | 雲端：有 key；Apple：最近一次 availability 為 `available` |
| `getLlmApiKey(): string` | `getLlmCredential(): LlmCredential` | `type LlmCredential = { providerId: "apple" } \| { providerId: CloudLlmProviderId; apiKey: string }` |
| `refreshLlmApiKey()` | `refreshLlmReadiness(): Promise<LlmReadiness>` | 見 §2 |
| — | `llmReadiness`（ref）、`refreshAppleIntelligenceAvailability()` | 設定頁狀態列用 |

`getLlmApiKey()` 保留給只關心雲端 key 的設定頁欄位；**所有 LLM 呼叫點一律改用 `getLlmCredential()`**。`hasLlmApiKey` 的 `satisfies never` 窮舉檢查要保留在新函式中。

必改的呼叫點（2026-11-06 grep `getLlmApiKey|hasLlmApiKey|refreshLlmApiKey`＋讀碼）：

| 檔案:行 | 使用點 | 現況 | 改法 |
|---|---|---|---|
| `src/stores/useVoiceFlowStore.ts:1403-1405` | ① 錄音後整理 | `refreshLlmApiKey` → `if (!llmApiKey)` 跳過整理 | `refreshLlmReadiness()`，未就緒走既有「未整理直接貼上」分支 |
| `src/stores/useVoiceFlowStore.ts:1422`、`:1442` | ① 異常重試 | 傳 `llmApiKey` | 傳 `LlmCredential`；Apple 不重試（§5） |
| `src/stores/useVoiceFlowStore.ts:1602-1614` | ② 選取文字改寫 | 同上 | 同上；未就緒走既有 `editFailed` |
| `src/stores/useVoiceFlowStore.ts:1759-1767` | ① HUD 重送後整理 | 同上 | 同上 |
| `src/stores/useVoiceFlowStore.ts:838-840` | ④ 智慧字典學習 | `getLlmApiKey()` 有值才啟動 | 用同一流程中最近一次 `llmReadiness`（① 已刷新過），就緒才啟動 |
| `src/stores/useHistoryStore.ts:851-864` | ③ 歷史重新整理 | `refreshLlmApiKey` → `if (!llmApiKey)` | `refreshLlmReadiness()` |
| `src/views/SettingsView.vue:1571-1572` | ⑤ 連線測試 | `testLlmConnection(modelId, getLlmApiKey())`、`:disabled="!hasLlmApiKey"` | 傳 `getLlmCredential()`、`:disabled="!isLlmReady"` |
| `src/views/SettingsView.vue:1585` | 模型選單 | `v-if="groq \|\| hasLlmApiKey"` | Apple 改顯示固定唯讀模型欄（demo），雲端照舊 |
| `src/views/SettingsView.vue:602` `handleProviderChange` | 切換服務 | `saveLlmProvider` | 不變，但 `saveLlmProvider('apple')` 要把模型設為 `apple-intelligence` 並立即 `refreshAppleIntelligenceAvailability()` |
| `src/lib/enhancer.ts:118-121` | ①②③⑤ | `if (!apiKey) throw "API Key not configured"` | 參數改 `LlmCredential`；只在雲端分支檢查 key |
| `src/lib/vocabularyAnalyzer.ts:104-126` | ④ | 參數 `apiKey: string` | 參數改 `LlmCredential` |
| `src/lib/connectionTest.ts:22` | ⑤ | 參數 `apiKey: string` | 參數改 `LlmCredential`；Apple 先讀 availability（§5 ⑤） |
| `useSettingsStore` `loadSettings` | 載入 | — | **非 macOS 讀到 `selectedLlmProviderId === 'apple'`（例如設定備份還原）時改回預設 provider 與模型並存檔** |

平台判斷沿用現有 `navigator.userAgent.includes("Mac")` 寫法（`useSettingsStore.ts:90`、`keycodeMap.ts:459`），不新增套件相依性。

## 4. modelRegistry／llmProvider 變更

- `LlmProviderId` 加 `"apple"`；新增 `CloudLlmProviderId = Exclude<LlmProviderId, "apple">`。
- `LlmProviderConfig` 加 `kind: "cloud" | "on_device"`；Apple 的 `baseUrl`／`consoleUrl`／`apiKeyPrefix` 為空字串（或改為可選，擇一並讓型別擋住誤用）。`displayName: "Apple Intelligence"`。`LLM_PROVIDER_LIST` 把 Apple 放最後（demo：Gemini 之後）。
- `LlmModelId` 加 **`"apple-intelligence"`**（會寫進設定檔與 `api_usage.model`，定案後不可改名）。`LLM_MODEL_LIST` 新增：`providerId: "apple"`、`inputCostPerMillion: 0`、`outputCostPerMillion: 0`、`freeQuotaRpd: 0`、`freeQuotaTpd: 0`、`freeTier: "full"`、`speedTps: 22`（實測長文約 22 tokens／秒）、`isDefault: true`（在 Apple 清單內唯一）、`badgeKey` 用新 key `settings.modelBadge.onDevice`。
- `getDefaultModelIdForProvider("apple")` 回 `apple-intelligence`；`DEFAULT_LLM_PROVIDER_ID` 維持 `groq`（升級使用者零變動）。
- **逾時**：`getProviderTimeout(providerId, usePoint: LlmUsePoint)`，`type LlmUsePoint = "enhance" | "editMode" | "historyReEnhance" | "vocabularyAnalysis" | "connectionTest"`。雲端忽略 `usePoint`（維持現值）；Apple 取決策檔常數：45／60／90／15／10 s。
- `PROVIDER_DEFAULT_MAX_TOKENS.apple = 4096`（Swift 會夾限，見 ADR 後續修訂 2）。
- **共用呼叫縫**：新增 `src/lib/llmChat.ts` 的 `executeLlmChat(credential, request, { signal, usePoint }): Promise<LlmChatResult>`。雲端分支＝現有 `buildFetchParams` → `fetch` → `parseProviderResponse`（從 `enhancer.ts`、`vocabularyAnalyzer.ts` 搬出，行為不變）；Apple 分支呼叫 `src/lib/appleIntelligence.ts` 的 `generateWithAppleIntelligence()`。`enhancer.ts` 與 `vocabularyAnalyzer.ts` 都只呼叫 `executeLlmChat`，不各自分支。
- **Apple 轉接層**（`src/lib/appleIntelligence.ts`）：
  - 把 `messages` 轉成 `{ instructions: system, prompt: user, temperature, maxTokens }`。
  - `requestId = crypto.randomUUID()`；signal 已 aborted 就不呼叫、直接丟 `AbortError`；`signal` abort 或前端逾時到期都呼叫 `apple_intelligence_cancel`（決策檔 ①：現行 `withTimeout` 只 reject 不中止，Apple 必須真的 cancel，否則下一個請求撞 `busy`）。
  - Rust 回 `code: "cancelled"` 轉成 `AbortError`；其他錯誤丟 `AppleIntelligenceError`（帶整個 payload）。
  - 回傳 `usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: 兩者皆非 null 才相加否則 null, totalTimeMs: 前端量測 }`。
- `LlmUsageData` 與 `enhancer.ts` 的 `ChatUsageData` 三個 token 欄位改為 `number | null`（DB 欄位本來就可為 NULL，`ApiUsageRecord` 也已是 `number | null`）。

## 5. 五個使用點（數字全取自決策檔「常數總表」）

字數一律以**未包裝的 `rawText`** 計（`[...text].length`，與現有整理門檻同算法）；`<transcript>` 包裝只在 Apple 轉接層送出前加上；回應若含 `</?transcript>` 先剝除再進守衛。

| 使用點 | 結論 | Apple 專用行為 | 逾時 | 失敗時（沿用既有流程） |
|---|---|---|---|---|
| ① 錄音後文字整理 `enhanceText` | 降級 | 字數 < `max(使用者整理門檻, 30)` 不送、直接貼原文不提示；> 800 字不送、貼原文＋HUD「內容較長，已貼上原文（未整理）」；包 `<transcript>`；`detectEnhancementAnomaly` 倍率 1.5；異常不重試直接退原文 | 45 s | 貼原文＋`voiceFlow.pasteSuccessUnenhanced`；`wasEnhanced=false`、`processedText=null` |
| ② 選取文字語音改寫 | 輕度降級 | 選取 > 1,000 字不呼叫、不貼上、HUD「選取的文字太長，無法用 Apple Intelligence 改寫」；`maxTokens` 照送 `EDIT_MODE_MAX_TOKENS`（Swift 夾限）；**不包** `<transcript>`（改寫的 user prompt 結構不同） | 60 s | 不貼上＋`voiceFlow.editFailed` |
| ③ 歷史紀錄重新整理 `enhanceWithAnomalyGuard` | 降級 | < 30 字不呼叫、toast「內容太短，Apple Intelligence 不整理」；> 1,500 字不呼叫、toast「內容超過 1,500 字，Apple Intelligence 無法整理」；包裝、倍率 1.5、不重試同 ① | 90 s | 保留原結果＋`history.reEnhanceFailed`；守衛退回用 `history.reEnhanceDrift` |
| ④ 修正偵測→智慧字典學習 `analyzeCorrections` | 完整支援 | 沿用純文字 JSON 提示詞、`temperature` 0、`maxTokens` 256；不加標註、不停用開關 | 15 s | 靜默略過、只寫 log |
| ⑤ 設定頁連線測試 | 完整支援 | 先讀 availability，不可用直接顯示原因；可用才送 `ping`（`Reply with the word OK only.`、`maxTokens` 50） | 10 s | 顯示失敗原因，不改走雲端 |

- `detectEnhancementAnomaly` 加可選參數 `lengthRatioLimit`（預設 2，Apple 傳 1.5）；語意飄移守衛（overlap < 0.2）不變。
- 雲端 provider 的行為**一律不變**（門檻、重試、逾時、倍率都只在 `providerId === "apple"` 時套用），並以測試鎖住。
- HUD 沿用既有「整理中...」與取消方式，不另做進度條。

## 6. context 預檢（照決策檔 #8，前端零邏輯）

- 全在 Swift `generate` 內：`instructions + prompt + 8 + max(64, min(prompt, maxTokens ?? prompt)) ≤ contextSize × 0.95`。26.4+ 用 `tokenCount(for:)`；26.0～26.3 用字數估算（CJK 1.0／字、其他非空白 0.3／字、空白 0）。`contextSize` 執行期讀，不寫死。
- 超過 → 不呼叫模型，回 `context_size_exceeded`（`preflight: true`）；生成途中溢位（兩套 SDK 錯誤型別）也映射同一碼（`preflight: false`）。
- 前端只把它當一般失敗，走 §5 的失敗流程；`errorUtils` 對 ⑤ 顯示「內容超過 Apple Intelligence 可處理的長度」。

## 7. 設定頁 UI（以 demo 為準）

照 `docs/demos/apple-intelligence-settings/`：

- 「LLM 模型服務」RadioGroup 最後一張卡片「Apple Intelligence（裝置上）」；**macOS 一律顯示、Windows 整張不出現**。
- 選到後：不顯示 API Key 欄；顯示「Apple Intelligence 狀態」狀態列（圖示＋標題＋說明＋動作按鈕＋「重新檢查」）、隱私說明、測試連線（僅「已就緒」可按）；「文字整理模型」改成固定唯讀欄。
- 狀態列 6 種狀態＋本規格新增 `unknown`（「無法判斷 Apple Intelligence 狀態」／「請按『重新檢查』；若持續出現，請改用其他 LLM 模型服務。」／按鈕：重新檢查）。
- 「開啟系統設定」「開啟軟體更新」用 `x-apple.systempreferences:` 連結，pane ID 實機驗證，失敗退回開「系統設定」首頁（demo 待查證項）。
- 卡片底部琥珀色降級區（demo `degBlock`）；歷史紀錄頁「重新整理」按鈕旁（tooltip）加同 `degraded.historyReEnhance` 文案，僅在 Apple 被選中時顯示。
- `settings.provider.description` 補一句 Apple Intelligence（「Apple Intelligence 在 Mac 上本機處理、免費」，五語系）。
- Dashboard：Apple 的 `freeQuotaTpd` 為 0，**不顯示 LLM 額度條**（`DashboardView.vue:105` 會除以 0）；單筆用量 token 為 null 時顯示「—」。
- UI 一律 shadcn-vue＋語意色彩變數（`.claude/rules/ui.md`）；琥珀色用既有 warning 類語意變數，沒有就依 `ui.md` 新增 token，不用 Tailwind 原生色。

## 8. 用量統計

- Apple 呼叫**照樣寫 `api_usage` 一列**（保留呼叫次數與 `total_time_ms`）：`model = "apple-intelligence"`、token 欄位為 null（發行版是 SDK 26.5 建置，一律 null；ADR D6）、`estimatedCostCeiling = 0`。
- 現行三處 `if (usage)`／`if (analysisResult.usage)` 守衛（`useVoiceFlowStore.ts:722`、`:888`、`useHistoryStore.ts:678` `recordChatUsage`）在 Apple 下因轉接層一定回 `usage` 物件而會寫入；`calculateChatCostCeiling` 改收 `number | null`，null 或單價為 0 時回 0。
- 不自行估算 token（地圖 Notes 定案）。SQL 彙總已用 `COALESCE(SUM(...), 0)`，不需 migration。

## 9. 五語系 i18n key（`zh-TW`、`zh-CN`、`en`、`ja`、`ko` 同步，`.claude/rules/i18n.md`）

zh-TW 文案照 demo README 與決策檔；其他四語系由實作票翻譯。

| 群組 | key |
|---|---|
| 選項 | `settings.provider.apple`、`settings.provider.description`（改）、`settings.modelBadge.onDevice` |
| 狀態列 | `settings.appleIntelligence.statusLabel`、`privacy`、`testHint.ready`、`testHint.notReady`、`modelFixed`、`modelFixedHint` |
| 狀態 | `settings.appleIntelligence.status.{ready,notEnabled,modelNotReady,deviceNotEligible,intel,osTooOld,unknown}.{title,description}` |
| 動作 | `settings.appleIntelligence.action.{openSettings,openSoftwareUpdate,recheck,rechecking}` |
| 降級區 | `settings.appleIntelligence.degraded.{title,enhance,editMode,historyReEnhance,promptMode}` |
| 執行時提示 | `voiceFlow.pasteSuccessTooLongForApple`、`voiceFlow.editTooLongForApple`、`history.reEnhanceTooShortForApple`、`history.reEnhanceTooLongForApple`（命名空間定稿為現有 `voiceFlow`／`history`） |
| 錯誤轉譯 | `errors.appleIntelligence.{contextSizeExceeded,guardrail,refusal,unsupportedLanguage,modelNotReady,busy,rateLimited,timeout,unavailable,failed}` |
| 連線測試 | 沿用 `settings.connectionTest.{button,testing,success}`；失敗文字＝`errors.appleIntelligence.*` |

`errorUtils.getEnhancementErrorMessage` 新增 `AppleIntelligenceError` 分支，依 `code` 對應上表；未知碼走 `errors.appleIntelligence.failed`。

## 10. 最低 macOS 13.0（ADR D4）與影響

- `tauri.conf.json` `bundle.macOS.minimumSystemVersion: "13.0"`（🟡 hook 警告檔，必要變更）、`Package.swift` `platforms`、`build.rs` `MACOS_MIN`、`src-tauri/.cargo/config.toml` `[env] MACOSX_DEPLOYMENT_TARGET = "13.0"` 四處一致。
- 影響：**整個 app**（不只本選項）無法在 macOS 12 以下啟動；現行宣告 10.13（arm64 實際 11.0）。Tauri updater 不能依系統版本過濾，macOS 11／12 使用者自動更新後會被擋在啟動之外。
- 處置（代決）：接受。CHANGELOG、更新摘要、README 系統需求明寫「需要 macOS 13 以上」，並在 release notes 附上最後一個支援 macOS 11／12 的版本下載連結。**不做**「先發一版 updater 防護再升級」的兩段式發版（受影響族群小、維護成本高；若 AJ 不同意，改列 T6 前置）。

## 11. 測試策略

- **Vitest**（mock IPC 沿用 `tests/unit/use-voice-flow-store.test.ts`、`use-settings-store.test.ts` 的 `vi.mock("@tauri-apps/api/core")` 寫法）：
  - `appleIntelligence.ts`：請求轉換、abort 前已取消不呼叫、abort／前端逾時會呼叫 `apple_intelligence_cancel`、`cancelled` → `AbortError`、其他碼 → `AppleIntelligenceError`、usage 的 null 處理。
  - `llmChat.ts`：雲端分支行為與搬移前一致（沿用既有 enhancer／vocabularyAnalyzer 測試）。
  - 就緒閘門：每個呼叫點在未就緒時走既有失敗分支、**不呼叫任何雲端 `fetch`**；`getLlmCredential` 窮舉；非 macOS 載入 `apple` 會被重設。
  - 降級邊界：① 29／30、800／801 字；② 1,000／1,001 字；③ 29／30、1,500／1,501 字；倍率 1.5 對 Apple、2 對雲端；Apple 不重試；包裝只加在送出內容、守衛拿 `rawText`；回應中的 `</?transcript>` 被剝除。
  - 用量：Apple 寫入一列 token null、成本 0；Dashboard Apple 不顯示額度條。
- **Rust**（`cargo test`，macOS／Windows 都跑）：Swift JSON（snake_case）→ IPC（camelCase）映射、錯誤碼映射、inflight map「取消早於註冊」競態、非 macOS stub 回 `unsupported_platform`；`availability()` 冒煙測試（CI 虛擬機預期回不可用類狀態、不崩潰）；真實生成、取消、預檢溢位標 `#[ignore]`，只在本機 `cargo test -- --ignored` 跑。
- **Swift**：預檢的字數估算抽成純函式。`swift test` 在 CLT-only 環境是否可用**未驗證**；可用就加測試目標，不可用就以 Rust `#[ignore]` 整合測試覆蓋（送超長輸入驗 `preflight: true`）。
- **CI**：`ci.yml` 的 `rust-check` 在 `macos-latest`（SDK 26.5、Swift 6.3）經 `build.rs` 編 Swift，`windows-latest` 不呼叫 `swift` 且維持綠燈；不新增 job、不鎖 runner。`release.yml` 不改 runner。
- **手動**（本機 macOS 27.2）：`pnpm tauri dev` 走過 5 個使用點、6＋1 種狀態中可重現者；`pnpm tauri build` 後 `vtool -show-build` 確認 `minos 13.0`、`otool -L` 確認 FoundationModels 為 weak。

## 12. 發版與社群承諾

- **CHANGELOG**：新增「Apple Intelligence（裝置上）」與「最低系統需求改為 macOS 13」兩條（後者列在 Breaking／注意事項）。
- **更新摘要彈窗**：`mainApp.upgradeNotice.item1`～`itemN` 換成本版重點（五語系），含上述兩條；同步 `src/MainApp.vue` 的 `upgradeNoticeItemCount`（`.claude/rules/i18n.md`）。
- **README**：系統需求加「macOS 13 以上；Apple Intelligence 需 Apple 晶片＋macOS 26 以上並開啟 Apple Intelligence」。
- **`docs/community-commitments.md`**：**不新增**。上游沒有任何 Apple Intelligence 相關 issue（2026-11-06 `gh issue list -R chenjackle45/SayIt --search "Apple Intelligence"` 無結果），沒有對外承諾。整包 PR 回上游時若在 PR 中承諾後續事項，再依該檔規則補。
- 實跑一次 `release.yml`（arm64＋x64）與簽章＋公證（需 AJ 的 Secrets 與核可，ADR 後續必做 3）。
- 依 `docs/development-process.md`：codex 計劃閘 → 實作 → 實作閘；commit message 先經 AGY 審查；push 需 AJ 核可。

## 13. 風險

| 風險 | 影響 | 對策 |
|---|---|---|
| 最低 macOS 13.0 讓 macOS 11／12 使用者更新後無法啟動 | 舊系統使用者 | §10：文件明講＋附舊版下載連結 |
| CI 的 Swift 6.3（Xcode 26.6）編不過 `Bridge.swift` | 全部 macOS CI | T1 第一個 PR 就讓 CI 實跑；不過就依 ADR D6 備案改 `-DSAYIT_SDK_27` |
| 前端逾時沒真的 cancel，模型繼續跑 | 下一請求 `busy` | 轉接層強制 cancel，測試鎖住 |
| 30／800 字門檻與 1.5 倍率只由 13 段手寫稿推出 | ①③ 誤擋或漏擋 | 上線後看 log 的 `enhancement rejected` 比例再調；常數集中一處 |
| Intel 判斷（`hw.optional.arm64`）未在真實 Intel Mac 驗證 | Intel 使用者看到錯的狀態 | 判斷失敗時 FoundationModels 仍會回 `device_not_eligible`，文案同樣引導改用其他服務 |
| `tokenCount` 不存在的 26.0～26.3 字數估算偏差 | 預檢放行後生成途中溢位 | 生成途中溢位也映射同一碼、走同一失敗流程 |
| 兩個 webview 讀到不同就緒狀態 | 設定頁顯示就緒、HUD 實際不可用 | 每次呼叫前在當前 webview 重讀（§2） |

## 14. 動工前／實作中要驗（不當事實用）

沿自研究與 ADR 的未驗證項：

1. macOS 26.x 實機的 `contextSize`（預期 4096）與品質；26.0～26.3 字數估算誤差（決策檔 #8）。
2. 三種 `unavailable` 原因的實機重現與官方語意（`modelNotReady` 是否必為下載中）（#4）。
3. 真實 Intel Mac 的 `availability` 與 `hw.optional.arm64` 判斷（ADR）。
4. macOS 13～25 實機啟動（weak link 只由 `otool -L` 推論）（ADR）。
5. `tauri build` 是否把 `minimumSystemVersion` 傳成 `MACOSX_DEPLOYMENT_TARGET`；GitHub Actions 上 `build.rs`、`swatinem/rust-cache` 快取 `$OUT_DIR`（ADR）。
6. Developer ID 簽章與公證（ADR）。
7. `x-apple.systempreferences:` 兩個 pane ID 在 macOS 26／27 是否有效（demo）。
8. ja／ko／zh-CN／yue 的 `<transcript>` 包裝是否不劫持（實作 T4 #17 各補 3 段樣本）（決策檔 #9）。
9. 門檻與倍率在真實 Whisper 輸出上的表現、包裝不洩漏標籤（只有 26 次樣本）（決策檔 #9）。
10. `apple_intelligence_availability` 的實際延遲（§2）。
11. `swift test` 在 CLT-only 是否可用（§11）。

## 實作票

規格票：#13。實作票皆為 #13 的子票，依阻擋關係開工（`/dispatcher` 可接手者貼 `ready-for-agent`）。

| 票 | 標題 | 被誰阻擋 | 標籤 |
|---|---|---|---|
| T1 #14 | Apple Intelligence Swift 橋接、三個 command 與最低 macOS 13.0 | — | ready-for-agent |
| T2 #15 | LLM 就緒閘門與 Apple 轉接層（連線測試可用） | T1 #14 | ready-for-agent |
| T3 #16 | 設定頁 Apple Intelligence 卡片、就緒狀態列與五語系 | T2 #15 | ready-for-agent |
| T4 #17 | 文字整理與歷史重新整理的 Apple 降級 | T2 #15 | ready-for-agent |
| T5 #18 | 選取文字改寫降級與智慧字典學習支援 | T2 #15 | ready-for-agent |
| T6 #19 | 發版準備：CHANGELOG、更新摘要、README 與 release 實跑 | T3 #16、T4 #17、T5 #18 | ready-for-human |
