# Domain Docs

engineering skills 探索程式碼時，如何使用本 repo 的領域文件。版面：**single-context**（`pnpm-workspace.yaml` 只有 `onlyBuiltDependencies`，不是 monorepo）。

## 探索前先讀

- 根目錄的 **`GLOSSARY.md`**（目前尚未建立）。
- **ADR**：本 repo 既有 ADR 採扁平命名，放在 `docs/adr-<slug>.md`（例：`docs/adr-windows-vk-f23.md`、`docs/adr-claude-code-review-fork-pr.md`）；若日後出現 `docs/adr/` 目錄也一併讀。只讀跟這次要動的區域有關的。
- 較早的整體架構決策在 `_bmad-output/planning-artifacts/architecture.md`（歷史參考）。

上述檔案不存在就**直接略過**，不要提醒缺檔、也不要主動建議先建立。`/domain-modeling` skill（經由 `/grill-with-docs`、`/improve-codebase-architecture` 觸發）會在名詞或決策真的定案時才建立它們。

新增 ADR 時沿用既有的扁平命名 `docs/adr-<slug>.md`，不要另開 `docs/adr/` 造成兩套並存。

## 檔案結構

```
src/                      ← repo 根目錄
├── GLOSSARY.md           ← 待 /domain-modeling 建立
├── docs/
│   ├── adr-windows-vk-f23.md
│   └── adr-claude-code-review-fork-pr.md
└── src/
```

## 使用 glossary 的用語

輸出中提到領域概念時（issue 標題、重構提案、假設、測試名稱），用 `GLOSSARY.md` 定義的詞，不要換成 glossary 明確避免的同義詞。

需要的概念還不在 glossary 裡，代表兩種可能：你在發明專案沒在用的說法（重新考慮），或真的有缺口（記下來交給 `/domain-modeling`）。

## 標出與 ADR 的衝突

輸出若與既有 ADR 矛盾，要明講，不要默默推翻：

> _與 `docs/adr-windows-vk-f23.md`（Copilot 鍵 early-return）衝突，但值得重新討論，因為……_
