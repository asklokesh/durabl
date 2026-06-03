# durabl — deferred work (autoplan forward)

Tracked items explicitly **out of** the forward-phase plan in [`docs/plans/autoplan-forward-20260603.md`](plans/autoplan-forward-20260603.md). Do not treat these as blockers for the M0–M5 ship boundary unless scope is reopened with a new milestone.

**Forward phase:** `PLANNED — not started` (review only; see plan doc for P1–P3 candidates).

---

## NOT-PLANNED (product / architecture)

| Item | Status | Notes |
|------|--------|-------|
| **DBOS substrate (product)** | NOT-PLANNED | Stub + `gate:dbos-skip` only; no DBOS integration work |
| **Python SDK (full parity)** | NOT-PLANNED | MVP shipped in `python/` (read path + HTTP client); write/fork/Restate/PyPI remain |
| **Managed control plane** | documented MVP | [`docs/architecture/control-plane.md`](architecture/control-plane.md); no hosted service |
| **Offline HITL write** | NOT-PLANNED (by design) | `POST /api/hitl/input` → 503 offline; would require architecture change |
| **M6 multi-tenant SaaS** | documented MVP | [`docs/architecture/m6-saas.md`](architecture/m6-saas.md); `DURABL_TENANT_ID` stub only |

---

## Explicitly deferred (forward phase)

| **TypeScript 6** | Dependabot PR #3: `tsc` fails on TS6 without coordinated `@types/node` + config; stay on TS 5.x until upstream/typescript-eslint guidance | After TS6 + eslint10 lockfile validated in CI |



| Item | Defer reason | Revisit when |
|------|--------------|--------------|
| **npm publish** | **BLOCKED:** `NPM_TOKEN` unset; `npm whoami` → 401; `npm view durabl` → 404. Pack path ready (`private` removed, `publishConfig.access` public, `verify:npm-pack` PASS). Maintainer: set `NPM_TOKEN` or `npm login`, then `npm publish --access public` per [RELEASING.md](./RELEASING.md#publish-to-npmjsorg) | After first `npm view durabl version` shows `0.1.0`; align README registry row |
| **gbrain sync** | **BLOCKED** on this machine (`gbrain` CLI not on PATH; no `~/.gbrain/config.json`) | `/setup-gbrain` or `~/.claude/skills/gstack/bin/gstack-gbrain-install` then `gbrain init --pglite --json`; from repo root: `bun run ~/.claude/skills/gstack/bin/gstack-gbrain-sync.ts` (add `--full` for first code index). Not a ship blocker |

---

## Related (optional, not deferred to this list)

- **Live LLM keys / `gate:live`:** CONFIG-READY; SKIP exit 0 without keys (forward P2, not NOT-PLANNED)
- **CRIU / process fork / second substrate:** Explicitly defer per autoplan §4

---

## References

- Ship / NOT-PLANNED source: `docs/COMPLETION.md` (do not duplicate scope there)
- Autoplan forward review: `docs/plans/autoplan-forward-20260603.md` · baseline `069020d` · gate `docs/evidence/gate-all-20260603-015005.log`
- Remote: https://github.com/asklokesh/durabl
