# 研究：Tauri v2 呼叫 Swift FoundationModels 的橋接方式與建置條件

> 對應 Issue：AJAY0524/SayIt#3（地圖 #2）。調查日期 2026-11-06。
> 本文只引用實際讀過的頁面或本機實測；實測腳本與產物位於 `/private/tmp/claude-501/fm-bridge-probe/`（不在 repo 內）。
> 凡未能驗證的主張標示「未驗證」。

## 0. 結論先講

- **FoundationModels 是純 Swift 框架，沒有 Objective-C 標頭**，所以 `objc2` 系列不可行（沒有可綁定的 ObjC 介面，`objc2` 也沒有對應 crate）。
- **建議方案：自己寫一個小型 Swift Package（靜態函式庫），以 `@_cdecl` 匯出 C ABI（含 callback 與取消），用 `swift-rs` 的 `SwiftLinker` 負責編譯與連結；部署目標維持 app 的最低系統版本，並以 `#available(macOS 26.0, *)` 把所有 FoundationModels 呼叫包起來。** 本機實測此做法在 CLT-only 環境能編出 arm64 與 x86_64，框架被自動 weak link，並可成功生成與取消。
- 現成 crate（`fm-rs`、`foundation-models`、`afmize`）可當範本，但**不建議直接相依**：它們的 Swift 部分以 macOS 26 為部署目標，會變成強連結（見 §3），不符合 SayIt「macOS 26 以下仍須能啟動」的要求。
- 本機 on-device 模型**不需要額外 entitlement**（實測 ad-hoc + hardened runtime 仍可執行）；只有 Private Cloud Compute 需要 Apple 發放的受管 entitlement。

## 1. 本機環境與 CI 環境事實

### 1.1 本機（Mac，僅 Command Line Tools）

| 項目 | 實測 |
|---|---|
| `xcode-select -p` | `/Library/Developer/CommandLineTools` |
| `swift --version` | `Apple Swift version 6.4.2`，`Target: arm64-apple-macosx27.2.0` |
| `sw_vers` | macOS 27.2（`26B123`） |
| `/Library/Developer/CommandLineTools/SDKs` | `MacOSX.sdk`、`MacOSX26.sdk`、`MacOSX26.5.sdk`、`MacOSX27.sdk`、`MacOSX27.2.sdk` |
| `xcodebuild -version` | 失敗：`tool 'xcodebuild' requires Xcode, but active developer directory ... is a command line tools instance` |
| `cargo` / `rustc` | 本機未安裝（`which cargo rustc` 無輸出），因此本研究**沒有**實際跑過 Rust 端連結，只用 C 主程式代替 Rust 驗證連結行為 |

CLT-only 能否編譯（實測）：
- `swiftc ... import FoundationModels` 可編譯、可執行，`SystemLanguageModel.default.availability` 回 `available`，`respond(to:)` 回出文字。
- `swift build -c release --triple arm64-apple-macosx13.0` 與 `--triple x86_64-apple-macosx13.0`（SwiftPM 靜態函式庫，tools-version 5.9）皆 `Build complete`，只有一則無害的 `ld: warning: search path '/Library/Developer/CommandLineTools/Developer/Library/Frameworks' not found`。
- `FoundationModels.framework` 在 SDK 內只有 `Modules/FoundationModels.swiftmodule`、`.swiftcrossimport` 與 `.tbd`，**沒有 `Headers/`**（`ls .../FoundationModels.framework/Headers` 回 `No such file or directory`）。

### 1.2 GitHub Actions `macos-latest`

來源（實際讀到）：
- <https://github.com/actions/runner-images>：`macos-latest` 對應 **macOS 26 Arm64**（標籤 `macos-latest` / `macos-26` / `macos-26-xlarge`）；Intel 映像為 `macos-26-intel`、`macos-15-intel`；macOS 14 映像於 2026-11-02 退役。
- <https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md>：OS 26.6.2；預設 Xcode **26.6**（另有 26.5、26.4.1、26.3、26.2、26.1.1、26.0.1）；SDK 清單到 **macOS 26.5**。**沒有 Xcode 27 / macOS 27 SDK。**
- <https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md>（對照）：預設 Xcode 16.4，SDK 到 26.2；不建議用於本需求。

含意：
- 目前 `release.yml` 的 `macos-latest`（含 `--target x86_64-apple-darwin` 在 arm64 runner 上交叉編譯）具備 Xcode 26.6 + macOS 26.x SDK，**足以編 FoundationModels 的 26.x API**。
- 需要 macOS 27 SDK 的 API（例如 PCC、工具呼叫、推理等）在 CI 上目前編不了；`afmize` 要求 Xcode 27 / Swift 6.4（其 `Package.swift` 為 `swift-tools-version: 6.4`），**CI 上無法使用**。
- 本機的 SDK 27.2 比 CI 新；本機能過不代表 CI 能過。實作時應以 26.x API 為界，或用條件編譯隔離 27 專屬 API。

## 2. 候選方案

### 2.1 objc2 綁定：不可行

- FoundationModels 無 `Headers/`（§1.1 實測），公開 API 以 Swift 語言特性（`async`、macro、泛型、result builder）提供，沒有 ObjC 執行階段介面可動態呼叫。
- `objc2` 儲存庫 `framework-crates/` 目錄下只有 `objc2-av-foundation`、`objc2-core-foundation`、`objc2-foundation`、`objc2-model-io`、`objc2-security-foundation`（`gh api repos/madsmtm/objc2/contents/framework-crates` 過濾 foundation/model），**沒有 FoundationModels**；crates.io 搜尋 `objc2-foundation-models` 結果為 0 筆。
- 結論：排除。

### 2.2 swift-rs

來源：<https://github.com/Brendonovich/swift-rs>、<https://raw.githubusercontent.com/Brendonovich/swift-rs/master/src-rs/build.rs>、crates.io API。

- Apache-2.0，343 stars，最新版 1.0.9（2026-10-10）。
- 作法：`build.rs` 用 `SwiftLinker::new("<macOS 最低版本>").with_package(name, path).link()`；Swift 端以 `@_cdecl` 匯出；Rust 端以 `swift!` 巨集或自行 `extern "C"` 宣告。README 說明 `SwiftLinker::new` 的版本要與 `Package.swift` 的平台一致。
- 實作細節（讀 `build.rs`）：執行 `swift build --sdk ... -c <config> --arch <arch>`，並以 `-Xswiftc -target <arch>-apple-macos<ver>` 覆寫目標；Rust target 為 `x86_64` 時對應 `x86_64-apple-macos...`，所以 **x86_64-apple-darwin 受支援**。
- 與 Tauri：README 提到 Tauri 的 `dyld: Library not loaded: @rpath/libswiftCore.dylib` 問題，解法是把 Tauri 最低系統版本設為 10.15 以上。Tauri 設定 `bundle.macOS.minimumSystemVersion` 預設為 `10.13`（<https://v2.tauri.app/reference/config/>），而 SayIt 的 `tauri.conf.json` 目前**沒有**設定它，所以採用本方案時要加上（建議至少 `12.0`，見 §3）。
- 限制：`swift!` 巨集只便於傳數字、布林、字串與資料；README 沒有涵蓋 async 與 callback。**對我們不是問題**：我們用純 C ABI（函式指標 callback + `i64` handle），不仰賴 `swift!` 的型別。
- Xcode 27 相容性：`swift-rs` 1.0.9 的 commit「Make the @_cdecl exports in lib.swift public so Xcode 27 release builds link」，以及 `build.rs` 內註解「Xcode 27's SwiftPM internalizes @_cdecl exports in static products ... Promote them back to global」，並有 `globalize_cdecl_symbols` 處理。**注意**：我們的 `@_cdecl` 函式務必標 `public`（本機實測 `public` 後 `nm` 顯示為 `T`，全域符號）。
- 本機 `swift build` 約 50–60 秒/架構（CLT，release，含 FoundationModels 的小型套件）；CI 首次建置需要考慮快取（`swatinem/rust-cache` 不快取 SwiftPM 的 scratch 目錄，未驗證，可另加 `actions/cache`）。

### 2.3 swift-bridge

來源：<https://chinedufn.github.io/swift-bridge/>、<https://chinedufn.github.io/swift-bridge/bridge-module/functions/index.html>、GitHub API。

- Apache-2.0，1150 stars，crates.io 最新 0.1.59（2026-01-06）。
- 支援 Swift `async` 函式被 Rust 呼叫：文件原文「You can call async Swift functions from Rust.」並說明會產生 callback 形式的 FFI 橋接 Swift async/await 與 Rust async/await；回傳 `Result<T, E>` 時 Swift 端必須用 typed throws（`throws(E)`，Swift 5.9+）。
- 建置整合（Xcode / swiftc / Swift Package）書中章節標題存在，但我讀到的頁面**沒有說明細節**；是否能在 CLT-only 與 x86_64 交叉編譯下運作：**未驗證**。
- 缺點：需要 `swift-bridge-build` 產生 Swift/C 膠水碼並維護 bridge module 宣告，對我們只需「3 個函式 + 1 個 callback」的需求偏重；取消（Task cancel）不是內建概念，仍要自己做 handle；其 async 方案無原生取消傳遞（文件未提，**未驗證**）。

### 2.4 Sidecar CLI（Tauri `externalBin`）

來源：<https://v2.tauri.app/develop/sidecar/>、<https://v2.tauri.app/distribute/sign/macos/>、本機實測。

- 作法：Swift 寫成獨立執行檔（本機 `swiftc` 產物 59 KB，`fm_arm`），以 `bundle.externalBin` 打包；每個目標都要有 `-$TARGET_TRIPLE` 後綴副本（例如 `...-aarch64-apple-darwin`、`...-x86_64-apple-darwin`；文件舉例 `my-sidecar-aarch64-apple-darwin`），Rust 以 `app.shell().sidecar("name").spawn()` 啟動並透過 `CommandEvent` 收 stdout。
- Tauri 文件**未說明**：`universal-apple-darwin` 的處理、sidecar 的簽章、子行程終止。這些屬「未驗證」。SayIt 的 release 用兩個獨立 target（arm64 / x64）各自打包，所以不涉及 universal。
- 簽章：Tauri macOS 簽章文件列出 `APPLE_SIGNING_IDENTITY`、`APPLE_CERTIFICATE`、`APPLE_ID` 等變數，**沒有提到 sidecar**。Hardened runtime 預設 `true`（config reference）。sidecar 作為 bundle 內的巢狀可執行檔需被簽章與公證涵蓋；Tauri 是否自動簽它：**未驗證**，需實測一次完整 notarize。
- 取消：Rust 端對 child 做 `kill()` 或寫入取消指令（`child.write`）；Tauri 文件只展示 `child.write(...)`，沒有講 kill，語意需自己定。Swift 端收到 SIGTERM 後要自行取消 Task。
- 優點：Swift 當機不會拖垮主程式；Swift 工具鏈與 Rust 連結完全解耦（避開 rpath、`libswiftCore`、Xcode 27 `@_cdecl` 等問題）；框架缺失時 sidecar 自己印出 `unavailable` 即可。
- 缺點：每次生成要啟動行程（或常駐 + 自訂 stdin/stdout 協定，要設計框架與逾時）；雙架構各打包一份；CI 要多一道「先編 sidecar 再重新命名」；簽章／公證面積變大；語音輸入的熱路徑（錄完立刻潤稿）多一層 IPC。

### 2.5 其他有實際開源範例的做法（以 swift-rs 或 swiftc 靜態函式庫 + C ABI 為底）

全部讀自 crates.io API 與 GitHub 原始碼：

| 專案 | 授權 / 規模 | 做法 | 與 SayIt 的相容性 |
|---|---|---|---|
| `fm-rs`（<https://github.com/blacktop/fm-rs>） | MIT，24 stars，crates.io 0.3.0（2026-08-16） | `build.rs` 呼叫 `swiftc` 編 Swift FFI 靜態函式庫，`cargo:rustc-link-lib=framework=FoundationModels`；README 要求 macOS 26+、Apple Silicon；有 session 取消 handle；`build.rs` 對非 aarch64 目標直接報錯「fm-rs requires Apple Intelligence hardware; unsupported target」 | **x86_64-apple-darwin 目標會建置失敗**，不能直接相依 |
| `foundation-models`（<https://github.com/doom-fish/foundation-models-rs>） | Apache-2.0，2 stars，crates.io 0.12.2（2026-10-26） | `build.rs` 呼叫 `swift build --triple <arch>-apple-macosx`（支援 x86_64 與 aarch64），`Package.swift` 設 `.macOS("26.0")`，連結 `libFoundationModelsBridge.a`；README：「Dropping a future cancels its generation」；README 要求 macOS 26+、Apple Silicon | 部署目標 26 → 強連結（§3 實測），舊系統會啟動失敗；x86_64 會編（tuple 支援） |
| `afmize`（<https://github.com/RyanGarber/afmize>） | 無授權檔（GitHub API `license: null`），1 star，2026-07 建立 | Swift 套件 + C ABI（`afmize_stream_start/cancel`、callback 逐事件回 JSON），README 的 Rust 段落使用 swift-rs `SwiftLinker::new("26.0")`；**README 沒有提到 Tauri**（這與搜尋摘要的說法不同，以原文為準） | `Package.swift` 為 `.macOS(.v26)` 且需要 Xcode 27 / tools-version 6.4：CI 無法建置、<26 會強連結；僅可當 C ABI 設計參考 |
| `fm-bindings` | 搜尋結果提及（<https://docs.rs/crate/fm-bindings/latest/source/README.md>） | 同樣是 `build.rs` 編 Swift bridge | 未深入讀原始碼，未驗證 |

> 搜尋結果頁（docs.rs）顯示過 `apple-intelligence-models`（aimx）等其他 crate，未逐一讀，不列入比較。

## 3. 相容性：macOS < 26 能不能啟動、x86_64 能不能編

這是整個調查的關鍵，全部用本機探針（`/private/tmp/claude-501/fm-bridge-probe/lib/`）驗證。

探針內容：`bridge.swift` 以 `@_cdecl` 匯出 `sayit_fm_available() -> Int32`（`1` 可用、`0` 不可用、`-1` 系統太舊）、`sayit_fm_start(prompt, ctx, cb) -> Int64`、`sayit_fm_cancel(id)`；FoundationModels 呼叫全部在 `if #available(macOS 26.0, *)` 與 `#if canImport(FoundationModels)` 內。以 `clang` 編 C 主程式並連結。

| 測試 | 指令摘要 | 結果 |
|---|---|---|
| 部署目標 13.0，arm64 | `swiftc -emit-library -static ... -target arm64-apple-macos13.0`，C 主程式 `-target arm64-apple-macos13.0` 連結 | `otool -L` 顯示 `.../FoundationModels (... , weak)`；`vtool` `minos 13.0`；執行輸出 `available=1`、`cb kind=0 text=Hello, friend.` |
| 部署目標 13.0，x86_64 | 同上 `x86_64-apple-macos13.0` | 編譯與連結成功（`Mach-O 64-bit executable x86_64`），`FoundationModels` 同樣為 `weak`。**未在 Intel Mac 上實際執行**（無此硬體），未驗證 |
| 部署目標 26.0 | `-target arm64-apple-macos26.0` | `otool -L` **沒有** `weak` 標記（強連結），`minos 26.0` |
| 26.0 靜態函式庫連進 13.0 主程式 | 混合 | 產生 `ld: warning: object file ... was built for newer 'macOS' version (26.0) than being linked (13.0)`，且框架仍為**強連結** |
| 額外加 `-framework FoundationModels` | 於 13.0 目標 | 仍為 `weak`（連結器依 SDK 的 `.tbd` 可用版本資訊自動 weak） |
| 取消 | `./t_arm c`（啟動後 20 ms 呼叫 cancel） | `cb kind=2 text=cancelled`，沒有 crash |

結論：
1. **Swift 靜態函式庫的部署目標必須是 app 的最低系統版本（不是 26）**，框架才會被連結器標為 weak；呼叫端以 `#available(macOS 26.0, *)` 擋掉。swift-rs 的 `SwiftLinker::new(<ver>)` 與 `Package.swift` 的 `platforms` 都要照此設定。
2. 第三方 crate 若把 Swift 部分編成 macOS 26 目標（`foundation-models-rs` 的 `Package.swift` 是 `.macOS("26.0")`；`afmize` 是 `.macOS(.v26)`），依上面的實測會變強連結，推論在 macOS 25 以下 dyld 會因找不到框架而讓整個 app 啟動失敗。**此推論來自 `otool -L` 的 weak 標記，未在真正的 macOS < 26 機器上驗證**（本機是 macOS 27.2）。
3. x86_64-apple-darwin：自寫 Swift 套件可編；在 Intel 上 Apple Intelligence 不支援（`foundation-models-rs` README 寫「Apple Silicon」），執行期應得到 `unavailable`（`deviceNotEligible`），**未實測**。`fm-rs` 的 `build.rs` 會直接拒絕非 aarch64 目標，故不能直接用。
4. 實務上 Intel 版與舊 macOS 一律走 `sayit_fm_available() != 1` → 前端隱藏／停用「Apple Intelligence」選項。

可用性判斷（Apple 官方資料，<https://developer.apple.com/tutorials/data/documentation/foundationmodels.json>）：FoundationModels 的 macOS 引入版本是 `26.0`；頁面說明使用者需要支援 Apple Intelligence 的裝置。`SystemLanguageModel.Availability.UnavailableReason` 有三種：`appleIntelligenceNotEnabled`、`deviceNotEligible`、`modelNotReady`（<https://developer.apple.com/tutorials/data/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum/unavailablereason.json>）。

## 4. 簽章、Entitlement、公證

- **On-device 模型不需要額外 entitlement。**
  - 證據一（本機實測）：`swiftc` 產出的 ad-hoc 簽章執行檔 `fm_arm` 可直接生成文字；再用 `codesign --force -s - -o runtime fm_hr`（hardened runtime，`flags=0x10002(adhoc,runtime)`）重簽，**沒有任何 entitlements**（`codesign -d --entitlements -` 無輸出），執行仍輸出 `availability: available` 與生成結果。
  - 證據二：`fm-rs` README 僅對 Private Cloud Compute 要求 `com.apple.developer.private-cloud-compute` 受管 entitlement，並說明 ad-hoc 簽章會被拒；on-device 無此需求（<https://github.com/blacktop/fm-rs> README）。
  - SayIt 現有 `Entitlements.plist` 只有 `com.apple.security.device.audio-input` 與 `com.apple.security.automation.apple-events`，**不需要新增**。
- **PCC**（macOS 27+）需 Apple 發放受管 entitlement 與 provisioning profile，且 Apple 設有資格條件（App Store Small Business Program 等，見 fm-rs README 引用 <https://developer.apple.com/private-cloud-compute/>）。與 Developer ID 發行的 SayIt 流程不合，**不建議納入範圍**。
- **Developer ID 簽章／公證**：
  - 靜態函式庫方案：Swift 程式碼最終在主執行檔內，不增加簽章對象，沒有額外步驟；Tauri 簽章流程（`APPLE_CERTIFICATE`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID` 等，<https://v2.tauri.app/distribute/sign/macos/>）不變。公證不會因連結 FoundationModels 而失敗的證據：**未驗證**（本機沒有 Developer ID 憑證，沒做公證）。
  - Swift runtime：靜態函式庫連結後，主執行檔相依於 `/usr/lib/swift/libswiftCore.dylib` 等系統內建 Swift runtime（`otool -L t_arm` 顯示 `/usr/lib/swift/libswift_Concurrency.dylib`），用 `-Wl,-rpath,/usr/lib/swift`（探針連結時使用）。swift-rs 的 README 因此建議 Tauri 最低版本設 10.15+（來源 §2.2）；各 macOS 版本實際內建的 Swift runtime 版本：未驗證。
  - Sidecar 方案：巢狀可執行檔需被簽章（hardened runtime）並含入公證；見 §2.4，Tauri 文件未明說，**未驗證**。

## 5. async、取消與錯誤傳遞

Swift 端：`LanguageModelSession.respond(to:)` 是 `async throws`。本機探針的做法：

- `sayit_fm_start` 建立 `Task`，以 `Int64` id 存進 `[Int64: Task]`（加鎖），立即回傳 id；Task 內 `await session.respond(to:)`，完成時呼叫 C callback。
- `sayit_fm_cancel(id)` 呼叫 `task.cancel()`；`respond` 結束後以 `Task.checkCancellation()` / `catch is CancellationError` 回報 `kind=2`。實測取消後 callback 收到 `cancelled`。**注意**：實測只證明「取消後 callback 回 cancelled」，不證明模型端運算被中止（我沒有量測 `respond` 在取消時是否提早返回；Apple 文件／探針皆無此資訊）。若需要「立刻放棄結果」，Rust 端用世代編號（generation id）丟棄過期結果即可，不仰賴 Swift 端提前返回。
- 錯誤：Apple 的 `LanguageModelSession.GenerationError` 有 `assetsUnavailable`、`decodingFailure`、`exceededContextWindowSize`、`guardrailViolation`、`rateLimited`、`refusal`、`concurrentRequests`、`unsupportedGuide`、`unsupportedLanguageOrLocale`（<https://developer.apple.com/tutorials/data/documentation/foundationmodels/languagemodelsession/generationerror.json>）。建議在 Swift 端把它們映射成穩定的字串錯誤碼（例如 `exceeded-context-window`、`guardrail`、`unsupported-language`），以 JSON 或 `(kind, code, message)` 經 callback 傳給 Rust。`afmize` 的錯誤事件格式（`code` + `message`，且錯誤後必有 `finish`）與 `foundation-models-rs`「dropping a future cancels its generation」可當設計參考。
- 同一個 `LanguageModelSession` 同時只能處理一個請求（`concurrentRequests` 錯誤；`foundation-models-rs` README 說明取消後下一個請求會等待收尾）。SayIt 每次潤稿建立新 session 即可避開。
- `unsupportedLanguageOrLocale`：SayIt 使用者多為繁體中文，需實測模型對 `zh-TW` 的支援，**未驗證**。

Rust 端對應：
- callback 在 Swift 的執行緒呼叫；`extern "C" fn` 內只做「把結果丟進 `tokio::sync::oneshot` / `mpsc`」，不要在 callback 裡碰 Tauri `AppHandle` 的非 `Send` 狀態；`ctx` 指標用 `Box::into_raw` 傳入，在終止呼叫（成功、錯誤、取消）時回收。
- 前端 `AbortSignal` → 新增一個 Tauri command（例如 `cancel_apple_intelligence`，需同步更新 `.claude/rules/ipc.md` 的 command 表）→ Rust 呼叫 `sayit_fm_cancel(id)`。
- 現有 `ipc.md` 的 command 回傳慣例為 `Result<T, String>` 或自訂錯誤列舉（例如 `TranscriptionError`），新增錯誤型別建議比照 `thiserror` 列舉並序列化為 `{ code, message }`。

## 6. 方案比較

| 方案 | x86_64 可編 | <26 可啟動 | 僅 CLT 可編 | CI（Xcode 26.6） | 簽章／公證面積 | async／取消 | 維護成本 |
|---|---|---|---|---|---|---|---|
| A. 自寫 Swift 靜態函式庫 + swift-rs（C ABI，部署目標 = app 最低版） | 是（實測） | 是（weak，`otool -L` 實測；舊 OS 實機未驗證） | 是（實測） | 可（需把 `@_cdecl` 標 `public`；快取需設計） | 不增加 | 自訂：Task + handle，實測可取消 | 低～中（約 100 行 Swift + 約 100 行 Rust） |
| B. swift-bridge | 未驗證 | 取決於 Swift 套件目標，同 A | 未驗證 | 未驗證 | 同 A | 內建 async 橋接，無取消語意 | 中～高（bridge 宣告與產生碼） |
| C. objc2 | — | — | — | — | — | — | **不可行**（無標頭、無 crate） |
| D. Sidecar（externalBin） | 是（需各架構一份） | 是（框架缺失只影響 sidecar） | 是 | 需加 sidecar 建置步驟 | 增加巢狀二進位，Tauri 是否自動簽：未驗證 | 行程間協定，kill 或協定取消 | 中（IPC、逾時、重命名、打包） |
| E. 直接相依 `fm-rs` | 否（build.rs 拒絕非 aarch64） | 未驗證 | 未驗證 | 未驗證 | 同 A | 有取消 handle | 低，但 x64 不能編 |
| F. 直接相依 `foundation-models` | 是（tuple 支援） | 否（部署目標 26 → 強連結，推論） | 未驗證 | 未驗證 | 同 A | drop future 即取消 | 低，但舊 macOS 會無法啟動 |
| G. 直接相依 `afmize` | 未驗證 | 否（`.macOS(.v26)`） | 否（需 Xcode 27 / tools 6.4） | 否（runner 無 Xcode 27） | 同 A | stream + cancel | 不適用 |

## 7. 建議

**採方案 A：自寫 Swift 靜態函式庫 + swift-rs，C ABI 只暴露 3 個函式（availability / start / cancel）。**

理由：
1. 唯一同時滿足「x86_64 仍可編、macOS 26 以下仍可啟動、CI（Xcode 26.6）可建、不增加簽章面積」的做法；現成 crate 都在其中至少一項失敗（§2.5、§3）。
2. 實測在 CLT-only 與 Xcode 26.6 runner 條件下都走得通（本機 CLT 已通；CI 以 runner-images 文件推定，未實跑）。
3. 取消與錯誤映射可依 SayIt 的 `AbortSignal` 與錯誤列舉需求量身設計，程式量小。
4. 避開 PCC／entitlement／provisioning profile 的複雜度；on-device 模型不需新增 entitlement。

實作時的硬性條件（寫給後續票）：
- `Package.swift`：`platforms: [.macOS("<app 最低版本>")]`，不得寫 26；FoundationModels 一律在 `#if canImport(FoundationModels)` 與 `if #available(macOS 26.0, *)` 內；`@_cdecl` 函式用 `public`。
- `build.rs`：`SwiftLinker::new("<同上>")`；`tauri.conf.json` 加 `bundle.macOS.minimumSystemVersion`（至少 10.15；實際值由產品決定）。
- 僅 macOS 編譯（`#[cfg(target_os = "macos")]`），Windows 路徑完全不碰；Intel 與舊 macOS 靠 `sayit_fm_available() != 1` 隱藏選項。
- CI：`release.yml` 的 arm64 與 x64 兩個 job 都需通過；首次實作必須實跑一次（含 `x86_64-apple-darwin` 交叉編譯）與一次公證。
- 在 macOS 25 以下實機（或虛擬機）至少啟動一次 App，驗證「可啟動且選項被隱藏」。這是本研究**唯一沒有驗證的關鍵風險**。

備案：若 swift-rs 在 CI 上遇到 SwiftPM／rpath 問題，退到方案 D（Sidecar），介面（availability / start / cancel）與 Swift 程式碼可以原樣重用，只換傳輸層。

## 8. 未驗證清單

- macOS < 26 實機啟動（只以 `otool -L` 的 weak 標記推論）。
- Intel Mac 實機執行（只驗證可編譯與連結）。
- GitHub Actions 上實際建置（僅依 runner-images 文件推定）。
- Developer ID 簽章 + 公證完整流程（本機無憑證）。
- Tauri 對 `externalBin` 巢狀二進位的簽章行為。
- swift-bridge 在 CLT-only 與 x86_64 的建置細節。
- `respond` 被取消時模型端是否提早中止。
- 繁體中文（`zh-TW`）輸入的模型支援度。
- Rust 端連結（本機沒有 `cargo`）；以 C 主程式代替驗證連結行為。
- SwiftPM scratch 目錄在 CI 的快取效果。

## 9. 來源清單

- 本機探針：`/private/tmp/claude-501/fm-bridge-probe/`（`lib/bridge.swift`、`lib/main.c`、`pkg/`），指令與輸出已摘錄於正文。
- Apple：<https://developer.apple.com/tutorials/data/documentation/foundationmodels.json>、<https://developer.apple.com/tutorials/data/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum/unavailablereason.json>、<https://developer.apple.com/tutorials/data/documentation/foundationmodels/languagemodelsession/generationerror.json>
- GitHub Actions runner images：<https://github.com/actions/runner-images>、<https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md>、<https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md>
- swift-rs：<https://github.com/Brendonovich/swift-rs>、<https://raw.githubusercontent.com/Brendonovich/swift-rs/master/src-rs/build.rs>、<https://docs.rs/swift-rs/latest/swift_rs/>
- swift-bridge：<https://chinedufn.github.io/swift-bridge/>、<https://chinedufn.github.io/swift-bridge/bridge-module/functions/index.html>
- objc2：<https://github.com/madsmtm/objc2>（`framework-crates/` 目錄）
- 開源範例：<https://github.com/blacktop/fm-rs>（`crates/fm-rs/build.rs`、README）、<https://github.com/doom-fish/foundation-models-rs>（`build.rs`、`swift-bridge/Package.swift`、README）、<https://github.com/RyanGarber/afmize>（README、`Package.swift`）
- Tauri：<https://v2.tauri.app/develop/sidecar/>、<https://v2.tauri.app/distribute/sign/macos/>、<https://v2.tauri.app/reference/config/>
- 專案內：`src-tauri/Cargo.toml`、`src-tauri/build.rs`、`src-tauri/tauri.conf.json`、`src-tauri/Entitlements.plist`、`.github/workflows/release.yml`、`.claude/rules/ipc.md`
