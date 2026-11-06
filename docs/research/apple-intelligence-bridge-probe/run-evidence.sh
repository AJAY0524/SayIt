#!/usr/bin/env zsh
export PATH="$HOME/.cargo/bin:$PATH" MACOSX_DEPLOYMENT_TARGET=13.0
cd /private/tmp/claude-501/fm-rust-probe-13
SDK26=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
show() { vtool -show-build "$1" | grep -E "minos|sdk" | tr -s ' ' | paste -sd' ' -; otool -L "$1" | grep -E "FoundationModels|Concurrency" | sed 's/(compat[^,]*, /(/'; }
echo '### arm64 / SDK 27.2: cargo build --release'; B=target/release/fm-rust-probe; show $B; timeout 200 $B --overflow 2>&1 | cut -c1-430
echo; echo '### arm64 / SDK 26.5: SDKROOT=...MacOSX26.5.sdk cargo build --release'; SDKROOT=$SDK26 cargo build --release --target-dir target-sdk26 2>&1 | tail -1; B=target-sdk26/release/fm-rust-probe; show $B; timeout 200 $B --overflow 2>&1 | cut -c1-430
echo; echo '### x86_64 / SDK 27.2: cargo build --release --target x86_64-apple-darwin (run under Rosetta)'; B=target/x86_64-apple-darwin/release/fm-rust-probe; file $B | cut -d: -f2; show $B; timeout 300 $B 2>&1 | cut -c1-430
echo; echo '### x86_64 / SDK 26.5'; SDKROOT=$SDK26 cargo build --release --target x86_64-apple-darwin --target-dir target-x64-sdk26 2>&1 | tail -1; B=target-x64-sdk26/x86_64-apple-darwin/release/fm-rust-probe; file $B | cut -d: -f2; show $B; timeout 300 $B 2>&1 | cut -c1-430
echo; echo '### windows: cargo check --release --target x86_64-pc-windows-msvc (swift not invoked)'; cargo check --release --target x86_64-pc-windows-msvc --target-dir target-win 2>&1 | tail -1
echo; echo EVIDENCE-DONE
