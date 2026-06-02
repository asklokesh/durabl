#!/usr/bin/env bash
set -euo pipefail

# Match package.json engines (>=22.5.0) and .nvmrc when nvm is available.
if command -v nvm >/dev/null 2>&1; then
  # shellcheck source=/dev/null
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm install
  nvm use
fi

node --version
npm install
npm run build

echo ""
echo "durabl dev container ready."
echo "  Restate CLI:        node_modules/.bin/restate"
echo "  Restate server:     node_modules/.bin/restate-server"
echo "  Gates start Restate automatically (see docs/DEVELOPMENT.md)."
echo "  Optional stack:     docker compose up --build"
