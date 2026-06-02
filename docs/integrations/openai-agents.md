# OpenAI Agents SDK — integration seam

**Status:** integration contract (docs + stub example). durabl does **not** depend on
`@openai/agents` in the core repo; the durable journal and config-only providers
already live under `src/`.

**Audience:** teams running an [OpenAI Agents SDK](https://github.com/openai/openai-agents-js)
loop who want portable replay, fork, and exactly-once tool effects without adopting
durabl’s Restate reference workflow wholesale.

---

## 1. What durabl owns vs what the SDK owns

| Layer | Owner | durabl surface |
| --- | --- | --- |
| Agent orchestration (handoffs, tools, tracing hooks) | OpenAI Agents SDK (your app) | — |
| Crash durability for *your* step boundaries | Your substrate choice (Restate, in-process, etc.) | `ctx.run` in reference workflow |
| Portable step journal + idempotency | **durabl** | `recordStep` / `recordStepAsync` |
| Model API neutrality (no provider names in agent code) | **durabl** | `getModelProvider()` in `src/providers/` |
| Side-effect dedup | **durabl** | `fireEffect` + derived `IdempotencyKey` |

durabl is **framework-agnostic** (see `docs/m4-neutrality.md`): an Agents SDK loop wraps
**logical steps** at the journal seam. The SDK does not replace `recordStep`; it sits
inside or around each journaled producer.

---

## 2. Journal hook points (where to attach)

Reference: `src/workflow.ts` (3-step agent).

### 2.1 `recordStepAsync` — LLM / agent turns

Non-deterministic model or `Runner` output → one logical step. Producer may call
`getModelProvider().complete(...)` (config-only; see `src/providers/registry.ts`).

Contract (`src/journal.ts`): first run persists JSON output; replay/fork never
re-invokes the producer.

### 2.2 `recordStep` — sync / deterministic steps

Pure transforms with no external I/O.

### 2.3 `recordStep` + `fireEffect` — tools / side effects

Each Agents tool → `kind: "tool_call"`, `sideEffect: true`, effect via `fireEffect`
with the `idemKey` from the producer (`src/effect-sink.ts`). Exactly one logical
effect per `(runId, stepName)` across crash/retry.

### 2.4 Substrate wrapper (recommended)

Wrap journal calls in `ctx.run(stepName, …)` (Restate) for at-least-once delivery;
journal short-circuits replay.

---

## 3. Mapping Agents SDK concepts

| Agents SDK | durabl hook | `kind` | `sideEffect` |
| --- | --- | --- | --- |
| Model turn / handoff | `recordStepAsync` | `plan` | `false` |
| Tool | `recordStep` + `fireEffect` | `tool_call` | `true` |
| Final answer | `recordStep` | `summarize` | `false` |
| Human gate | `recordStep*` | `hitl_pause` / `hitl_input` | see `docs/m5-hitl-export.md` |

Use stable `stepName` per semantic step; never reuse names.

---

## 4. Config-only providers (`src/providers/`)

| Env | Role |
| --- | --- |
| `DURABL_MODEL_PROVIDER` | `fake-echo` (default), `fake-upper`, `openai`, `anthropic` |
| `OPENAI_API_KEY` | Real OpenAI-compatible HTTP for `openai` |
| `OPENAI_BASE_URL` | Compatible gateway (Azure, vLLM, …) |
| `DURABL_OPENAI_MODEL` | Model id (default `gpt-4o-mini`) |
| `ANTHROPIC_API_KEY` | Real Anthropic for `anthropic` |

`openai-provider.ts` and `anthropic-provider.ts` simulate deterministically when keys
are absent (CI-safe). Step 1 in `src/workflow.ts` is the reference coupling.

---

## 5. Minimal integration path

1. Run Agents SDK in your service.
2. Wrap each turn and tool at the hooks above.
3. Optionally use `DURABL_MODEL_PROVIDER=openai` for HTTP provider steps instead of
   the SDK client (single journal).

Runnable SDK sample deferred: `examples/integrations/openai-agents-stub/` (README only).

---

## 6. Evidence

- `npm run gate:m4` — provider switch + crash replay (`src/harness/run-m4-gate.ts`)
- Add an integration gate: one tool effect after crash; no second model/SDK call on replay

---

## 7. Related

- `docs/m1-slice.md`, `docs/m4-neutrality.md`, `docs/m5-hitl-export.md`
- `examples/integrations/openai-agents-stub/README.md`
