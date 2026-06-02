# Backend observability (OpenTelemetry hooks)

**Status:** optional, zero-dependency tracing seam for workflow steps.

durabl already ships a **product-level** observability surface in M3 (replay,
time-travel, fork tree) — see [`m3-observability-replay.md`](m3-observability-replay.md).
This document covers **operator-facing** step telemetry: lightweight hooks that
can forward span-like events to your collector without pulling in the OpenTelemetry
SDK.

---

## Configuration

| Variable | Default | Behavior |
|---|---|---|
| `DURABL_OTEL_ENDPOINT` | *(unset)* | When unset, all tracing hooks are **no-ops** (no network, no overhead beyond one boolean check per step). |
| `DURABL_OTEL_ENDPOINT` | `http://127.0.0.1:4318/v1/traces` (example) | Each journaled workflow step POSTs a small JSON document to this URL (fire-and-forget). |

The endpoint is read in `src/config.ts` as `config.otelEndpoint`. Only set it to
URLs you trust; the service performs an outbound `POST` with run metadata (never
step output bodies or API keys).

---

## Where hooks run

Hooks are centralized in `recordStep` / `recordStepAsync` (`src/journal.ts`), so
every workflow step — `AgentRun`, `HitlAgentRun`, forks — is covered without
duplicating instrumentation in `workflow.ts` or `hitl-workflow.ts`.

Implementation: `src/otel.ts`

- `withStepSpan` / `withStepSpanAsync` — wrap step producers
- `isOtelEnabled()` — `true` when `DURABL_OTEL_ENDPOINT` is non-empty

---

## Event shape (v0)

Each successful or failed step emits one JSON object:

```json
{
  "type": "durabl.step",
  "runId": "demo-run-1",
  "stepName": "step2-tool_call",
  "kind": "tool_call",
  "seq": 2,
  "sideEffect": true,
  "replayed": false,
  "ok": true,
  "durationMs": 12.4,
  "recordedAt": "2026-06-02T12:00:00.000Z"
}
```

| Field | Notes |
|---|---|
| `replayed` | `true` when the journal short-circuited and did not re-run the producer (replay / fork). |
| `ok` | `false` on producer throw; `error` is the exception **name** only (no stack in the payload). |
| *(absent)* | Step **output** and prompts are never included (PII minimization). |

Collectors may translate this JSON into full OTLP spans. A future revision may
emit OTLP natively; v0 intentionally avoids `@opentelemetry/*` dependencies.

---

## Local smoke

```bash
# Terminal A — mock collector (any HTTP server that logs POST bodies)
python3 -m http.server 4318

# Terminal B — run with tracing enabled (endpoint must accept POST)
export DURABL_OTEL_ENDPOINT=http://127.0.0.1:4318/
npm run gate   # or: npm run demo
```

With the variable unset, gates behave identically to pre-OTEL builds.

---

## Relationship to M3

| Layer | Purpose |
|---|---|
| **M3 replay / UI** | Correctness and debugging over the portable journal (substrate may be off). |
| **OTEL hooks (this doc)** | Live step latency / replay ratio for SRE dashboards and alerts. |

Use both: M3 for “what happened?” and OTEL hooks for “how long did each step take
in production?”.

---

## Public API

Re-exported from `durabl` package entry (`src/index.ts`):

- `isOtelEnabled`
- `withStepSpan`, `withStepSpanAsync`
- `StepSpanAttributes`
