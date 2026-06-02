#!/usr/bin/env bash
# durabl quickstart — install, build, and run the scripted demo (M1+M2 narrative).
# For CI-style verification use: npm test && npm run gate:m2
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> durabl quickstart"
echo "    Node $(node -v) (requires >= 22.5)"

if [[ ! -d node_modules ]]; then
  if [[ "${DURABL_SMOKE:-}" == "1" ]] && [[ -f package-lock.json ]]; then
    echo "==> npm ci"
    npm ci
  else
    echo "==> npm install"
    npm install
  fi
fi

echo "==> npm run demo"
npm run demo

if [[ "${DURABL_SMOKE:-}" != "1" ]]; then
  echo ""
  echo "Done. Next:"
  echo "  npm run ui          # replay UI (live journal)"
  echo "  npm test            # M1 adversarial gate"
  echo "  npm run gate:m2     # M2 fork gate"
  echo "  durabl --help       # CLI"
fi
