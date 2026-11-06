#!/usr/bin/env zsh
# Build SayIt with a stable local self-signed identity and install it to /Applications (macOS only).
# Why: ad-hoc signing binds TCC grants (Accessibility, Mic) to a per-build hash, so every rebuild
# asks for permission again. A fixed certificate makes the designated requirement
# `identifier + certificate leaf`, so grants survive rebuilds.
#
# Usage:   scripts/build-install-local.zsh
# Env:     SAYIT_SIGN_NAME     certificate common name   (default: "LineVault Local Signing")
#          SAYIT_BACKUP_DIR    where the replaced app is moved (default: <repo parent dir>)
# Needs:   a code-signing identity of that name in the login keychain (not trusted is fine);
#          see ~/.claude/skills/aj-mac-local-signing for how it was created.
# Output:  not notarized, local use only. Release builds use the Developer ID flow in release.sh.
set -euo pipefail

repo="${0:A:h:h}"
sign_name="${SAYIT_SIGN_NAME:-LineVault Local Signing}"
backup_dir="${SAYIT_BACKUP_DIR:-${repo:h}}"
export PATH="$HOME/.cargo/bin:$PATH"

# Resolve the identity hash by name; never fall back to ad-hoc silently.
# Do not use `find-identity -v`: untrusted self-signed certs show as 0 valid there.
sign_id="$(/usr/bin/security find-identity -p codesigning | /usr/bin/awk -v n="\"$sign_name\"" '$1 ~ /^[0-9]+\)$/ && index($0, n) { print $2; exit }')"
[[ -n "$sign_id" ]] || { print -u2 "找不到簽章身分「$sign_name」，請先在 login keychain 建立自簽程式碼簽章憑證"; exit 1 }

# pnpm via corepack when pnpm is not on PATH
if ! command -v pnpm >/dev/null; then
  shim="$(/usr/bin/mktemp -d)"
  print -r -- '#!/bin/sh
exec corepack pnpm "$@"' > "$shim/pnpm"
  chmod +x "$shim/pnpm"
  export PATH="$shim:$PATH"
fi

cd "$repo"
corepack pnpm install --frozen-lockfile
# Override signing only on the command line; tauri.conf.json keeps the release settings.
corepack pnpm tauri build --bundles app \
  --config "{\"bundle\":{\"createUpdaterArtifacts\":false,\"macOS\":{\"signingIdentity\":\"$sign_id\"}}}"

new="$repo/src-tauri/target/release/bundle/macos/SayIt.app"
[[ -d "$new" ]] || { print -u2 "建置產物不存在：$new"; exit 1 }
/usr/bin/codesign --verify --strict "$new"
print -r -- "簽章需求（授權綁的是這個）："
/usr/bin/codesign -d -r- "$new" 2>&1 | /usr/bin/tail -1

/usr/bin/osascript -e 'tell application id "com.sayit.app" to quit' 2>/dev/null || true
sleep 3
backup="$backup_dir/SayIt.app.prev-$(date +%Y%m%d-%H%M%S)"
[[ -d /Applications/SayIt.app ]] && mv /Applications/SayIt.app "$backup"
/usr/bin/ditto "$new" /Applications/SayIt.app
/usr/bin/xattr -cr /Applications/SayIt.app
open /Applications/SayIt.app
print -r -- "完成。舊版備份：$backup"
