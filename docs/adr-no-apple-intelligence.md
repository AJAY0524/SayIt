# ADR: 不採用 Apple Intelligence 作為 LLM 模型服務

| 項目 | 內容 |
|------|------|
| 狀態 | Accepted（永久不採用） |
| 決議日期 | 2026-11-09 |
| 影響範圍 | LLM 模型服務、設定頁、最低 macOS 版本 |
| 取代 | 2026-11-06 的規格 `plan-apple-intelligence-provider`（已移出 `main`） |

## Context

2026-11-06 曾規劃在「LLM 模型服務」新增 Apple Intelligence（裝置上），用 macOS 內建的 FoundationModels 在本機整理文字，並完成橋接方式研究、品質實測、設定頁 demo 與 6 張實作票。

## Decision

**不採用 Apple Intelligence，之後也不再評估。** 相關規格、研究、橋接 probe、評測與 demo 全數移出 `main`，完整內容封存在：

```
refs/archive/research/apple-intelligence   （0541b17）
```

取回方式：`git fetch origin 'refs/archive/*:refs/archive/*'`，再 `git switch -c research/apple-intelligence refs/archive/research/apple-intelligence`。

## Rationale

1. **回應不穩定。** 2026-11-06 以 SayIt 真實提示詞實測：5 組 12～24 字的短逐字稿中有 4 組被「劫持」或亂改（照指令寫信、回答問題、倒出詞彙表、憑空加條列），最嚴重的一次輸出為原文的 115 倍長、耗時 55 秒；中長文只套用部分修正；長文雖忠實但幾乎沒有校對。要補救得靠降級（限制字數、略過短紀錄），等於每個使用點都要另寫一套保護。
2. **成本遠大於效益。** 需要自寫 Swift 靜態庫與 `build.rs`、新增三個 IPC command、把整個 app 的最低 macOS 升到 13.0、再前置發布一個維護版擋住舊系統的自動更新，並改動「就緒閘門」等共用流程。
3. **雲端模型的費用本來就很低。** 語音 AI 文字整理每次只花極少費用，裝置上處理省下的成本幾乎沒有，「資料不離開 Mac」也不是目前使用者的訴求。

## Consequences

- LLM 模型服務維持 Groq、Google Gemini、OpenAI、Anthropic 四家雲端服務，行為與最低 macOS 版本不變。
- 之後若有人（或 agent）提議「改用裝置上模型」，先讀本 ADR 與封存的評測結果；只有出現與當時完全不同的條件（例如模型品質大幅躍進且不需要 Swift 橋接）才值得重開，並應另起新的 ADR。
