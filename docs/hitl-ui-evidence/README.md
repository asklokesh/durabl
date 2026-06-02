# HITL web UI — offline evidence

Pinned **fixture** journal and screenshots for the `hitl-web` gate (`G2 hitl-ui-offline-paused-readonly`).

| File | Role |
|------|------|
| `hitl-ui-offline-paused.jsonl` (canonical) | [`test/fixtures/hitl-ui-offline-paused.jsonl`](../../test/fixtures/hitl-ui-offline-paused.jsonl) — minimal paused-run bundle for offline import |
| `hitl-01-offline-paused-sidebar.png` | Sidebar **Awaiting human input** list over the offline import |
| `hitl-02-offline-paused-banner.png` | Paused run selected — banner + offline note (submit disabled; resume needs live Restate) |

**Not** regenerated on every gate run (runtime exports under `docs/m5-evidence/` and `docs/m3-evidence/` are gitignored; see `test/fixtures/README.md`).

## Regenerate

```bash
npm run build
npm run capture:ui
```

The capturer (`scripts/capture-ui.mjs`) starts the UI server in a **child process** and drives gstack browse separately — browse is never invoked from the server's event loop (see `docs/hitl-web-ui.md`).

Regenerate the JSONL fixture only when the offline paused schema or gate assertions change (copy from a passing gate or edit `test/fixtures/hitl-ui-offline-paused.jsonl`).

Gate (fetch-only, no browse): `npm run gate:hitl-ui`.
