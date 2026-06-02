# Integrations

How **durabl** attaches to agent-style control loops, what ships today, and what is
explicitly **not** built yet.

durabl is not another agent framework. It is a **portable step journal** plus
**structural per-step idempotency** on top of a durable execution substrate. Your
loop (plan → tool → summarize, or LangGraph nodes, or an OpenAI Agents run) still
owns orchestration; durabl owns **what got recorded**, **replay**, **fork**, and
**exactly-once side effects**.

---

## Built today

| Layer | Status | Where |
|-------|--------|--------|
| Durable substrate | **Restate** (workflows + `ctx.run`) | `src/workflow.ts`, `src/hitl-workflow.ts` |
| Portable journal + idempotency | **Shipped** (SQLite / JSONL export) | `src/journal.ts`, `src/idempotency.ts` |
| Reference 3-step agent loop | **Shipped** | `src/workflow.ts` (`AgentRun`) |
| HITL pause/resume | **Shipped** | `src/hitl-workflow.ts` (`HitlAgentRun`) |
| Model providers (config-only) | **Shipped** (fake / OpenAI / Anthropic) | `src/providers/*`, `DURABL_MODEL_PROVIDER` |
| Second substrate (DBOS) | **Stub only** — contract doc, no runtime | `docs/SECOND-SUBSTRATE.md` |

Gates and evidence: [`docs/build-status.md`](build-status.md).

---

## How durabl wraps an agent loop (Restate)

Two durability layers cooperate on every logical step:

1. **Restate `ctx.run(name, fn)`** — crash durability and at-least-once execution
   of `fn` across process death; Restate replays completed steps from its log.
2. **durabl `recordStep` / `recordStepAsync`** — portable journal entry,
   deterministic idempotency key (`runId:stepName`), and short-circuit on replay or
   fork seed so producers (including LLM calls) are not re-invoked.

Side-effecting steps must go through **`fireEffect`**, which requires the derived
`IdempotencyKey`; the effect sink dedups on that key (exactly-once at the
application boundary). See [`docs/m1-slice.md`](m1-slice.md).

### Reference workflow (`AgentRun`)

The shipped reference loop is a 3-step agent pattern registered as a Restate
workflow:

```34:77:src/workflow.ts
export const agentRun = restate.workflow({
  name: "AgentRun",
  handlers: {
    run: async (
      ctx: restate.WorkflowContext,
      input: WorkflowInput,
    ): Promise<WorkflowOutput> => {
      const runId = ctx.key;
      const trajectory = input.trajectory ?? "main";
      ensureRunMeta(runId, trajectory);
      // ...
      const plan = await ctx.run(STEP.plan.name, () =>
        recordStepAsync({
          runId,
          seq: STEP.plan.seq,
          stepName: STEP.plan.name,
          kind: "plan",
          sideEffect: false,
          producer: async () => {
            const provider = getModelProvider();
            const completion = await provider.complete({ /* ... */ });
            return `${completion.text}@${completion.meta.provider}:${completion.meta.mode}`;
          },
        }).then((r) => r.value),
      );
```

**Step 1 — plan (model call, non–side-effect):** Provider is resolved via
`getModelProvider()` (env `DURABL_MODEL_PROVIDER`); the workflow never names a
concrete vendor. The non-deterministic `complete()` runs inside the journaled step;
on replay/fork the journal output is returned and the provider is **not** called
again ([`docs/m4-neutrality.md`](m4-neutrality.md)).

**Step 2 — tool (side-effect):** Effect only through `fireEffect` with the idem key
passed from `recordStep`:

```84:104:src/workflow.ts
      const toolResult = await ctx.run(STEP.tool.name, () => {
        return recordStep({
          runId,
          seq: STEP.tool.seq,
          stepName: STEP.tool.name,
          kind: "tool_call",
          sideEffect: true,
          producer: (idemKey) => {
            const fired = fireEffect({
              runId,
              trajectory,
              stepName: STEP.tool.name,
              idemKey,
              payload: { plan },
            });
            return `tool-result(effectId=${fired.id})`;
          },
        }).value;
      });
```

**Step 3 — summarize:** Pure journal step; output varies by `trajectory` so logical
forks are observable (M2).

Stable step names feed the idempotency key:

```27:32:src/workflow.ts
const STEP = {
  plan: { seq: 1, name: "step1-plan" },
  tool: { seq: 2, name: "step2-tool_call" },
  summarize: { seq: 3, name: "step3-summarize" },
} as const;
```

Serve entrypoint registers both the reference workflow and HITL workflow when
`DURABL_SERVE=1` (resume across a real process restart).

### Integration pattern (copy this shape)

For any agent loop on Restate:

1. One **logical step** = one `ctx.run` + one `recordStep*` with a stable `stepName`.
2. **Non-determinism** (LLM, HTTP, random) stays inside the `producer`; never outside
   `recordStep` if you want replay/fork safety.
3. **External effects** only in `sideEffect: true` steps, only via `fireEffect(idemKey)`.
4. Use neutral `StepKind` values in [`src/step-model.ts`](../src/step-model.ts);
   framework-specific detail lives in `output` JSON, not in durabl types.

---

## Model providers (built, not “agent frameworks”)

M4 neutrality is **config-only provider selection**, not LangGraph/OpenAI Agents
orchestration:

- Env: `DURABL_MODEL_PROVIDER` (`fake-echo`, `fake-upper`, `openai`, `anthropic`)
- Registry: `src/providers/registry.ts`
- Workflow calls `getModelProvider().complete(...)` only inside journaled steps

Switching providers changes *which API* runs on the **first** execution; it does not
change journal keys or idempotency semantics.

---

## Planned — not shipped

Per-integration **design docs** live under [`docs/integrations/`](integrations/README.md).
Adapter code remains **NOT IMPLEMENTED** unless noted.

| Integration | Doc | Code status |
|-------------|-----|-------------|
| **LangSmith** | [`integrations/langsmith.md`](integrations/langsmith.md) | **NOT IMPLEMENTED** (mapping only) |
| **LangChain** | [`integrations/langchain.md`](integrations/langchain.md) | **DEFERRED** (callback → journal design) |
| **LangGraph** | [`integrations/langgraph.md`](integrations/langgraph.md) | **PROTOTYPE** example README only |
| **OpenAI Agents SDK** | [`integrations/openai-agents.md`](integrations/openai-agents.md) | **DEFERRED** (stub README) |
| **MCP** | [`integrations/mcp.md`](integrations/mcp.md) | **NOT IMPLEMENTED** (schema design) |
| **Kubernetes** | [`../deploy/k8s/README.md`](../deploy/k8s/README.md) | **Config-only** manifests |
| **GitHub Actions** | [`integrations/github-actions.md`](integrations/github-actions.md) | **Shipped** composite `run-gates` |
| **Webhooks (HITL)** | [`integrations/webhooks.md`](integrations/webhooks.md) | **DEFERRED** (`DURABL_HITL_WEBHOOK_URL`) |
| **Pydantic AI** | — | **Planned** ([`docs/phase0/build-plan.md`](phase0/build-plan.md)) |
| **Python SDK** | — | **Planned** ([`docs/phase0/build-plan.md`](phase0/build-plan.md)) |
| **DBOS** | [`SECOND-SUBSTRATE.md`](SECOND-SUBSTRATE.md) | **Stub** (`JournalSource` only) |

## Related docs

- M1 architecture and gates: [`m1-slice.md`](m1-slice.md)
- Trajectory fork: [`m2-trajectory-branching.md`](m2-trajectory-branching.md)
- Replay / export: [`m3-observability-replay.md`](m3-observability-replay.md)
- Provider neutrality: [`m4-neutrality.md`](m4-neutrality.md)
- HITL: [`m5-hitl-export.md`](m5-hitl-export.md)
