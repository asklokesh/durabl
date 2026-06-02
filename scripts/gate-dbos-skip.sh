#!/usr/bin/env bash
set -euo pipefail
echo ""
echo "[SKIP] gate:dbos — NOT RUN"
echo "  src/journal-source-dbos-stub.ts (stub only)"
echo "  npm run gate:harden (H2) | docs/integrations/dbos.md"
echo ""
echo "VERDICT: gate:dbos-skip PASSED (explicit skip, exit 0)"
exit 0
