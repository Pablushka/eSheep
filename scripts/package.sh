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

version="$(node -p "require('./manifest.json').version" 2>/dev/null || echo 'unknown')"
out="esheep-v${version}.zip"

rm -f "$out"
echo "==> Creating $out"
zip -r -X "$out" "${files[@]}"

echo "==> Done: $out"
echo "    Upload it at https://chrome.google.com/webstore/devconsole"
