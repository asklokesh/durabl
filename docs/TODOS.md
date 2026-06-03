# durabl — deferred work (autoplan forward)

Tracked items explicitly **out of** the forward-phase plan in [`docs/plans/autoplan-forward-20260603.md`](plans/autoplan-forward-20260603.md). Do not treat these as blockers for the M0–M5 ship boundary unless scope is reopened with a new milestone.

**Forward phase:** `PLANNED — not started` (review only; see plan doc for P1–P3 candidates).

---

## NOT-PLANNED (product / architecture)

| Item | Status | Notes |
|------|--------|-------|
| **DBOS substrate (product)** | **PARTIAL** | File-export `JournalSource` (`dbosJournalSourceFromPath`) + `gate:dbos` / `test:dbos`; Postgres + DBOS SDK live reads **NOT RUN** |
| **Python SDK (full parity)** | NOT-PLANNED | MVP shipped in `python/` (read path + HTTP client); write/fork/Restate/PyPI remain |
| **Managed control plane** | documented MVP | [`docs/architecture/control-plane.md`](architecture/control-plane.md); no hosted service |
| **Offline HITL write** | **DONE** | `POST /api/hitl/input` queues locally; `POST /api/hitl/flush` replays on live reconnect |
| **M6 multi-tenant SaaS** | documented MVP | [`docs/architecture/m6-saas.md`](architecture/m6-saas.md); `DURABL_TENANT_ID` stub only |

---

## Explicitly deferred (forward phase)

| Item | Defer reason | Revisit when |
|------|--------------|--------------|
| **npm publish** | **BLOCKED:** `NPM_TOKEN` unset; `npm whoami` → 401; `npm publish` → PUT 404; `npm view durabl` → 404. Pack path ready (`private` removed, `publishConfig.access` public, `verify:npm-pack` PASS). Maintainer: set `NPM_TOKEN` or `npm login`, then `npm publish --access public` per [RELEASING.md](./RELEASING.md#publish-to-npmjsorg) | After first `npm view durabl version` shows `0.1.0`; align README registry row |
| **gbrain sync** | **PARTIAL** (2026-06-03): CLI `gbrain 0.42.21.0` installed; PGLite at `~/.gbrain/brain.pglite`; memory ingest OK (636 pages); code import OK with `gbrain sync --strategy code --source gstack-code-durabl-1e0321bd --no-embed` (245 files); worktree pin `.gbrain-source` (gitignored). **Blocked step:** `gstack-gbrain-sync` code stage exits 1 — `Embedding model "zeroentropyai:zembed-1" requires ZEROENTROPY_API_KEY` (no `OPENAI_API_KEY` / `VOYAGE_API_KEY` / `ZEROENTROPY_API_KEY` in env). **Unblock:** `export ZEROENTROPY_API_KEY=…` (or set another provider + `gbrain config set embedding_model …`), then `gbrain embed --stale` and re-run `bun run ~/.claude/skills/gstack/bin/gstack-gbrain-sync.ts`. Init used `--no-embedding` because no keys were set. Not a ship blocker |

---

## Related (optional, not deferred to this list)

- **TypeScript 6:** **DONE** — `typescript@^6`, `@types/node@^25`, `eslint@^10`; root `tsconfig` sets `"types": ["node"]` (TS6 no longer auto-includes `@types/*`); `npm run lint` added; M1 gate + typecheck pass locally
- **Live LLM keys / `gate:live`:** CONFIG-READY; SKIP exit 0 without keys (forward P2, not NOT-PLANNED)
- **CRIU / process fork / second substrate:** Explicitly defer per autoplan §4

---

## References

- Ship / NOT-PLANNED source: `docs/COMPLETION.md` (do not duplicate scope there)
- Autoplan forward review: `docs/plans/autoplan-forward-20260603.md` · baseline `069020d` · gate `docs/evidence/gate-all-20260603-015005.log`
- Remote: https://github.com/asklokesh/durabl
