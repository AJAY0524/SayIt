# Issue tracker：GitHub（fork `AJAY0524/SayIt`）

本 repo 的 issue 與 spec 放在 **fork `AJAY0524/SayIt` 的 GitHub Issues**（2026-11-06 開啟）。所有操作用 `gh` CLI。

## ⚠️ fork 防呆（先讀）

- 本 repo 是 `chenjackle45/SayIt` 的 fork；上游不是我們的 repo，**絕不在上游開票、留言、貼標籤**（對外留言一律先給 AJ 過目，見 `docs/development-process.md`）。
- 已執行 `gh repo set-default AJAY0524/SayIt`，但 fork 的 `gh` 仍可能誤指上游；**每個寫入指令都明確帶 `-R AJAY0524/SayIt`**。
- **fork 是公開 repo**：票、PR、留言、測試語料一律用改寫或合成的句子，不放真實聽寫內容或使用者資料；路徑一律寫 repo 相對路徑（如 `src/lib/enhancer.ts`）。
- `docs/community-commitments.md` 等文件裡的 `#83`、`#84` 是**上游**的 issue 編號，要讀時用 `gh issue view <n> -R chenjackle45/SayIt`（唯讀）。fork 自己的編號另起，且與 fork 的 PR 共用編號空間（例：fork 的 `#1` 是 PR）。

## 慣例

- **開票**：`gh issue create -R AJAY0524/SayIt --title "..." --body "..."`，多行內文用 heredoc。
- **讀票**：`gh issue view <number> -R AJAY0524/SayIt --json number,title,body,labels,comments`。
- **列票**：`gh issue list -R AJAY0524/SayIt --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，視需要加 `--label`、`--state`。
- **子票**：`gh issue create -R AJAY0524/SayIt --parent <parent> ...`，或事後 `gh issue edit <parent> -R AJAY0524/SayIt --add-sub-issue <child>`（本機 `gh` 2.102，支援）。不用子票時，在子票內文開頭寫 `Part of #<parent>`。
- **阻擋關係**：用 GitHub 原生 issue dependencies。`gh issue create -R AJAY0524/SayIt --blocked-by <n>,<n> ...` 或 `gh issue edit <child> -R AJAY0524/SayIt --add-blocked-by <blocker>`。無法使用時，在子票內文開頭寫 `Blocked by: #<n>, #<n>`。所有 blocker 關閉後才算解除阻擋。
- **數未解除的 blocker**：`gh api repos/AJAY0524/SayIt/issues/<n> --jq .issue_dependencies_summary.blocked_by`（只算 open，0 代表可開工）。
- **留言**：`gh issue comment <number> -R AJAY0524/SayIt --body "..."`
- **加／移標籤**：`gh issue edit <number> -R AJAY0524/SayIt --add-label "..."`／`--remove-label "..."`
- **關票**：先 `gh issue comment <number> -R AJAY0524/SayIt --body "..."` 說明，再 `gh issue close <number> -R AJAY0524/SayIt`。對已關閉的票用 `gh issue close --comment` 會吞掉留言但仍回 0。

## PR 作為 triage 來源

**PRs as a request surface: no.** _（若要把外部 PR 當功能需求納入 `/triage`，改成 `yes`。）_

設為 `yes` 時，PR 走同一套標籤與狀態，改用 `gh pr` 對應指令：

- **讀 PR**：`gh pr view <number> -R AJAY0524/SayIt`、`gh pr view <number> -R AJAY0524/SayIt --comments`、`gh pr diff <number> -R AJAY0524/SayIt`。
- **列外部 PR**：`gh api --paginate 'repos/AJAY0524/SayIt/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **留言／標籤／關閉**：`gh pr comment`、`gh pr edit --add-label`／`--remove-label`、`gh pr close`（都帶 `-R AJAY0524/SayIt`）。

GitHub 的 issue 與 PR 共用編號，單寫 `#42` 可能是兩者之一：先 `gh pr view 42`，失敗再 `gh issue view 42`。

## 當 skill 說「publish to the issue tracker」

在 `AJAY0524/SayIt` 開一張 GitHub issue。

## 當 skill 說「fetch the relevant ticket」

依上面「讀票」指令讀取。

## Wayfinding 操作

給 `/wayfinder` 用。**map** 是一張 issue，**child** 是它的子票。

- **Map**：一張貼 `wayfinder:map` 標籤的 issue，內文放 Notes／Decisions-so-far／Fog。`gh issue create -R AJAY0524/SayIt --label wayfinder:map`（標籤不存在時先 `gh label create`）。
- **Child ticket**：以 GitHub 子票掛在 map 下（見「子票」）。標籤 `wayfinder:<type>`（`research`／`prototype`／`grilling`／`task`）。認領後指派給負責人。
- **Blocking**：見「阻擋關係」。
- **Frontier**：列出 map 底下 open 的子票，去掉仍有 open blocker 或已有 assignee 的，依 map 順序取第一張。
- **Claim**：`gh issue edit <n> -R AJAY0524/SayIt --add-assignee @me`，必須是該 session 的第一個寫入動作。
- **Resolve**：`gh issue comment <n> -R AJAY0524/SayIt --body "<answer>"` → `gh issue close <n> -R AJAY0524/SayIt` → 在 map 的 Decisions-so-far 補一行指標（摘要＋連結）。
