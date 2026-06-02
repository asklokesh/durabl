# HITL web UI — offline evidence

Screenshots of the replay UI serving a **paused-only** HITL export with **no substrate** running.

| File | What it shows |
|------|----------------|
| `hitl-ui-offline.jsonl` | Synthetic export: run paused at `hitl_pause` (no `hitl_input` yet) |
| `hitl-01-offline-paused-sidebar.png` | Sidebar **Awaiting human input** list over the offline import |
| `hitl-02-offline-paused-banner.png` | Paused run selected — banner + offline note (submit disabled; resume needs live Restate) |

## Regenerate

```bash
npm run build
npm run capture:ui
```

The capturer (`scripts/capture-ui.mjs`) starts the UI server in a **child process** and drives gstack browse separately — browse is never invoked from the server's event loop (see `docs/hitl-web-ui.md`).

Gate (fetch-only, no browse): `npm run gate:hitl-ui`.
