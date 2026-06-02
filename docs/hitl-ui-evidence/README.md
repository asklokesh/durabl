# HITL web UI — offline evidence

Pinned **fixture** journal and screenshots for the `hitl-web` gate (`G2 hitl-ui-offline-paused-readonly`).

| File | Role |
|------|------|
| `hitl-ui-offline.jsonl` | Minimal paused-run bundle (fixed timestamps) so the web UI gate can import and assert readonly paused state without a live substrate. |
| `hitl-01-offline-paused-sidebar.png` | Sidebar **Awaiting human input** list over the offline import |
| `hitl-02-offline-paused-banner.png` | Paused run selected — banner + offline note (submit disabled; resume needs live Restate) |

**Not** regenerated on every gate run (unlike `docs/m3-evidence/portable-bundle.jsonl` and `docs/m5-evidence/hitl-run-bundle.jsonl`, which are gitignored run outputs).

## Regenerate

```bash
npm run build
npm run capture:ui
```

The capturer (`scripts/capture-ui.mjs`) starts the UI server in a **child process** and drives gstack browse separately — browse is never invoked from the server's event loop (see `docs/hitl-web-ui.md`).

Regenerate the JSONL fixture only when the offline paused schema or gate assertions change:

```bash
npm run gate:hitl-web
```

Gate (fetch-only, no browse): `npm run gate:hitl-ui`.
