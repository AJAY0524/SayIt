# 決策：Apple Intelligence 的 context 預算與各使用點降級（#8、#9）

> 地圖：AJAY0524/SayIt#2。決策日期 2026-11-06。**AJ 授權代決**（AJ 於 2026-11-06 交代「依你的專業判斷自主決策並連續推進」）。
> 依據：`docs/research/apple-intelligence-eval.md`（#5 實測，下稱「實測」）、`docs/research/foundation-models-api.md`（#4）、`docs/adr-apple-intelligence-swift-bridge.md`（#6，下稱「ADR」）、`docs/demos/apple-intelligence-settings/`（#7）。
> 本檔給規格票（#10）當單一來源；數字都可回查實測章節。未實測的部分標「未驗證」。

## 常數總表（規格直接抄這張）

| 常數 | 值 | 套用位置 | 依據 |
|---|---|---|---|
| context 上限 | 執行期讀 `SystemLanguageModel.default.contextSize`，不寫死（預期 macOS 26.x＝4096、27＝8192） | Swift `generate` 預檢 | #4、實測 §5 |
| 預檢規則 | `instructions + prompt + 8 + 預留輸出 ≤ contextSize × 0.95` | Swift `generate` 預檢 | 實測 §1.3（框架開銷約 8）、§5.3 |
| 預留輸出 | `max(64, min(promptTokens, maxTokens ?? promptTokens))` | 同上 | 實測 §5.2：整理類輸出／輸入 1.0～1.1 |
| token 計數（26.4+） | `SystemLanguageModel.tokenCount(for:)` 分別量 instructions 與 prompt | Swift | #4；實測 437＝412＋17＋8 吻合 |
| 字數估算（26.0～26.3，無 `tokenCount`） | 漢字／假名／韓文 1.0 token／字；其他非空白字元 0.3 token／字；空白 0 | Swift | 實測口語稿 0.63／字、文件 0.5／字、英文約 0.2／字元，取保守值 |
| `maxTokens` 夾限 | `min(請求值, contextSize − instructions − prompt − 8)` | Swift | `EDIT_MODE_MAX_TOKENS`＝4096 在 4096 context 上不合法 |
| 詞彙數 | 維持 50（同雲端），不動態刪減 | ①③ | 50 筆＝164 tokens；砍到 20 筆只省約 100 tokens |
| 短稿門檻 | 少於 30 字不送 Apple，直接貼原文（不提示） | ①③ | 實測 S1～S4（12～24 字）12／15 次被劫持 |
| ① 長度上限 | 800 字 | ① | 最差 48 ms／字（68 s／1,408 字）→ 800 字約 38 s；長文本來就幾乎沒校對（L1） |
| ② 長度上限 | 1,000 字（選取文字） | ② | 翻譯輸出約等於輸入，1,000 字約 48 s |
| ③ 長度上限 | 1,500 字 | ③ | L1 1,408 字 41～68 s；使用者主動觸發，可等 |
| 前端逾時（主控） | ① 45 s、② 60 s、③ 90 s、④ 15 s、⑤ 10 s | `PROVIDER_TIMEOUT_MS` 改成依使用點取值（Apple 專用） | 上限字數 × 48 ms＋首 token 餘裕 |
| Rust 逾時（安全網） | 120 s（ADR 原建議 60 s 改為 120 s，須大於前端最大值） | `apple_intelligence.rs` | 避免安全網比主控先到 |
| 長度爆炸倍率（Apple 專用） | 1.5（雲端維持 2） | `detectEnhancementAnomaly` 加參數 | 實測好輸出最高 1.10；1.2～2.5 之間只有壞輸出（1.45～2.08）；0 誤判 |
| 異常重試次數（Apple 專用） | 0（直接退回原文） | ①③ | `temperature` 0.1 下重試輸出相同；S4 重試 3 次會拖數分鐘 |
| 逐字稿包裝 | user prompt 改為 `<transcript>\n{逐字稿}\n</transcript>`，system prompt 不改 | ①③ | 實測 §2.3「真實提示詞＋只加包裝」：M1 3／8、M2 2／2 不退步，S4 劫持解除 |

---

## #8 決策：context 預算策略

### 結論

1. **預檢放在 Swift 的 `apple_intelligence_generate` 內**，不新增 command、不改 ADR 的三個 command。Swift 讀 `contextSize`，26.4+ 用 `tokenCount(for:)` 分別量 instructions 與 prompt，26.0～26.3 用字數估算（常數表）。超過 `contextSize × 0.95` 就**不呼叫模型**，立即回錯誤 `context_size_exceeded`，payload 多帶 `preflight: true`、`estimatedTokens`、`contextSize`、`method`（`token_count`／`char_estimate`）。前端只處理一個錯誤碼；生成途中才溢位（`LanguageModelError.contextSizeExceeded`／26.x 的 `GenerationError.exceededContextWindowSize`）也映射成同一個碼（`preflight: false`）。
   - 理由：實測 §5.3 的 10,000 字案例輸入只有 5,914 tokens（小於 8192），卻在生成 152 秒後才丟錯且沒有部分輸出；只檢查輸入不夠，必須把預估輸出算進去。前端拿不到 `tokenCount` 也不知道 `contextSize`，放在 Swift 最省介面。
   - 對 ADR 的影響：`generate` 請求格式不變；錯誤碼 `context_size_exceeded` 的 payload 擴充三個欄位；Rust 逾時由 60 s 改為 120 s（見 #9）。屬於 ADR 的補充，不是推翻。
2. **門檻用公式，不寫死 4096／8192**：`instructions + prompt + 8 + max(64, min(prompt, maxTokens))`。換算口語繁中（0.63 token／字、minimal＋50 詞彙＝412 tokens）的可處理字數：

   | 系統 | contextSize | 計數方式 | 約略可處理字數 |
   |---|---|---|---|
   | macOS 27 | 8192 | `tokenCount` | 約 5,800 字 |
   | macOS 26.4～26.x | 4096 | `tokenCount` | 約 2,750 字 |
   | macOS 26.0～26.3 | 4096 | 字數估算（1.0／字） | 約 1,600 字（推算，提示詞也按 1.0／字估） |

   實務上真正綁住的是 #9 的延遲上限（800／1,000／1,500 字），context 預檢只在自訂長提示詞、macOS 26 舊版或 ④ 遇到超長輸入框時才會觸發，是安全閥。macOS 26.x 的 4096 **未實機驗證**（本機是 27.2）。
3. **不切段**。理由：(a) 切段的品質與跨段一致性完全沒測（實測 §11）；(b) 長文本來就幾乎沒校對（L1 1,408 字：只換行、贅詞 13→12、錯字沒改），切段只是用更多時間換一樣弱的結果；(c) 6,000 字已經要 157 秒，延遲讓切段失去意義。之後若 Apple 模型品質改善再另開票。
4. **超過門檻沿用既有失敗流程**（地圖 Notes 已定案，絕不改走雲端）：
   - ① 文字整理：貼原文，HUD 顯示「已貼上（未整理）」；紀錄 `wasEnhanced=false`、`processedText=null`。
   - ② 選取文字改寫：不貼上，HUD 顯示「編輯失敗」（既有 `voiceFlow.editFailed`）。
   - ③ 歷史重新整理：保留既有結果，toast「重新整理失敗，請稍後再試」（既有 `reEnhanceFailed`）；超過 ③ 長度上限則用 #9 的專用文案。
   - ④ 修正偵測：靜默略過，只寫 log（與現行失敗處理一致）。
   - ⑤ 連線測試：輸入固定為 `ping`，不會觸發。
5. **提示詞：不另做 Apple 精簡版，沿用使用者目前的提示詞**（預設「精簡」）。理由：精簡＋50 詞彙＝412 tokens，只佔 8192 的 5%、4096 的 10%，不是瓶頸；「積極」＋50 詞彙＝558 tokens 也放得下。自訂提示詞的長度由預檢實際量測，不假設 412。「積極」在實測中會多附重複摘要（M1 長度比 1.45～1.61）且照樣被劫持，所以 #9 的降級提示會建議改用「精簡」，但不強制覆寫使用者的模式（雙擊快捷鍵切換模式的既有功能不受影響）。
6. **詞彙表維持 50 筆，不動態刪減**。50 筆＝164 tokens（約 3.3 tokens／筆）；砍到 20 筆只省約 100 tokens（約 150 字），換來的是詞彙套用率下降（M1 無詞彙表 0／8、有詞彙表 3／8）。不值得為此多寫一套刪減邏輯。

### 未驗證

- macOS 26.x 實機的 `contextSize` 與品質；26.0～26.3 字數估算的誤差。
- 不同 `variant`（`core3`）的 `contextSize`。

---

## #9 決策：各使用點是否降級

| 使用點 | 結論 | 一句話 |
|---|---|---|
| ① 錄音後文字整理 | **降級** | 30～800 字才整理，逐字稿包 `<transcript>`，異常不重試直接退原文，長度倍率收緊為 1.5 |
| ② 選取文字語音改寫 | **輕度降級** | 選取限 1,000 字、`maxTokens` 夾限、逾時 60 s；提示「保持原意」類指令需人工檢查 |
| ③ 歷史紀錄重新整理 | **降級** | 同 ①，上限放寬到 1,500 字、逾時 90 s |
| ④ 修正偵測→自動學詞彙 | **完整支援** | 沿用純文字 JSON 提示詞，套用 context 預檢，逾時 15 s |
| ⑤ 設定頁連線測試 | **完整支援** | 先讀可用性再送 `ping`，逾時 10 s |

### ① 錄音後文字整理（`enhanceText`）：降級

- **少於 30 字不送 Apple**：直接貼原文、不額外提示（與現有「整理門檻」分支相同行為）。實際門檻＝`max(使用者整理門檻, 30)`。依據：S1～S4（12～24 字）12／15 次被劫持（照指令寫信、回答玉山、倒出詞彙表、附假條列），S2 這種指令口吻連包裝與明確提示詞都救不了，語意守衛也漏（overlap 0.26～0.4）。真實 Whisper 輸出通常已有標點，短句不整理的損失小。
- **超過 800 字不送 Apple**：貼原文，HUD 顯示新文案「內容較長，已貼上原文（未整理）」。依據：最差 48 ms／字，800 字約 38 秒；L1（1,408 字）忠實但幾乎沒校對，長文送模型的收益接近零。
- **逐字稿包 `<transcript>`**：只改 user prompt，不改 system prompt。依據：實測 §2.3「真實提示詞＋只加包裝」M1 3／8、M2 2／2 與原本相同，S4 劫持解除。不採用「較明確的提示詞」（M1 由 3／8 掉到 0／8）。
- **不採用 guided generation（schema）**：雖然 M1 由 3／8 升到 6／8，但只有一個樣本，且 ADR 的 `generate` 請求沒有 schema 欄位、還要多吃 81 tokens。列為後續實驗，不進 v1。
- **守衛**：Apple 路徑把長度爆炸倍率收緊為 **1.5**（雲端維持 2）、異常**不重試**直接退回原文，語意飄移守衛（overlap < 0.2）不變。依據：好輸出長度比最高 1.10；1.2～2.5 之間只出現壞輸出（1.45、1.58、1.61、1.96、2.08），全部 0 誤判（主測試 42＋降級實驗 66）；`temperature` 0.1 下重試結果相同，重試只會拖時間（S4 單次 55 秒）。
- **逾時 45 s**（Apple 專用，前端主控）。注意：現行 `withTimeout`（`enhancer.ts`）逾時只會 reject，**不會中止底層請求**；Apple 轉接層必須在逾時時呼叫 `apple_intelligence_cancel`（ADR 已證實取消 1～6 ms 生效），否則模型會繼續跑，下一個請求可能撞到 `busy`。
- **HUD**：沿用既有「整理中...」狀態與取消方式，不另做進度條。
- **其他語系**：包裝只動 user prompt，不需要每語系各寫一版提示詞；en minimal 在實測表現良好（ES／EM 3／3）。ja／ko／zh-CN／yue **未驗證**，實作票需各補 3 段樣本確認不劫持。

### ② 選取文字語音改寫：輕度降級

- **選取文字限 1,000 字**：超過就不呼叫模型，HUD 顯示新文案「選取的文字太長，無法用 Apple Intelligence 改寫」，不貼上任何東西（沿用既有「編輯失敗不貼上」原則）。依據：摘要 1,408 字 14.6 s，但翻譯／改寫輸出約等於輸入，1,000 字約 48 s。
- **`maxTokens`**：請求仍帶 `EDIT_MODE_MAX_TOKENS`（4096），由 Swift 夾限到剩餘 context（#8）。
- **逾時 60 s**，逾時一樣要 cancel。
- **不新增「一鍵還原」功能**：改寫結果是貼進使用者的 App，使用者可用該 App 的 ⌘Z 還原；新功能不在本地圖範圍，降級提示中提醒即可。
- 依據：翻譯英文、縮短、條列、摘要 3／3 好，短文 1～2 s；「改正式」丟掉請託句（3／3）、「修錯字」漏改「測式」（3／3）、日文用字不自然。

### ③ 歷史紀錄重新整理（`enhanceWithAnomalyGuard`）：降級

- 與 ① 相同：`<transcript>` 包裝、倍率 1.5、不重試。
- **少於 30 字**：不呼叫模型，toast「內容太短，Apple Intelligence 不整理」，保留原結果。
- **超過 1,500 字**：不呼叫模型，toast「內容超過 1,500 字，Apple Intelligence 無法整理」，保留原結果。
- **逾時 90 s**（L1 1,408 字最慢 68 s）。使用者主動觸發、失敗保留既有結果，風險比 ① 低，所以上限比 ① 寬。
- 守衛退回時沿用既有 `reEnhanceDrift`「整理結果與原文差異過大，已保留原結果」。

### ④ 修正偵測→自動學詞彙（`analyzeCorrections`）：完整支援

- 沿用 `vocabularyAnalyzer.ts` 的純文字 JSON 提示詞、`temperature` 0、`maxTokens` 256、`parseSuggestedTermList`；不用 schema（schema 版 18／24，純文字 24／24）。
- 套用 #8 預檢（`pastedText`／`fieldText` 可能是整個輸入框，**長文本未測**）；超過就靜默略過。
- 逾時 15 s（實測 0.4～1.2 s）。
- 「自動學詞彙」開關**不停用**、不加降級標註（推翻 #7 demo 的佔位）。

### ⑤ 設定頁連線測試：完整支援

- 先讀 `apple_intelligence_availability`，就緒才送 `ping`（`Reply with the word OK only.`、`maxTokens` 50）。逾時 10 s（暖機 117～166 ms、冷啟動 780 ms）。
- 成功顯示「測試成功（{ms}ms）」，失敗顯示原因，不改走雲端（#7 demo 已定）。

### UI 告知（zh-TW，翻五語系由 i18n 票處理）

設定頁「LLM 模型服務」選到 Apple Intelligence 時，卡片底部琥珀色降級區（#7 demo 的 `degBlock`）：

- 標題 `settings.appleIntelligence.degraded.title`：`部分功能在 Apple Intelligence 下會降級`
- `settings.appleIntelligence.degraded.enhance`：`文字整理：少於 30 字或超過 800 字時直接貼上原文；整理效果比雲端模型弱`
- `settings.appleIntelligence.degraded.editMode`：`選取文字改寫：限 1,000 字以內；「改正式」「修錯字」等指令可能漏改，貼上後請檢查`
- `settings.appleIntelligence.degraded.historyReEnhance`：`歷史紀錄重新整理：少於 30 字或超過 1,500 字的紀錄不整理；長紀錄可能要等 1 分鐘以上`
- `settings.appleIntelligence.degraded.promptMode`：`建議使用「精簡」提示詞；「積極」模式在 Apple Intelligence 下效果不穩定`

使用點旁的單行標註：

- 歷史紀錄頁「重新整理」按鈕旁（或 tooltip）：同 `degraded.historyReEnhance`。
- 「自動學詞彙」：**不加標註、不停用**。

執行時提示（HUD／toast）：

| key | 文案 | 時機 |
|---|---|---|
| 既有 `voiceFlow.pasteSuccessUnenhanced` | `已貼上（未整理）` | ① 預檢超過 context、guardrail、逾時等失敗 |
| 新 `voiceFlow.pasteSuccessTooLongForApple` | `內容較長，已貼上原文（未整理）` | ① 超過 800 字 |
| 新 `voiceFlow.editTooLongForApple` | `選取的文字太長，無法用 Apple Intelligence 改寫` | ② 超過 1,000 字 |
| 既有 `voiceFlow.editFailed` | `編輯失敗` | ② 其他失敗 |
| 新 `history.reEnhanceTooShortForApple` | `內容太短，Apple Intelligence 不整理` | ③ 少於 30 字 |
| 新 `history.reEnhanceTooLongForApple` | `內容超過 1,500 字，Apple Intelligence 無法整理` | ③ 超過 1,500 字 |
| 既有 `reEnhanceFailed`／`reEnhanceDrift` | 不變 | ③ 其他失敗／守衛退回 |

（key 的實際命名空間由規格票對照 `zh-TW.json` 現有結構定稿。）

### 給規格票的實作要點

1. `llmProvider.ts`：`LlmProviderId` 加 `apple`；逾時改成 Apple 依使用點取值（其他 provider 不變）。
2. `hallucinationDetector.ts`：`detectEnhancementAnomaly` 加可選倍率參數，Apple 傳 1.5。
3. `enhancer.ts`／`useVoiceFlowStore.ts`／`useHistoryStore.ts`：Apple 路徑加字數門檻（30／800／1,000／1,500）、`<transcript>` 包裝、重試次數 0、逾時觸發 cancel。包裝只在 Apple 轉接層（送 `invoke` 前）加上；字數門檻與 `detectEnhancementAnomaly`／`detectSemanticDrift` 一律拿未包裝的 `rawText` 比對，避免標籤字元干擾倍率與 bigram 重疊；回應若含 `</?transcript>` 先剝除再進守衛（實測 26 次包裝版輸出 0 次洩漏標籤，屬防禦性處理）。
4. Swift `generate`：預檢（`tokenCount`／字數估算）、`maxTokens` 夾限、`context_size_exceeded` payload 擴充；Rust 逾時 120 s。
5. 測試：門檻邊界（29／30、800／801 字）、倍率 1.5、逾時會呼叫 cancel、預檢錯誤走既有失敗流程且不呼叫雲端。

### 未驗證

- 門檻 30／800／1,000／1,500 是由 13 段手寫逐字稿推出，真實 Whisper 輸出（已有標點）的劫持率與延遲未測。
- 長度倍率 1.5 的 0 誤判只基於 108 次好輸出；真實使用中「條列化」可能讓好輸出變長，上線後看 log 的 `enhancement rejected` 比例再調。
- ja／ko／zh-CN／yue 的包裝效果。
- 包裝不洩漏標籤只基於 26 次輸出（`VA-wrap-real-*`，0 次）。
