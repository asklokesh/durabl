#!/usr/bin/env bash
set -euo pipefail
npm run build
node --enable-source-maps dist/harness/run-dbos-gate.js
