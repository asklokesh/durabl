# durabl portable journal schema (v1)

Portable JSONL export from `src/journal.ts`. Machine-readable schema: [`schemas/journal-v1.json`](../schemas/journal-v1.json).

## Export shapes

| Function | Lines |
|----------|-------|
| `exportJsonl(runId, false)` | Legacy bare `JournalEntry` (no `record`) |
| `exportJsonl(runId, true)` | `run_meta` + tagged `step` |
| `exportJsonlWithEffects(runId)` | `run_meta` + `step` + `effect` |
| `exportBundleJsonl(rootRunId)` | Full fork tree via `exportJsonlWithEffects` |

## Record types

### run_meta

Run-level lineage (`RunMeta`) with `"record":"run_meta"`.

| Field | Type |
|-------|------|
| schema | 1 |
| runId | string |
| parentRun | string \| null |
| forkedAtSeq | integer \| null |
| trajectory | string |
| createdAt | ISO-8601 |

### step

Journaled step output (`JournalEntry`). Tagged exports use `"record":"step"`; M1 legacy omits `record`.

| Field | Type |
|-------|------|
| schema | 1 |
| runId | string |
| seq | integer ≥ 1 |
| stepName | string |
| kind | plan, tool_call, summarize, hitl_pause, hitl_input |
| idemKey | runId:stepName |
| output | any JSON |
| sideEffect | boolean |
| seededFrom | string \| null |
| recordedAt | ISO-8601 |

### effect

Side effect from effect sink (`exportJsonlWithEffects` only).

| Field | Type |
|-------|------|
| record | "effect" |
| id | integer |
| runId | string |
| trajectory | string |
| stepName | string |
| idemKey | string |
| payload | any JSON |
| firedAt | ISO-8601 |
| pid | integer |

## Validation

```bash
npm run validate:fixtures
```
