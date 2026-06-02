# LangChain integration

**Status:** **DEFERRED** — callback → journal mapping and comparison table only. No
`langchain` / `@langchain/core` dependency, `BaseCallbackHandler` adapter, or automatic
trace import ships in this repository.

**Related:** portable journal ([`docs/m1-slice.md`](../m1-slice.md)),
[`src/workflow.ts`](../../src/workflow.ts), LangSmith field map
([`langsmith.md`](langsmith.md)), neutrality ([`docs/m4-neutrality.md`](../m4-neutrality.md)).

---

## Neutrality wedge

LangChain encourages **callback-shaped** observability: many fine-grained events
(`on_llm_start`, `on_tool_end`, …) that are excellent for traces but are **not** the
same grain as durabl’s **logical step journal** (one durable unit of work per
`recordStep*`).

| Dimension | LangChain callbacks (typical) | durabl (shipped) |
|-----------|------------------------------|------------------|
| Unit of record | Callback events / runs in a tracer | **`JournalEntry`** per logical step |
| Durability | Framework + your hosting | **Restate `ctx.run`** + journal |
| Replay / fork | Tracer-dependent | **Journal prefix + new `runId`** (M2) |
| Side effects | App / tracer responsibility | **`fireEffect`** + `IdempotencyKey` (M1) |
| Provider names in agent code | Often via LC chat models | **Forbidden** — `getModelProvider()` (M4) |

**Positioning:** Use LangChain for orchestration if you want; attach durabl at **stable
step boundaries** (plan, tool, summarize) — the same shape as [`src/workflow.ts`](../../src/workflow.ts).

---

## Callback → journal mapping (design)

Map **coarse** callback groups to one journal step each. Do **not** mirror every
callback as its own step (explodes seq, breaks idempotency keys).

| LangChain callback (group) | durabl `stepName` (example) | `kind` | `sideEffect` | Notes |
|----------------------------|-----------------------------|--------|--------------|--------|
| `on_chain_start` / `on_chain_end` (agent) | `step1-plan` | `plan` | `false` | Producer wraps one LLM or chain call |
| `on_tool_start` / `on_tool_end` | `step2-tool_call` | `tool_call` | `true` | Must use `fireEffect` inside producer |
| Final chain / `on_chain_end` (summary) | `step3-summarize` | `summarize` | `false` | Journal output only |
| `on_llm_*` alone | *(fold into parent step)* | — | — | Sub-events → `output` JSON, not separate seq |
| `on_retriever_*` | `stepN-retrieve` | `plan` or custom | `false` | Optional fourth logical step |

**Idempotency:** `deriveIdempotencyKey(runId, stepName)` — `stepName` must be stable
across retries (graph node id, not callback uuid).

**Restate wrapper (when using reference workflow):**

```text
ctx.run(stepName, () => recordStepAsync({ runId, seq, stepName, kind, sideEffect, producer }))
```

Authoritative pattern: [`src/workflow.ts`](../../src/workflow.ts) lines 27–77.

---

## Comparison: LangChain + LangSmith vs durabl journal

| Capability | LangChain + LangSmith | durabl journal |
|------------|----------------------|----------------|
| Trace UX / evals | **Strong** (SaaS) | Replay UI + JSONL export (M3) |
| Portable export | Tracer export | **First-class** JSONL schema |
| Logical fork without graph VM | LangGraph Studio | **`forkRun`** on journal (M2) |
| Exactly-once tool HTTP | App-defined | **`fireEffect`** (M1) |
| Substrate-neutral | LC-coupled | **JournalSource** seam (DBOS stub) |

For LangSmith-specific fields see [`langsmith.md`](langsmith.md).

---

## DEFERRED implementation

| Item | Status |
|------|--------|
| `DurablCallbackHandler` → `recordStep*` | **DEFERRED** |
| Auto seq assignment from callback order | **DEFERRED** |
| LangChain `tool` → `fireEffect` helper | **DEFERRED** |
| Python package | **DEFERRED** ([`docs/phase0/build-plan.md`](../phase0/build-plan.md)) |

Until an adapter ships, copy the **three-step** Restate workflow and call your LangChain
code only inside each step `producer`.

---

## Related

- Hub: [`docs/INTEGRATIONS.md`](../INTEGRATIONS.md)
- LangGraph PROTOTYPE: [`langgraph.md`](langgraph.md)
