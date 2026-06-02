#!/usr/bin/env bash
# Verify the published tarball includes library, CLI, and web UI assets.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> durabl verify-npm-pack"

echo "==> npm run build"
npm run build

echo "==> npm pack --dry-run"
PACK_LIST="$(npm pack --dry-run 2>&1)"
echo "$PACK_LIST"

required=(
  "dist/index.js"
  "dist/index.d.ts"
  "dist/cli.js"
  "web/index.html"
  "README.md"
  "LICENSE"
)

missing=()
for path in "${required[@]}"; do
  if ! echo "$PACK_LIST" | grep -qF " ${path}" && ! echo "$PACK_LIST" | grep -qF $'\n'"${path}"; then
    missing+=("$path")
  fi
done

if ((${#missing[@]} > 0)); then
  echo "verify-npm-pack: FAIL — missing from tarball:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

# Dev-only paths must not ship (harness gates are OK under dist/harness).
for forbidden in src/ docs/ scripts/; do
  if echo "$PACK_LIST" | grep -qE "(^|[[:space:]])${forbidden}"; then
    echo "verify-npm-pack: FAIL — leaked dev path: $forbidden" >&2
    exit 1
  fi
done

echo ""
echo "verify-npm-pack: PASS"
