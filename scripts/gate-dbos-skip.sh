#!/usr/bin/env bash
set -euo pipefail
# Runs file-export adapter gate, then documents Postgres/SDK NOT RUN.
bash "$(dirname "$0")/gate-dbos.sh"
