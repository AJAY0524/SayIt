# Apple Intelligence 設定頁 demo（Issue #7）

開啟 `index.html`（自包含、無外部相依）。頂端控制列可切換平台與各狀態；控制列本身不屬於實際畫面。
2026-11-06 由 AJ 授權代為決定設計。拍板後依 `.claude/rules/ui.md` 視為規格的一部分，與文字衝突以 demo 為準。

## 設計重點

- 位置：實際 UI 的「LLM 模型服務」是 2 欄卡片式 RadioGroup（不是下拉），Apple Intelligence 加在最後（Gemini 之後），名稱「Apple Intelligence（裝置上）」。macOS 一律顯示；Windows 整張卡片不出現。
- 選到後：不顯示 API Key 欄，改顯示「狀態列」＋隱私說明＋測試連線；「文字整理模型」改成固定唯讀欄（模型由 macOS 管理）。
- 狀態列：圖示＋標題＋一行說明，需要動作時附按鈕。所有不可用狀態都有「重新檢查」（重新讀 `availability`），原因由使用者排除後不必重開 App。
- 測試連線：僅「已就緒」可按；按下在裝置上送一句短文字，成功顯示「測試成功（{ms}ms）」；失敗（例如 guardrail、超過 context）顯示原因，不改走雲端。未就緒時按鈕停用，並提示「需先讓上方狀態變成『已就緒』才能測試」。
- 降級標註：選到 Apple Intelligence 時，卡片底部顯示琥珀色提示區，列出降級項目；降級的使用點旁（如歷史紀錄「重新整理」）再加一行同文案，**不停用**任何開關。項目依 #9 決策（`docs/research/apple-intelligence-decisions.md`，AJ 授權代決）：① 文字整理、② 選取文字改寫、③ 歷史紀錄重新整理降級；④ 自動學詞彙、⑤ 連線測試完整支援，不加標註。

## 狀態與文案（zh-TW，之後翻成 5 語系）

| 狀態 | 來源 | 標題 | 說明 | 按鈕 |
|---|---|---|---|---|
| 已就緒 | `available` | 已就緒 | Apple Intelligence 可以使用。 | 無 |
| 未開啟 | `appleIntelligenceNotEnabled` | 尚未開啟 Apple Intelligence | 請到「系統設定 → Apple Intelligence 與 Siri」開啟，完成後回到這裡按「重新檢查」。 | 開啟系統設定、重新檢查 |
| 模型未就緒 | `modelNotReady` | Apple Intelligence 模型尚未就緒 | 系統可能還在下載模型。稍候幾分鐘後按「重新檢查」。 | 重新檢查 |
| 裝置不支援 | `deviceNotEligible` | 這台 Mac 不支援 Apple Intelligence | Apple Intelligence 需要 Apple 晶片（M1 以上）的 Mac。請改用其他 LLM 模型服務。 | 重新檢查 |
| Intel Mac | App 自行偵測 | Intel Mac 不支援 Apple Intelligence | Apple Intelligence 只支援 Apple 晶片（M1 以上）的 Mac。請改用其他 LLM 模型服務。 | 無 |
| macOS 太舊 | App 自行偵測（< 26） | 需要 macOS 26 以上 | 目前的 macOS 版本太舊，請先更新系統。 | 開啟軟體更新 |

其他文案：

- 選項名稱：`Apple Intelligence（裝置上）`
- 狀態區標題：`Apple Intelligence 狀態`
- 隱私說明：`使用裝置上的 Apple Intelligence 整理文字，資料不會離開您的 Mac。`
- 測試說明（就緒）：`會在裝置上送一句短文字給模型，不會連網。`
- 測試說明（未就緒）：`需先讓上方狀態變成「已就緒」才能測試。`
- 測試失敗範例：`測試失敗：模型拒絕回應（guardrail），請稍後再試`
- 模型欄：`Apple Intelligence（系統內建）`、`固定`、`模型由 macOS 管理，無法選擇；Windows 與雲端服務的模型清單不受影響。`
- 降級區標題：`部分功能在 Apple Intelligence 下會降級`
- 降級項目（#9 定案）：
  - `文字整理：少於 30 字或超過 800 字時直接貼上原文；整理效果比雲端模型弱`
  - `選取文字改寫：限 1,000 字以內；「改正式」「修錯字」等指令可能漏改，貼上後請檢查`
  - `歷史紀錄重新整理：少於 30 字或超過 1,500 字的紀錄不整理；長紀錄可能要等 1 分鐘以上`
  - `建議使用「精簡」提示詞；「積極」模式在 Apple Intelligence 下效果不穩定`
- 執行時提示（#9 定案）：`內容較長，已貼上原文（未整理）`、`選取的文字太長，無法用 Apple Intelligence 改寫`、`內容太短，Apple Intelligence 不整理`、`內容超過 1,500 字，Apple Intelligence 無法整理`；其餘失敗沿用既有文案
- 按鈕：`開啟系統設定`、`開啟軟體更新`、`重新檢查`、`檢查中...`
- 既有可重用：`settings.connectionTest.button／testing／success`

## 預計新增的 i18n key（`zh-TW`、`zh-CN`、`en`、`ja`、`ko` 同步）

- `settings.provider.apple`
- `settings.appleIntelligence.statusLabel`、`privacy`、`testHint.ready`、`testHint.notReady`、`modelFixed`、`modelFixedHint`
- `settings.appleIntelligence.status.ready`／`notEnabled`／`modelNotReady`／`deviceNotEligible`／`intel`／`osTooOld`，各有 `.title`、`.description`
- `settings.appleIntelligence.action.openSettings`／`openSoftwareUpdate`／`recheck`／`rechecking`
- `settings.appleIntelligence.degraded.title`、`degraded.enhance`、`degraded.editMode`、`degraded.historyReEnhance`、`degraded.promptMode`（#9 定案）
- 執行時提示 4 個新 key（暫名 `voiceFlow.pasteSuccessTooLongForApple`、`voiceFlow.editTooLongForApple`、`history.reEnhanceTooShortForApple`、`history.reEnhanceTooLongForApple`；命名空間由規格票定稿）
- `settings.connectionTest.failed`（若現有失敗文案不通用）

## 待查證

- 兩個 `x-apple.systempreferences:` 連結（Siri／Apple Intelligence 面板、軟體更新）的 pane ID 在 macOS 26／27 是否有效，實作時需實機驗證；失敗時退回只開「系統設定」首頁。
- `modelNotReady` 是否一定代表下載中，官方語意未驗證（見 `docs/research/foundation-models-api.md`），故文案寫「可能」。
