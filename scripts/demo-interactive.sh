#!/usr/bin/env bash
# Paced live-demo driver: same harness as `npm run demo`, with Enter-to-continue
# between acts and presenter cues from docs/DEMO-NARRATIVE.md.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  durabl interactive demo (~5 min with pauses)"
echo "  Narrative: docs/DEMO-NARRATIVE.md"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Tips:"
echo "    • Larger terminal font helps the room read ACT banners."
echo "    • At SIGKILL, pause until you press Enter — that silence is the hook."
echo "    • Unattended / CI: npm run demo  (no pauses)"
echo ""

if [[ ! -d node_modules ]]; then
  echo "==> npm install"
  npm install
fi

export DURABL_DEMO_PAUSE=1
export DURABL_DEMO_NARRATE=1
exec npm run demo
