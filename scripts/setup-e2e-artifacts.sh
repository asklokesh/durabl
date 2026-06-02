#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p tests/fixtures tests/e2e
if [[ ! -s tests/fixtures/replay-offline.jsonl ]]; then
  if [[ -s docs/m3-evidence/portable-bundle.jsonl ]]; then
    cp docs/m3-evidence/portable-bundle.jsonl tests/fixtures/replay-offline.jsonl
  else
    echo "Generating M3 portable bundle…"
    npm run build
    node --enable-source-maps dist/harness/run-m3-gate.js
    cp docs/m3-evidence/portable-bundle.jsonl tests/fixtures/replay-offline.jsonl
  fi
fi
if [[ ! -s tests/fixtures/hitl-offline-paused.jsonl ]]; then
  node --input-type=module -e "
import { writeFileSync } from 'node:fs';
const runId = 'hitl-ui-offline-paused';
const lines = [
  { record: 'run_meta', schema: 1, runId, parentRun: null, forkedAtSeq: null, trajectory: 'main', createdAt: '2026-06-01T00:00:00.000Z' },
  { record: 'step', schema: 1, runId, seq: 1, stepName: 'step1-plan', kind: 'plan', idemKey: runId+':step1-plan', output: 'plan', sideEffect: false, seededFrom: null, recordedAt: '2026-06-01T00:00:01.000Z' },
  { record: 'step', schema: 1, runId, seq: 2, stepName: 'hitl-pause', kind: 'hitl_pause', idemKey: runId+':hitl-pause', output: { awaiting: 'hitl.input', planSoFar: 'plan' }, sideEffect: false, seededFrom: null, recordedAt: '2026-06-01T00:00:02.000Z' },
];
writeFileSync('tests/fixtures/hitl-offline-paused.jsonl', lines.map(o=>JSON.stringify(o)).join('\n')+'\n');
"
fi
