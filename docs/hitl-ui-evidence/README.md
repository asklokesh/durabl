# HITL UI offline evidence

Pinned **fixture** journal for the `hitl-web` gate (`G2 hitl-ui-offline-paused-readonly`).

| File | Role |
|------|------|
| `hitl-ui-offline.jsonl` | Minimal paused-run bundle (fixed timestamps) so the web UI gate can import and assert readonly paused state without a live substrate. |

**Not** regenerated on every gate run (unlike `docs/m3-evidence/portable-bundle.jsonl` and `docs/m5-evidence/hitl-run-bundle.jsonl`, which are gitignored run outputs).

Regenerate only when the offline paused schema or gate assertions change:

```bash
npm run gate:hitl-web
```
