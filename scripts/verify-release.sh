#!/usr/bin/env bash
# Fast pre-merge checks (typecheck). Full adversarial gates are separate.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> durabl verify-release"
echo "    Node $(node -v) (requires >= 22.5)"

if [[ ! -d node_modules ]]; then
  echo "==> npm install"
  npm install
fi

echo "==> npm run typecheck"
npm run typecheck

echo ""
echo "verify-release: typecheck PASS"
echo ""
echo "Full release gates (slow, run before merge when you have time):"
echo "  npm run gate:all"
echo ""
echo "Optional smoke:"
echo "  timeout 300 bash scripts/quickstart.sh"
echo "  npm run build && npm pack --dry-run"
