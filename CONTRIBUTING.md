# Contributing to durabl

Thank you for helping improve durabl. This project ships milestone gates with
real evidence (live Restate, real SIGKILL on crash paths). Keep changes focused
and gate-green.

## Prerequisites

- Node.js **>= 22.5** (built-in `node:sqlite`)
- macOS or Linux (harness uses `pkill` for cleanup)

Optional:

- Docker (M4 deploy-target gate and `docker compose` demo stack)
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` for live-provider hardening (`npm run gate:m4-live`)

## Development loop

```bash
npm install
npm run build
npm test              # M1 gate
npm run gate:m2       # fork
npm run gate:m3       # replay / offline export
npm run gate:m4       # neutrality
npm run gate:m5       # HITL + export
```

Typecheck only: `npm run typecheck`.

## Smoke (quickstart path)

Fast non-interactive check that install + the scripted demo work (not a substitute for gates):

```bash
npm run smoke
```

Runs `scripts/smoke-quickstart.sh` → `scripts/quickstart.sh` with `DURABL_SMOKE=1` and an isolated `DURABL_DATA_DIR`. Use before opening a PR when you only touched docs or packaging; run the relevant `gate:*` scripts for harness changes.

## Pull requests

1. Branch from `main` (`feat/<topic>`).
2. One logical change per PR; update `docs/build-status.md` if milestone evidence changes.
3. All gates relevant to your change must pass locally before review.
4. No secrets in commits (`.env` is gitignored). Use env vars only.

## Code conventions

- TypeScript ESM (`"type": "module"`).
- Side effects go through `fireEffect` with a derived `IdempotencyKey`.
- Substrate details stay in `harness/` and `service.ts`; public API in `index.ts`.
- Security baseline: no hardcoded credentials, localhost-by-default UI, generic errors to users.

## Questions

Open a GitHub issue with repro steps or gate logs. For funding / demo narrative, see `docs/FUNDING.md` and `docs/DEMO-NARRATIVE.md` on `main`.
