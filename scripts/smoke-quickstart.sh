#!/usr/bin/env bash
# Non-interactive smoke: isolated data dir, teardown, then scripts/quickstart.sh.
# Use locally or in CI: npm run smoke
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DURABL_DATA_DIR="${DURABL_DATA_DIR:-/tmp/durabl-smoke-$$}"
export DURABL_SMOKE=1

teardown() {
  pkill -9 -f restate-server 2>/dev/null || true
  pkill -9 -f dist/service.js 2>/dev/null || true
  for p in 8080 9070 9080 7879 17878 17879; do
    lsof -nP -iTCP:"${p}" -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  rm -f /tmp/durabl-harness.lock 2>/dev/null || true
  sleep 1
}
trap teardown EXIT

teardown
echo "==> durabl smoke (DURABL_DATA_DIR=$DURABL_DATA_DIR)"
bash scripts/quickstart.sh
teardown
echo "SMOKE PASSED"
