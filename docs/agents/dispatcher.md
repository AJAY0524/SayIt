# Dispatcher repo 設定（SayIt）

`/dispatcher` 在本 repo 的設定。流程本體在 user skill `~/.claude/skills/dispatcher/`，這裡只放本 repo 的判準與須知。

- repo：fork `AJAY0524/SayIt`（`gh` 一律帶 `-R AJAY0524/SayIt`，絕不寫入上游 `chenjackle45/SayIt`）。
- 主目錄：`~/Documents/AJ/Tools/SayIt/src`（git repo 在 `src/`；上一層是本機建置產物，不在版控內）。主幹 `origin/main`。
- 探勘筆記與認領登記：`~/.claude/dispatcher-notes/src/`。

## 風險判準

| 標籤 | 條件（任一成立） |
|---|---|
| `risk:high` | 改 `src-tauri/**` 的 Rust／Swift、IPC command 或 `build.rs`；改 `tauri.conf.json`、`Cargo.toml`、`.github/workflows/**`、自動更新（`src/lib/autoUpdater.ts`）；改錄音→轉寫→整理→貼上主流程（`src/stores/useVoiceFlowStore.ts`）的共用路徑；改 SQLite schema／migration；改 API key 或 LLM 呼叫閘門 |
| `risk:low` | 只改設定頁／Dashboard UI、i18n 文案、只對新 provider 生效的分支（雲端 provider 行為完全不變且有既有測試保護）、文件 |
| `hitl` | 發版（`./scripts/release.sh`、tag、push tag）、簽章公證、需要 AJ 的 Secrets、對上游或社群留言 |

`ready-for-human` 的票一律視同 `hitl`：只列人工待辦、不派。

## Preflight（dispatcher 派工前）

1. 主目錄 `git status` 乾淨、`main` 等於 `origin/main`。
2. 工具鏈：Node 24（`.nvmrc`）、pnpm 10.28.2（corepack）、Rust stable、Xcode／Swift 6.x。見下方「worker 須知」的 PATH 設定。
3. `gh auth status` 可寫 `AJAY0524/SayIt`。

## worker 須知

### 環境（每個 Bash 呼叫開頭）

本機 PATH 預設沒有 Node 24、pnpm、cargo：

```zsh
export PATH="$HOME/Library/Application Support/Herd/config/nvm/versions/node/v24.22.1/bin:$HOME/.cargo/bin:$PATH"
# pnpm 一律用 corepack 呼叫
corepack pnpm -v   # 應為 10.28.2
```

新 worktree 先跑 `corepack pnpm install --frozen-lockfile`。`pnpm-lock.yaml`、`Cargo.lock` 被 hook 硬擋，**不可手改**；需要新增套件或 feature 而造成鎖檔變動時，停下回報。

### 驗證指令（pre-commit，照 `docs/development-guide.md` §八）

```zsh
corepack pnpm test
npx vue-tsc --noEmit
corepack pnpm exec eslint src
cd src-tauri && cargo clippy --workspace --all-targets -- -D warnings && cargo test
```

- 改 IPC（Rust command、Event、Payload 型別）：交付前用 `tauri-reviewer` subagent（`.claude/agents/tauri-reviewer.md`）雙端對齊審查。
- 必讀規則依改動區域讀 `.claude/rules/{ipc,ui,i18n,release,windows}.md`（Codex／subagent 不會自動載入）。
- 用語照根目錄 `GLOSSARY.md`；ADR 扁平命名 `docs/adr-<slug>.md`，不建 `docs/adr/`。

### 本 repo 與上游流程的差異

`CLAUDE.md` 的「不 push、社群 PR squash 進 local main、codex 計劃閘／實作閘」是上游協作規則。在 fork 由 dispatcher 派工時改用：

- 推分支到 `origin`（fork）、開 PR、以 `--no-ff` 合併（前例：#21、#22）。
- 審查一律走 `~/.claude/scripts/review.zsh`（取代 codex 雙閘）；Commit Message 先經 AGY 審。
- 不 tag、不跑 `./scripts/release.sh`、不改版本號（屬 `hitl`）。

### UI 實測

- 前端純邏輯以 Vitest 為準；UI 畫面要實際跑 `corepack pnpm tauri dev` 截圖附 PR。
- `pnpm tauri dev` 固定用 Vite port 1420，**同一時間只能有一個 worktree 跑**：包在鎖裡 `~/.claude/skills/dispatcher/scripts/dispatch-lock.zsh sayit-dev -- <指令>`，跑完就關。
- 原生視窗（HUD、設定頁、Dashboard）用 computer-use 截圖；session worker 才有這個工具，subagent 做不到就寫進最終回報第 3 項。
- 拍板 demo（`docs/demos/**`）是規格：大改版要逐項對照 demo，與文字衝突以 demo 為準（`.claude/rules/ui.md`）。

### 資料紅線

- `pnpm tauri dev` 與 AJ 已安裝的 SayIt 共用同一個 app identifier 與資料目錄（SQLite 歷史紀錄、`tauri-plugin-store` 內的 API key）。**不可刪除、重設或大量寫入**這些資料；測試用資料只寫 Vitest 的 mock。
- 不把 API key、`settings.json` 的內容印到對話、log、PR 或票上。
- 不動 `~/Documents/AJ/Tools/SayIt/` 上一層的 `SayIt.app*` 備份與 `build-install-sayit.zsh`。
- 實測前先結束已安裝的 SayIt（兩個實例會搶全域快速鍵），測完提醒 AJ 重開。

## 合併

- 一票一 PR，`--no-ff` 合進 `main`，PR 內文第一行 `Closes #<n>`。
- GitHub Actions `ci.yml`（macOS＋Windows）綠燈且審查欄全部 APPROVE 才合併。
