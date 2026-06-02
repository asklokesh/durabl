# Test fixtures

Stable, committed JSONL journal exports for **offline** replay and UI tests. Gate harnesses still produce fresh exports at runtime under `docs/*-evidence/` (gitignored); these files are the canonical small bundles checked into the repo.

| File | Used by | Description |
|------|---------|-------------|
| `m3-portable-bundle.jsonl` | `npm run capture:ui` (default), offline replay docs | Root + 3 forks (18 lines): multi-fork M3 portability proof |
| `m5-hitl-run-bundle.jsonl` | Reference / manual offline HITL replay | Complete HITL run with pause, input, effect (7 lines) |
| `hitl-ui-offline-paused.jsonl` | `npm run gate:hitl-ui` G2 | Paused-only import; resume POST must return 503 |

## Regenerating

After a passing gate, copy the runtime export if the journal schema changes:

```bash
cp docs/m3-evidence/portable-bundle.jsonl test/fixtures/m3-portable-bundle.jsonl
cp docs/m5-evidence/hitl-run-bundle.jsonl test/fixtures/m5-hitl-run-bundle.jsonl
```

`hitl-ui-offline-paused.jsonl` is hand-maintained (minimal paused-only slice).
