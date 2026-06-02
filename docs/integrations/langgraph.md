# LangGraph integration (PROTOTYPE)

> **Status: PROTOTYPE** — Maps LangGraph-style graphs onto durabl’s journal contract.
> No LangGraph Python package or checkpointer adapter in this repo. The example at
> [`examples/integrations/langgraph-minimal/`](../../examples/integrations/langgraph-minimal/)
> uses the **same Restate + `recordStep` pattern** as [`src/workflow.ts`](../../src/workflow.ts).

---

## What durabl owns vs LangGraph

| Concern | LangGraph (typical) | durabl |
|---------|---------------------|--------|
| Graph edges, state reducer, checkpoints | Framework | Stays in LangGraph |
| Per-node outputs, replay, fork seed | Checkpointer | **Portable journal** (`recordStep*`) |
| Tool / HTTP side effects | Your tools | **`fireEffect`** + idempotency key |
| Crash durability | Your hosting | **Substrate** (Restate `ctx.run`) |

---

## Mapping graph nodes → journal steps

| LangGraph concept | durabl field | Rule |
|-------------------|--------------|------|
| Node id (stable) | `stepName` | One id per semantic node |
| Order | `seq` | Monotonic per run |
| Role | `kind` | `plan`, `tool_call`, `summarize`, … |
| Return value | `output` | JSON-serializable |
| External I/O | `sideEffect` + `fireEffect` | Required for exactly-once |

Idempotency: `deriveIdempotencyKey(runId, stepName)`. Replay skips the producer.

---

## Wrapping a node

**LLM node** — `ctx.run` + `recordStepAsync`, `sideEffect: false`.

**Tool node** — `ctx.run` + `recordStep`, `sideEffect: true`, `fireEffect({ idemKey, … })`.

Authoritative code: [`src/workflow.ts`](../../src/workflow.ts). PROTOTYPE mirror:
[`examples/integrations/langgraph-minimal/workflow.ts`](../../examples/integrations/langgraph-minimal/workflow.ts).

---

## Python (planned)

Future: LangGraph checkpointer → durabl journal; `thread_id` → `runId`; tools → `fire_effect`.

---

## Demo

```bash
npm run build
cat examples/integrations/langgraph-minimal/workflow.ts
npm run demo
npx durabl replay <runId>
```

See [`../INTEGRATIONS.md`](../INTEGRATIONS.md).
