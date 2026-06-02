#!/usr/bin/env bash
# Sequential full gate suite — one fresh DURABL_DATA_DIR, teardown between gates.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DURABL_DATA_DIR="${DURABL_DATA_DIR:-/tmp/durabl-gate-$$}"
echo "DURABL_DATA_DIR=$DURABL_DATA_DIR"

teardown() {
  local self=$$
  pkill -9 -f restate-server 2>/dev/null || true
  pkill -9 -f dist/service.js 2>/dev/null || true
  pgrep -f 'node.*dist/harness/run-' 2>/dev/null | grep -v "^${self}$" | xargs kill -9 2>/dev/null || true
  docker rm -f durabl-m4-restate 2>/dev/null || true
  for p in 8080 9070 9080 7879 17878 17879; do
    lsof -nP -iTCP:"${p}" -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  rm -f /tmp/durabl-harness.lock 2>/dev/null || true
  sleep 2
}

trap teardown EXIT

teardown

npm run typecheck
npm test

for g in gate:m2 gate:m3 gate:m4 gate:m5 gate:harden gate:hitl-ui; do
  teardown
  sleep 1
  npm run "$g"
done

teardown
echo "ALL GATES PASSED"
