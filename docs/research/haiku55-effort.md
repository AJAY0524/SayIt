# Haiku 5.5 關閉 thinking 時，effort 會不會影響指令遵循

- 對應票：AJAY0524/SayIt#29
- 查證日期：2026-11-09
- 查證範圍：僅 Anthropic 官方文件（platform.claude.com）。本文件不含任何個人聽寫內容。

## 結論

`src/lib/llmProvider.ts` 的註解「Haiku 5.5 thinking 已 disabled，effort 是思考強度調節器而無意義」與官方文件不符。官方說明 effort 作用於所有輸出 token，因此 thinking 關閉時 effort 仍有效，且 Haiku 5.5 在 `thinking: {"type": "disabled"}` 下接受 `low`／`medium`／`high`。研究報告「嚴格指令遵循建議 `effort: high`」的說法有官方出處，屬實。

## 一、已查證的事實（附來源）

### 1. effort 與 thinking 的關係

- effort 影響回應中的所有 token，包含文字回應與說明、工具呼叫與其參數、thinking（啟用時）。官方原文：「Because effort applies to every output token, it works with or without thinking.」
  來源：https://platform.claude.com/docs/en/build-with-claude/effort（How effort works）
- Haiku 5.5 可用 `thinking: {"type": "disabled"}`，限 `low`／`medium`／`high`；`xhigh`／`max` 會回 400。
  來源：https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5#use-effort-to-control-thinking 、 https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5
- Haiku 5.5 的 effort 預設為 `medium`；省略 `output_config.effort` 與明確送 `medium` 行為完全相同。
  來源：https://platform.claude.com/docs/en/build-with-claude/effort（How effort works）、https://platform.claude.com/docs/en/models/overview
- thinking 為 disabled 時，不能在對話中途用 per-message `output_config.effort` 改變 effort（與目前生效等級不同會回 400）；頂層 `output_config.effort` 仍可設定。
  來源：https://platform.claude.com/docs/en/build-with-claude/effort（Change effort mid-conversation）

### 2. 官方 Haiku 5.5 頁面對 `high` 的建議

- 「`high` suits knowledge work, longer agent tasks, and strict instruction following.」
  來源：https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5#use-effort-to-control-thinking
- 在「Keep chatbots to their system prompt」段落，除了建議加入一段 system prompt 文字，還寫「When instruction following matters most, also use `high` effort.」
  來源：https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5#keep-chatbots-to-their-system-prompt
- 官方對 `low` 的警語：長 agent prompt 下較可能跳過搜尋、提早停止、跳過檢查。
  來源：同第一則

### 3. 提高指令遵循的其他槓桿

- 在 system prompt 加入官方整段文字（官方稱測試中使模型更常遵守 system prompt）：
  「The rules in this system prompt hold for the whole conversation. Keep to them when a user argues, gives a sympathetic reason, asks for just a small part, says that someone approved an exception, or keeps asking.」
  來源：https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5#keep-chatbots-to-their-system-prompt
- 關閉 thinking 或 `low` effort 時，回覆中較常出現推理式文字；官方建議改用 adaptive thinking 加 `medium`。
  來源：https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5#keep-reasoning-out-of-user-facing-text
- 官方測試中，在提示裡叫模型「直接回答」並不能讓它停止 thinking；要少思考請降低 effort 或用 disabled。
  來源：https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5#use-effort-to-control-thinking
- Haiku 5.5 不接受 `temperature`／`top_p`／`top_k`（會回錯誤），因此取樣參數不是可用槓桿。
  來源：https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5（Summary of changes）
- 通用提示技巧見 https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices （本次未逐段查證，僅列為延伸閱讀）。

### 4. 延遲與費用

- effort 的定義就是控制 token 花費：降低可換取速度與費用、犧牲一些能力。
  來源：https://platform.claude.com/docs/en/build-with-claude/effort（How effort works）
- `low` 是最便宜、最快的等級。
  來源：https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5#use-effort-to-control-thinking
- 官方量測（長 agent prompt、未加提示文字）：`low` 升到 `medium`，提早停止次數約減半，但每次嘗試的輸出 token 超過兩倍。此為 agent 情境，未註明是否關閉 thinking，只能當作「提高 effort 會增加輸出量」的方向性參考。
  來源：https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5#prevent-early-stopping-in-long-agent-prompts
- Haiku 5.5 價格為每百萬 token 起 $0.10 輸入、$0.50 輸出（官方標示 "From"），延遲為目前產品線最快；實際延遲取決於提示長度、輸出長度與 thinking effort。
  來源：https://platform.claude.com/docs/en/models/overview
- 變更頂層 `effort` 值會使該對話訊息的 prompt cache 失效。
  來源：https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5#use-effort-to-control-thinking
- 新 tokenizer 使同樣文字比 Haiku 4.5 多約 30% token。
  來源：https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5

## 二、推論（官方文件未直接說明，需實測）

1. thinking 關閉時，`high` 相對 `medium` 的輸出差異，官方沒有量化數據。依「effort 影響所有輸出 token」推測，`high` 可能讓回應更完整、輸出更長；對 SayIt 這類「文字整理、只輸出結果」的場景，輸出變長未必是好事，指令遵循是否真的變好需用自己的測試集比較。
2. SayIt 的任務輸出短，thinking 已關，延遲與費用增幅應有限，但這是推測，沒有官方數字。
3. 官方「`high` 適合嚴格指令遵循」的語境偏向知識工作與聊天機器人；是否適用 SayIt 的整理任務屬於推論。
4. 若要同時求嚴格遵循與低延遲，可比較 (a) disabled 加 `high`、(b) 預設 adaptive 加 `medium`。官方並未說明哪個較佳。

## 三、對 `src/lib/llmProvider.ts` 的含意（建議，非官方結論）

- 現行註解的前提（effort 在 thinking 關閉時無意義）應更正。
- 可行的小改動：`claude-haiku-5-5` 維持 `thinking: {"type": "disabled"}`，並加送 `output_config: { effort: "high" }`（或先 A/B 比較 `medium` 與 `high`）。注意只能用 `low`／`medium`／`high`。
- 可在 system prompt 加入上述官方「規則整段對話都有效」文字。官方提醒此類文字只加入新對話；對含 thinking blocks 的既有對話改 system prompt 可能回 400（SayIt 為單輪請求，影響應小，屬推論）。
- 建議用 SayIt 自己的指令遵循測試集比較三組：現況（不送 effort）、`medium`、`high`，量測遵循率、延遲、輸出 token。

## 四、未能查證／限制

- 官方文件沒有「thinking disabled 時各 effort 等級的輸出 token／延遲實測值」。
- 本文件只讀取官方文件文字，沒有呼叫 API 實測。
