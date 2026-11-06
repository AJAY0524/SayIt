# ADR：以自寫 Swift 靜態函式庫橋接 Apple Intelligence（FoundationModels）

| 項目 | 內容 |
|------|------|
| 狀態 | Accepted（2026-11-06；擁有者 AJ 授權「依你的專業判斷自主決策」，由 Claude 代為決定） |
| 對應票 | AJAY0524/SayIt#6（地圖 #2）；前置研究 #3、#4 |
| 影響範圍 | macOS 建置（`src-tauri/build.rs`、新增 Swift 套件）、`tauri.conf.json`、CI／release、最低系統版本、IPC 契約 |
| 實作狀態 | **尚未實作**。本票只做決策與探針，未改動 SayIt 任何原始碼，所有檔案皆未 commit |
| 探針 | `docs/research/apple-intelligence-bridge-probe/`（可獨立 `cargo build` 的最小範例，非 SayIt 程式碼） |

> **路徑說明**：派工指示寫的是 `docs/adr/0001-...`，但本 repo 的 `docs/agents/domain.md` 明文規定「新增 ADR 沿用扁平命名 `docs/adr-<slug>.md`，不要另開 `docs/adr/` 造成兩套並存」，且目標是能整包 PR 回上游，所以本檔採扁平命名。若 AJ 偏好編號目錄，只需搬檔並更新引用。

## 狀態

Accepted。實作拆票由地圖 #2 的最後一張規格票處理。

## 背景

SayIt 要在「LLM 模型服務」新增 Apple Intelligence 選項。FoundationModels 是純 Swift 框架（無 Objective-C 標頭），Rust 無法直接呼叫，必須自建 Rust↔Swift 橋接。前置研究已有結論：

- #3（`docs/research/apple-intelligence-bridge.md`）：建議自寫 Swift 靜態函式庫、以 `@_cdecl` 匯出 C ABI；`objc2` 不可行；現成 crate（`fm-rs`、`foundation-models`、`afmize`）各有「Intel 不能編」或「部署目標 26 造成強連結」等問題；sidecar 為備案。
- #4（`docs/research/foundation-models-api.md`）：最低 macOS 26.0；`contextSize` 26.x 為 4096、27 實測 8192；`Response.usage`、`LanguageModelError` 僅 macOS 27 SDK 有；支援 zh-TW。

#6 開工前補充了兩點，本票據此處理：

1. #3 沒有實際跑過 Rust 端連結（當時以為沒有 cargo）。cargo 其實在 `~/.cargo/bin`，所以這次用最小 Rust 探針把 Rust 端的連結、執行、取消、錯誤分類都驗證掉。
2. CI 的 `macos-latest` 只有 SDK 26.5（Xcode 26.6），而 `Response.usage`、`LanguageModelError.contextSizeExceeded` 要 macOS 27 SDK，需決定怎麼處理。

本機環境：macOS 27.2、只有 Command Line Tools（無完整 Xcode）、Swift 6.4.2、`CommandLineTools/SDKs` 內同時有 `MacOSX26.5.sdk` 與 `MacOSX27.2.sdk`。後者讓我們能在本機用 `SDKROOT` 重現 CI 的 SDK 26.5 編譯。

## 決策

### D1. 橋接方式：自寫 Swift Package（靜態函式庫）＋ `public @_cdecl` C ABI，直接連進主執行檔

- 不使用 `objc2`、不用現成 FoundationModels crate、不用 sidecar。
- Swift 端只暴露四個 C 函式：`sayit_fm_availability`、`sayit_fm_generate`（JSON 請求＋單一回呼）、`sayit_fm_cancel`、`sayit_fm_build_info`。回呼契約：每次 `generate` 呼叫**恰好觸發一次**，`kind` 為 0 成功、1 錯誤、2 已取消，payload 為 JSON 字串。
- 所有 `@_cdecl` 函式必須標 `public`（swift-rs 對 Xcode 27 的註解提到未標 `public` 會被內部化；本機 `nm` 確認 `public` 版本為全域符號 `T`）。
- FoundationModels 一律包在 `#if canImport(FoundationModels)` 與 `if #available(macOS 26.0, *)` 內，部署目標 = app 最低版本（見 D4），因此框架被連結器標為 weak，macOS 26 以下仍可啟動。

### D2. 建置：不用 swift-rs，改在 `src-tauri/build.rs` 自帶約 60 行的 `swift build` 呼叫

swift-rs 1.0.9 的 `SwiftLinker` **在本機實際失敗**：`swift build` 成功，但 `cargo` 連結階段報 `ld: library 'SayItFM' not found`。原因（讀其 `build.rs` 並以實際產物位置核對）：

- swift-rs 以 `xcrun xcodebuild -version` 判斷是不是 Xcode 27；本機只有 CLT，`xcodebuild` 不存在（`xcrun: error: unable to find utility "xcodebuild"`），判斷為「否」，於是到舊版路徑 `<build-path>/arm64-apple-macosx/release` 找檔。
- 但 Swift 6.4 的 `swift build` 預設已是 Swift Build 引擎（`--build-system` 預設 `swiftbuild`），產物在 `<build-path>/out/Products/Release/libSayItFM.a`。
- 另外從原始碼讀到（**未實測**）：`--arch` 用的是 `std::env::consts::ARCH`（build script 的**主機**架構）而非目標架構；Xcode 27 需要 rustup 的 `llvm-tools` 元件才能還原被內部化的 `@_cdecl` 符號（CI 的 `dtolnay/rust-toolchain@stable` 預設不裝）。
- `swift-rs 1.0.7` 已是 `Cargo.lock` 的間接相依套件（tauri、tauri-plugin-log、tauri-utils）；直接相依 1.0.9 會動到鎖檔，而本 repo 的 hook 對 `Cargo.lock` 是 hard block。

決策：自寫 `build.rs` 片段，**不新增任何 crate**，作法如下（完整程式碼見探針的 `build.rs`）：

```
if CARGO_CFG_TARGET_OS != "macos" { return }            // 以「目標」OS 判斷，不用主機 cfg
swift build -c <debug|release> --triple <arch>-apple-macosx<MIN> \
            --sdk <SDKROOT 或 xcrun --show-sdk-path> --build-path $OUT_DIR/swiftpm
swift build ...同參數... --show-bin-path   // 與 SwiftPM 版本、build system 無關地取得產物目錄
cargo:rustc-link-search / link-lib=static=SayItFM
# 另外補上：/usr/lib/swift、<toolchain>/lib/swift/macosx（xcrun --find swiftc 推得）、
#          clang_rt.osx（clang --print-resource-dir，`#available` 需要 ___isPlatformVersionAtLeast）
```

- 目標架構取自 `CARGO_CFG_TARGET_ARCH`，因此在 arm64 runner 上交叉編 `x86_64-apple-darwin` 是正確的（探針實測）。
- 尊重 `SDKROOT`，所以能在本機用 SDK 26.5 重現 CI。
- 取捨：這段 build 邏輯變成我們自己維護；換來的是在 CLT-only（AJ 的開發機）與 Xcode 皆可建置、不動 `Cargo.lock`、不需 `llvm-tools`。若上游維護者偏好 swift-rs，替換是機械式的（輸入輸出相同）。

### D3. Swift 套件位置與 Rust 模組

- Swift 套件：`src-tauri/swift/SayItFM/`（`Package.swift`＋`Sources/SayItFM/Bridge.swift`），產物一律寫到 `$OUT_DIR`，不在 repo 內產生 `.build/`。放在 `src-tauri/**` 之下，自動落入 `.claude/rules/ipc.md` 的適用範圍與 `tauri-reviewer` 審查範圍。
- Rust 模組：`src-tauri/src/plugins/apple_intelligence.rs`。macOS 才有真實作；其他平台提供同簽章的 stub（availability 回 `unsupported_platform`、generate 回錯誤），讓 `invoke_handler` 清單與 IPC 契約跨平台一致，前端仍依平台決定是否顯示選項（Windows 完全不顯示，已於地圖 #2 定案）。

### D4. 最低 macOS：13.0

- `bundle.macOS.minimumSystemVersion` 設為 `"13.0"`（目前未設定，Tauri 預設 `10.13`；現有 arm64 執行檔實際 `minos` 已是 11.0，見下方探針）。
- `Package.swift` 的 `platforms`、`build.rs` 的 `MACOS_MIN`、`MACOSX_DEPLOYMENT_TARGET` 必須三者一致。
- 理由：
  1. Swift Concurrency 執行階段 `libswift_Concurrency.dylib` 在探針中是**強**載入（非 weak），系統內建版本從 macOS 12 起才有，所以下限至少 12。
  2. 12.0 在 Swift 6.4 工具鏈上 x86_64 會連結失敗：`Undefined symbols ... __swift_FORCE_LOAD_$_swiftCompatibility56`，因為 CLT 的 `libswiftCompatibility56.a` 沒有 x86_64 切片（`ld: ... fat file missing arch 'x86_64', file has 'arm64,arm64e'`）。可用 `-Xswiftc -runtime-compatibility-version -Xswiftc none` 繞過（探針實測 12.0＋此旗標可編可跑），但那是為了遷就工具鏈的 hack，且會讓實際下限落在「後移植墊片不存在的 12.x」，無法在本機驗證。**13.0 不需要任何旗標**，arm64 與 x86_64 都乾淨編過（僅剩 x86_64 的 `libswiftCompatibilityPacks.a` 被忽略的無害警告）。
  3. macOS 12 已於 2024 年停止維護；對一個 2026 年新增的 Apple Intelligence 功能而言，13.0 是合理的整體下限。
- 這是**使用者可見的變更**：整個 app（不只 Apple Intelligence 選項）會無法在 macOS 12 以下啟動；Tauri updater 無法依系統版本過濾更新，舊系統使用者會被 `LSMinimumSystemVersion` 擋在啟動之外。需要在 CHANGELOG、更新摘要與（視需要）`docs/community-commitments.md` 明講。備案：若 AJ 想保留 macOS 12，改回 12.0＋上述旗標，其餘決策不變。
- `MACOSX_DEPLOYMENT_TARGET` 的來源：讀 `tauri-build 2.5.5` 的 `src/lib.rs`（約第 574 行），非 `tauri dev` 時會把 `minimumSystemVersion` 以 `cargo:rustc-env=MACOSX_DEPLOYMENT_TARGET` 傳給 rustc；**此行為僅讀原始碼，未實跑 `tauri build` 驗證**。`tauri dev`、`cargo clippy`、`cargo test` 不會有這個環境變數，Rust 預設 arm64 是 11.0，會出現「object file was built for newer macOS (13.0) than being linked (11.0)」警告（探針第一次實測到的就是這個）。因此另加 `src-tauri/.cargo/config.toml` 的 `[env] MACOSX_DEPLOYMENT_TARGET = "13.0"`（`force` 預設 false，允許外部覆寫）。實作票需實測確認。

### D5. Rust 對外介面與取消：三個 command、無 event、v1 不串流

- **不串流（v1）**：五個使用點（整理、語音改寫、歷史重整、學詞彙、連線測試）都是拿到完整文字後才貼上或解析，HUD 也沒有逐字顯示需求；非串流讓 IPC 與錯誤路徑都最簡單。ABI 是「JSON 請求＋帶 `kind` 的回呼」，日後要串流只需新增 `kind = 3`（partial）與一個 Rust event，屬加法，不破壞現有契約。
- **結構化輸出**（`analyzeCorrections` 要 JSON）：請求 JSON 保留擴充欄位（例如 `schema`），Swift 端以 #4 驗證過的 `DynamicGenerationSchema` 實作；是否採用與何時降級由後續品質實測票決定，不在本 ADR 範圍。
- Tauri commands（實作票需同步更新 `.claude/rules/ipc.md` 的表，本票**未修改**）：

| Command | 參數 | 回傳 |
|---------|------|------|
| `apple_intelligence_availability` | — | `AppleIntelligenceAvailability`：`{ state: "available" }` 或 `{ state: "unavailable", reason }`，`reason` ∈ `os_too_old`／`device_not_eligible`／`apple_intelligence_not_enabled`／`model_not_ready`／`unknown`／`unsupported_platform` |
| `apple_intelligence_generate` | `request_id: String, request: { instructions?, prompt, temperature?, maxTokens? }` | `Result<{ text, inputTokens: Option<u32>, outputTokens: Option<u32> }, { code, message }>` |
| `apple_intelligence_cancel` | `request_id: String` | `()` |

- **`AbortSignal` 對應**：`request_id` 由前端產生（`crypto.randomUUID()`），讓前端在 promise 結算前就能取消。provider 轉接層：`signal.addEventListener('abort', () => invoke('apple_intelligence_cancel', { requestId }), { once: true })`；signal 已是 aborted 時不呼叫 generate 直接拋 `AbortError`；Rust 回 `code: "cancelled"` 時轉接層轉成 `AbortError`，與現有 `fetch` 路徑的取消語意一致。
- Rust 內部：`AppleIntelligenceState { inflight: Mutex<HashMap<String, i64>> }`（`request_id` → Swift handle）；**呼叫 `sayit_fm_generate` 與寫入 map 在同一把鎖內**，`cancel` 取同一把鎖，避免「取消比註冊早到」的競態。回呼（任意執行緒）只做一件事：把結果送進 `tokio::sync::oneshot`，並 `Box::from_raw` 回收 `ctx`。需把 `tokio` 的 `sync` feature 加進 `Cargo.toml`（目前只有 `time`）。另設逾時（建議 60 秒）到期就走 cancel 路徑。
- **取消是真的會中止模型運算**：探針在生成中 300 ms 呼叫 cancel，回呼在 1～6 ms 後以 `kind=2` 抵達（四種建置組合皆然）（改善 #3「只證明回 cancelled、不證明提早返回」的未驗證項）。取消已結束或不存在的 handle 為無害 no-op（探針實測）。
- 錯誤碼（Swift 端映射，`code` 字串）：`cancelled`、`context_size_exceeded`（附 `context_size`／`token_count` 於 macOS 27 SDK 建置）、`guardrail`、`unsupported_language`、`model_not_ready`、`rate_limited`、`busy`、`refusal`、`os_too_old`、`sdk_without_foundation_models`、`bad_request`、`unknown`。全部沿用既有失敗流程（貼原文＋提示），**不得自動改走雲端**。
- 預設用 `SystemLanguageModel(guardrails: .permissiveContentTransformations)`；每次請求建立新的 `LanguageModelSession`（避開 `concurrentRequests`）。這兩點延續 #4 的結論。

### D6. CI 與 SDK 落差：不鎖 runner、不鎖 Xcode，以 SDK 條件編譯隔離 macOS 27 專屬 API

- Swift 端用 `#if canImport(FoundationModels, _version: 2.0)` 隔離 `LanguageModelError.contextSizeExceeded` 與 `Response.usage`（SDK 26.5 的 FoundationModels 模組版本為 `1.5.2`，SDK 27.2 為 `2.1.14`，讀自各 SDK 的 `.swiftinterface` 檔頭 `-user-module-version`），執行期再加 `#available(macOS 27.0, *)`。
- 錯誤分類**兩套都要接**（探針實測，同樣在 macOS 27.2 上執行、同樣的超長輸入）：
  - SDK 27.2 建置：丟出 `FoundationModels.LanguageModelError`，可取得 `context_size=8192`、`token_count=56055`。
  - SDK 26.5 建置：丟出 `FoundationModels.LanguageModelSession.GenerationError`（舊 API 的 `exceededContextWindowSize`），沒有數字。
  - 兩者都被映射成 `context_size_exceeded`。
- **明確後果**：CI 的 release 用 `macos-latest`（SDK 26.5），所以**所有正式發行版都是 `fm=sdk26` 建置，`inputTokens`／`outputTokens` 一律為 `null`——連 macOS 27 的使用者也一樣**（探針：SDK 26.5 建置在 macOS 27.2 上 `input_tokens:null`）。這與地圖 #2 已定案的「API 不回傳 token 就記 null，不自行估算」一致。等 `macos-latest` 內建 Xcode 27，條件編譯自動切換，不需改程式碼。
- 備案：`_version:` 是底線開頭的非公開屬性，若未來失效，退到 `build.rs` 以 `xcrun --show-sdk-version` 判斷後用 `-Xswiftc -DSAYIT_SDK_27` 傳入（比 `#if compiler(>=6.4)` 準確，因為後者看的是編譯器而不是 SDK）。
- CI 變更面：`rust-check` 在 `macos-latest` 跑 `cargo clippy`／`cargo test` 時會經 `build.rs` 自動編 Swift，不需新 job；新增一個 `availability()` 冒煙測試（驗證 weak link 與可用性路徑在 runner 上不崩潰，CI 虛擬機預期回傳不可用類狀態），需要真實模型的生成測試標 `#[ignore]` 僅在本機跑。Swift 產物在 `$OUT_DIR`，理論上會被 `swatinem/rust-cache` 一併快取（**未驗證**）。`release.yml` 的 arm64／x64 兩個 job 不需改動 runner。

### D7. Windows 完全不碰

- `build.rs`：以 `CARGO_CFG_TARGET_OS` 判斷，非 macOS 立即 `return`，不呼叫 `swift`。
- Rust：整個真實作放在 `#[cfg(target_os = "macos")]` 模組，其他平台僅 stub（見 D3）。
- 探針實測：`cargo check --release --target x86_64-pc-windows-msvc` 通過（`build.rs` 直接 return，沒有呼叫 `swift`）。實作票需讓 `windows-latest` 的 `rust-check` 持續綠燈。

## 探針證據

探針原始碼：`docs/research/apple-intelligence-bridge-probe/`（`build.rs`、`swift/SayItFM/`、`src/main.rs`）。工作目錄為 `/private/tmp/claude-501/fm-rust-probe-13`，環境 `PATH="$HOME/.cargo/bin:$PATH"`、`MACOSX_DEPLOYMENT_TARGET=13.0`，`[profile.release]` 與 SayIt 相同（`panic="abort"`、`codegen-units=1`、`lto=true`、`opt-level="s"`、`strip=true`）。

### 1. swift-rs 1.0.9 在本機失敗（第一次嘗試）

```
$ xcrun xcodebuild -version
xcrun: error: unable to find utility "xcodebuild", not a developer tool or in PATH
$ cargo build --release        # build.rs 使用 swift_rs::SwiftLinker::new("12.0").with_package(...)
ld: warning: search path '.../out/swift-rs/SayItFM/arm64-apple-macosx/release' not found
ld: library 'SayItFM' not found
$ find target -name 'libSayItFM.a'
.../out/swift-rs/SayItFM/out/Products/Release/libSayItFM.a
```

### 2. 12.0＋x86_64 在 Swift 6.4 工具鏈失敗（促成 D4）

```
ld: warning: ignoring file '.../CommandLineTools/usr/lib/swift/macosx/libswiftCompatibility56.a': fat file missing arch 'x86_64', file has 'arm64,arm64e'
Undefined symbols for architecture x86_64:
  "__swift_FORCE_LOAD_$_swiftCompatibility56", referenced from: ... libSayItFM.a[2](SayItFM.o)
```

### 3. 最終方案（13.0）的建置與執行結果

指令（由 `run-evidence.sh` 依序執行，輸出整段如下；`show` 為 `vtool -show-build` 與 `otool -L` 的過濾輸出）：

```
### arm64 / SDK 27.2: cargo build --release
 minos 13.0  sdk 27.2
	/System/Library/Frameworks/FoundationModels.framework/Versions/A/FoundationModels (current version 2.1.14, weak)
	/usr/lib/swift/libswift_Concurrency.dylib (current version 0.0.0)
build_info=fm=sdk27 availability=1
[gen] handle=1 kind=0 4.435933333s payload={"input_tokens":94,"output_tokens":25,"text":"我們明天下午三點在會議室開會，討論資料庫遷移的事情。"}
[cancel] handle=2 cancel_called_at=303.887875ms callback_after=304.370208ms kind=2 payload={"code":"cancelled"}
[cancel-noop] ok
[overflow] kind=1 payload={"code":"context_size_exceeded","context_size":8192,"message":"Content contains 56055 tokens, which exceeds the maximum allowed context size of 8192.","token_count":56055,"type":"FoundationModels.LanguageModelError"}

### arm64 / SDK 26.5: SDKROOT=...MacOSX26.5.sdk cargo build --release
    Finished `release` profile [optimized] target(s) in 3m 51s
target-sdk26/release/fm-rust-probe:  minos 13.0  sdk 26.5
	/System/Library/Frameworks/FoundationModels.framework/Versions/A/FoundationModels (current version 1.5.2, weak)
	/usr/lib/swift/libswift_Concurrency.dylib (current version 0.0.0)
build_info=fm=sdk26 availability=1
[gen] handle=1 kind=0 9.566738708s payload={"input_tokens":null,"output_tokens":null,"text":"我們明天下午三點在會議室開會，討論資料庫遷移的事情。"}
[cancel] handle=2 cancel_called_at=303.289209ms callback_after=309.316417ms kind=2 payload={"code":"cancelled"}
[cancel-noop] ok
[overflow] kind=1 payload={"code":"context_size_exceeded","message":"Content contains 56055 tokens, which exceeds the maximum allowed context size of 8192.","type":"FoundationModels.LanguageModelSession.GenerationError"}

### x86_64 / SDK 27.2: cargo build --release --target x86_64-apple-darwin (run under Rosetta)
 Mach-O 64-bit executable x86_64
 minos 13.0  sdk 27.2
	/System/Library/Frameworks/FoundationModels.framework/Versions/A/FoundationModels (current version 2.1.14, weak)
	/usr/lib/swift/libswift_Concurrency.dylib (current version 0.0.0)
build_info=fm=sdk27 availability=1
[gen] handle=1 kind=0 8.234094625s payload={"input_tokens":94,"output_tokens":25,"text":"我們明天下午三點在會議室開會，討論資料庫遷移的事情。"}
[cancel] handle=2 cancel_called_at=302.462209ms callback_after=309.04625ms kind=2 payload={"code":"cancelled"}
[cancel-noop] ok

### x86_64 / SDK 26.5
    Finished `release` profile [optimized] target(s) in 3m 46s
 Mach-O 64-bit executable x86_64
target-x64-sdk26/x86_64-apple-darwin/release/fm-rust-probe:  minos 13.0  sdk 26.5
	/System/Library/Frameworks/FoundationModels.framework/Versions/A/FoundationModels (current version 1.5.2, weak)
	/usr/lib/swift/libswift_Concurrency.dylib (current version 0.0.0)
build_info=fm=sdk26 availability=1
[gen] handle=1 kind=0 31.380669125s payload={"input_tokens":null,"output_tokens":null,"text":"我們明天下午三點在會議室開會，討論資料庫遷移的事情。"}
[cancel] handle=2 cancel_called_at=305.659916ms callback_after=311.203625ms kind=2 payload={"code":"cancelled"}
[cancel-noop] ok

### windows: cargo check --release --target x86_64-pc-windows-msvc (swift not invoked)
    Finished `release` profile [optimized] target(s) in 13.60s
```

重點解讀：

- `FoundationModels` 在四種組合（arm64／x86_64 × SDK 27.2／26.5）都是 `weak`（`LC_LOAD_WEAK_DYLIB`）；`minos 13.0`。
- 連結、生成（zh-TW，輸出繁體）、取消（呼叫後 1～6 ms 內回呼 `kind=2`）、取消 no-op 都從 Rust 端驗證通過。
- SDK 27.2 建置有 token 數與 `context_size`；SDK 26.5 建置 token 為 `null`、錯誤型別為舊的 `GenerationError`（D6）。
- x86_64 版本在 Apple Silicon 上以 Rosetta 執行，且回報 `availability=1`；這**不代表**真實 Intel Mac 的行為。
- 同一份 `Bridge.swift` 在 SDK 26.5 與 27.2 兩種 SDK 下都能編譯。

## 考慮過的方案

| 方案 | 結論 | 理由 |
|------|------|------|
| A. 自寫 Swift 靜態函式庫＋自帶 `build.rs`（**採用**） | 採用 | 唯一同時滿足：Intel 目標可編、macOS 26 以下可啟動（weak）、CLT-only 與 Xcode 皆可建、CI SDK 26.5 可建、不增加簽章面積、不新增 crate |
| A'. 同 A，但用 swift-rs `SwiftLinker` | 否決 | 本機（CLT＋Swift 6.4）實際連結失敗；需要動 `Cargo.lock`；Xcode 27 需 `llvm-tools`；`--arch` 取主機架構（讀原始碼，未實測）。若上游偏好可機械式替換 |
| B. swift-bridge | 否決 | 為「3 個函式＋1 個回呼」引入橋接宣告與產生碼過重；取消非內建概念；CLT／x86_64 下的建置未驗證 |
| C. objc2 | 不可行 | FoundationModels 無 ObjC 標頭、無對應 crate（#3） |
| D. sidecar（`externalBin`） | 備案 | 優點是 Swift 當機不拖垮主程式、工具鏈完全解耦；缺點是每個架構一份、巢狀二進位的簽章與公證 Tauri 文件未說明、熱路徑多一層 IPC。介面（availability／generate／cancel）與 Swift 程式碼可原樣重用，只換傳輸層 |
| E. 直接相依 `fm-rs` | 否決 | `build.rs` 拒絕非 aarch64 目標，x64 release 會失敗 |
| F. 直接相依 `foundation-models` | 否決 | Swift 部分部署目標 26 → 強連結，macOS 25 以下無法啟動（推論，#3） |
| G. 直接相依 `afmize` | 否決 | 需要 Xcode 27／tools-version 6.4，CI 無法建置；無授權檔 |
| H. 最低 macOS 設 26（避開所有相容問題） | 否決 | 等於放棄整個 app 對 macOS 26 以下的使用者，遠超出一個選項的代價 |
| I. 最低 macOS 12.0＋`-runtime-compatibility-version none` | 備案 | 可行（探針實測），但是為遷就工具鏈的 hack（見 D4） |
| J. CI 改用有 Xcode 27 的 runner，或鎖 Xcode 版本 | 否決 | runner-images 目前沒有 Xcode 27（#3）；條件編譯已能同時支援兩種 SDK，且 runner 日後升級會自動受益 |

## 後果

### 正面

- 不增加任何 crate、不動 `Cargo.lock`；Swift 程式碼約 185 行、`build.rs` 片段約 60 行，邏輯集中。
- CLT-only 開發機與 CI 皆可建置；arm64／x86_64 皆可建；Windows 完全不受影響且不呼叫 `swift`。
- 取消路徑經實測可中止運算；錯誤碼穩定且與雲端失敗流程共用。
- 條件編譯讓 CI 現在可用 SDK 26.5，日後 runner 升級後自動啟用 macOS 27 的 token 統計。
- 保持可整包 PR 回上游：不改上游既有 command／event 契約，僅新增三個 command，新增檔案集中在 `src-tauri/swift/`、`plugins/apple_intelligence.rs`、`build.rs` 的 macOS 區段。

### 負面與風險

- **整個 app 的最低系統版本由 10.13（實際 arm64 為 11.0）升到 13.0**，且 updater 無法依系統版本過濾更新（D4）。需要 AJ／上游維護者接受，並在 CHANGELOG 與更新摘要講清楚。
- 我們自己維護一段 `build.rs` 的 Swift 建置邏輯；`_version:` 屬非公開條件編譯屬性（D6 備案）。
- 正式發行版（SDK 26.5 建置）的 token 統計一律為 `null`，直到 runner 具備 Xcode 27。
- `tokio` 需新增 `sync` feature；`.claude/rules/ipc.md` 與 `tauri-reviewer` 的範圍要更新；新增 `src-tauri/.cargo/config.toml`。

### 後續實作票必做

1. 新增 `src-tauri/swift/SayItFM/`、`build.rs` 的 macOS 區段、`plugins/apple_intelligence.rs`（含非 macOS stub）、三個 command 與 `.claude/rules/ipc.md` 更新；`tauri.conf.json` 設 `minimumSystemVersion`、新增 `.cargo/config.toml` 的 `MACOSX_DEPLOYMENT_TARGET`。
2. 實測 `pnpm tauri build`（是否真的把 `minimumSystemVersion` 傳成 `MACOSX_DEPLOYMENT_TARGET`、最終 `minos` 為 13.0）。
3. 實跑一次 `release.yml`（arm64＋x64）與一次完整簽章＋公證。
4. 「LLM 就緒」閘門、i18n 文案、降級策略、CHANGELOG 與 `docs/community-commitments.md`，依地圖 #2 的「尚未指定」清單處理。

### 未驗證項目（本 ADR 的限制）

- **真實 Intel Mac**：x86_64 只確認可編、可連結、在 Rosetta 下可執行；Intel 上應回 `device_not_eligible` 未實測。
- **macOS 13～25 實機啟動**：weak link 僅由 `otool -L` 推論；本機是 macOS 27.2。
- **GitHub Actions 實跑**：`macos-latest` 上的 `build.rs`、快取效果、`swatinem/rust-cache` 是否快取 `$OUT_DIR` 均未驗證；Swift 6.3 編譯器（Xcode 26.6）編譯 `Bridge.swift` 也未驗證（本機只有 Swift 6.4.2；已用 SDK 26.5 的 `.swiftinterface` 驗證 API 層面）。
- **Developer ID 簽章與公證**：本機無憑證，未做。
- **完整 Xcode 27**：`--show-bin-path` 設計上與產物結構無關，但只在 CLT 6.4.2 實測。
- **`tauri build` 對 `MACOSX_DEPLOYMENT_TARGET` 的實際傳遞**：僅讀 `tauri-build` 原始碼。
- **swift-rs 在 CI（Xcode 26.6）是否可用**：未驗證（本 ADR 沒有採用它，但上游若偏好需自行驗證）。
- 三種 `unavailable` 原因的實機重現（沿用 #4 的未驗證項）、`@Generable` 巨集路徑、繁簡偏向的統計結論。

## 後續修訂

> 2026-11-06，依 #8／#9 決策（`docs/research/apple-intelligence-decisions.md`）與規格 `docs/plan-apple-intelligence-provider.md`（#10）補充。**AJ 授權代決**。以下各點**取代**本文對應段落；未提到的決策（D1～D7 其餘內容）維持不變。

1. **Rust 逾時（D5）**：安全網由「建議 60 秒」改為 **120 秒**。前端依使用點主控逾時（最長 ③ 90 s），Rust 必須比前端最大值晚到，避免安全網先觸發。
2. **`apple_intelligence_generate` 新增職責（D5）**：Swift 端在呼叫模型前做 context 預檢（26.4+ 用 `tokenCount(for:)`、26.0～26.3 用字數估算），並把 `maxTokens` 夾限到 `contextSize − instructions − prompt − 8`。請求格式不變。
3. **錯誤 payload 欄位（D5）**：`context_size_exceeded` 擴充 `preflight`（預檢攔下為 true、生成途中溢位為 false）、`estimatedTokens`、`contextSize`、`tokenCount`（僅 SDK 27 建置的生成途中溢位）、`method`（`token_count`／`char_estimate`）。命名規則：Swift JSON 一律 snake_case（與探針 `input_tokens` 一致），Rust 以 serde 轉成 camelCase 後回給前端；前端只看 camelCase。
4. **結構化輸出（D5）**：v1 **不帶 `schema` 欄位**。④ 修正偵測沿用純文字 JSON 提示詞（實測純文字 24／24 優於 `DynamicGenerationSchema` 18／24）。
5. **不可用原因（D5 表格）**：`reason` 新增 `intel_mac`（Rust 以 `sysctl hw.optional.arm64` 判斷實體硬體，Rosetta 下的 x86_64 版不算 Intel）。判斷順序：`unsupported_platform` → `intel_mac` → `os_too_old` → FoundationModels 回報的原因；macOS 27 的 `SystemLanguageModel.Error.assetsUnavailable` 映射為 `model_not_ready`。
