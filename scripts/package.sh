#!/usr/bin/env bash
#
# Package the eSheep extension into a ZIP ready to upload to the
# Chrome Web Store.
#
# The Web Store requires a ZIP whose manifest.json is at the archive root
# (not inside a folder). See https://developer.chrome.com/docs/webstore/prepare
#
# Usage:
#   scripts/package.sh             # build, then zip
#   scripts/package.sh --no-build  # zip only (reuse the existing dist/)
#
set -euo pipefail

cd "$(dirname "$0")/.."

BUILD=true
if [[ "${1:-}" == "--no-build" ]]; then
  BUILD=false
fi

if $BUILD; then
  echo "==> Building the extension (pnpm build)..."
  pnpm build
fi

# Runtime files the extension actually loads. Everything here must land at the
# ZIP root or in the same relative paths the manifest references.
files=(
  manifest.json
  animation.xml
  popup.html
  icons
  dist/content.js
  dist/popup.js
)

for f in "${files[@]}"; do
  if [[ ! -e "$f" ]]; then
    echo "error: missing '$f' — run the build first (or drop --no-build)." >&2
    exit 1
  fi
done

if ! command -v zip >/dev/null 2>&1; then
  echo "error: 'zip' is not installed (e.g. 'sudo apt install zip')." >&2
  exit 1
fi

# Bump the last segment of the manifest version (e.g. 0.0.0.1 -> 0.0.0.2)
# so every package build produces a fresh version.
version="$(node -e '
const fs = require("fs");
let text = fs.readFileSync("manifest.json", "utf8");
const manifest = JSON.parse(text);
const parts = manifest.version.split(".");
parts[parts.length - 1] = String(parseInt(parts[parts.length - 1], 10) + 1);
manifest.version = parts.join(".");
text = text.replace(/("version"\s*:\s*")[^"]*(")/, (m, p1, p2) => p1 + manifest.version + p2);
fs.writeFileSync("manifest.json", text);
process.stdout.write(manifest.version);
')"
out="esheep-v${version}.zip"

rm -f "$out"
echo "==> Creating $out"
zip -r -X "$out" "${files[@]}"

echo "==> Done: $out"
echo "    Upload it at https://chrome.google.com/webstore/devconsole"
