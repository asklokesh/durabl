# durabl — deferred work (autoplan forward)

Tracked items explicitly **out of** the forward-phase plan in [`docs/plans/autoplan-forward-20260603.md`](plans/autoplan-forward-20260603.md). Do not treat these as blockers for the M0–M5 ship boundary unless scope is reopened with a new milestone.

**Forward phase:** `PLANNED — not started` (review only; see plan doc for P1–P3 candidates).

---

## NOT-PLANNED (product / architecture)

| Item | Status | Notes |
|------|--------|-------|
| **DBOS substrate (product)** | NOT-PLANNED | Stub + `gate:dbos-skip` only; no DBOS integration work |
| **Python SDK** | NOT-PLANNED | `docs/PYTHON-SDK.md` stub; TypeScript ships first |
| **Managed control plane** | NOT-PLANNED | Narrative in `FUNDING.md` only; no hosted SaaS build |
| **Offline HITL write** | NOT-PLANNED (by design) | `POST /api/hitl/input` → 503 offline; would require architecture change |
| **M6 multi-tenant SaaS** | NOT-PLANNED | Out of v0.1 boundary per autoplan CEO review |

---

## Explicitly deferred (forward phase)

| Item | Defer reason | Revisit when |
|------|--------------|--------------|
| **npm publish** | CEO SELECTIVE EXPANSION: defer co-ship with hardening; `RELEASING.md` is tarball-first | Release-channel decision + semver/support policy; run `scripts/verify-npm-pack.sh` |
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
