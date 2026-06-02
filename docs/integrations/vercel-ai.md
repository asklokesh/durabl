# Vercel AI SDK — integration seam

**Status:** DEFERRED — integration contract (docs only). durabl does **not** depend on
`ai` or `@ai-sdk/*` in the core repo.

**Audience:** teams using [Vercel AI SDK](https://ai-sdk.dev) `streamText` with multi-step
tool loops who want a **portable execution journal** (replay, fork, exactly-once tools)
without making the SDK the system of record.

Hub: [`docs/INTEGRATIONS.md`](../INTEGRATIONS.md).

---

## 1. What durabl records vs what the AI SDK emits

| Layer | Owner | durabl surface |
| --- | --- | --- |
| Token / UI stream parts | AI SDK `textStream`, `toUIMessageStreamResponse` | — |
| Multi-step loop (`stopWhen: stepCountIs(n)`) | AI SDK runtime | — |
| Logical durable steps (outputs + idempotency) | **durabl** | `recordStep` / `recordStepAsync` |
| Portable export in your infra | **durabl** | `exportJsonl*` / `export-bundle` |
| Logical fork without re-firing seeded effects | **durabl** | `forkRun`, `seededFrom` |
| Crash durability | **Restate `ctx.run`** (today) or other step journal | substrate, not SDK |

The SDK emits one **step** per model generation pass (text ± tool calls); tool
`execute` runs before `onStepFinish`. durabl journals **coarse steps** at durable
boundaries — not per-token deltas. See [`docs/m1-slice.md`](../m1-slice.md).

---

## 2. `streamText` step / tool → journal entry mapping

Assign monotonic `seq` per run. Stable `stepName` drives
`deriveIdempotencyKey(runId, stepName)` (`src/idempotency.ts`).

### 2.1 Recommended mapping

| AI SDK artifact | When to journal | durabl `stepName` | durabl `kind` | `sideEffect` | `output` (JSON) |
| --- | --- | --- | --- | --- | --- |
| User turn / prompt | Optional meta only | — | — | — | Store on run input or `RunMeta`; not a journal row unless you need audit |
| Model generation (step *n*, no tools) | `onStepFinish` when step completes | `step-{n}-generate` | `plan` or `summarize` | `false` | `{ text, finishReason, usage?, modelId }` |
| Model generation (step *n*, tool calls requested) | Same | `step-{n}-generate` | `plan` | `false` | `{ text, toolCalls: [{ toolName, toolCallId, args }], finishReason }` |
| Tool `execute` (external I/O) | After `execute`, inside durable wrapper | `step-{n}-tool-{toolName}-{toolCallId}` | `tool_call` | **`true`** | `{ toolName, toolCallId, args, result }` + `fireEffect` payload |
| Tool `execute` (pure / read-only) | Same | `step-{n}-tool-{toolName}-{toolCallId}` | `tool_call` | `false` | `{ toolName, toolCallId, args, result }` |
| Final answer (no more tools) | Last step | `step-{n}-summarize` | `summarize` | `false` | `{ text, finishReason }` |
| Human-in-the-loop | App pause/resume | `step-{n}-hitl_pause` / `hitl_input` | `hitl_pause` / `hitl_input` | `false` | Same as `src/hitl-workflow.ts` |

**`n`** = 0-based index from `result.steps` / `onStepFinish`. Record **one row per
logical step when the step finishes**, not per streaming chunk.

### 2.2 Reference loop alignment (`src/workflow.ts`)

| Shipped `AgentRun` step | AI SDK equivalent |
| --- | --- |
| `step1-plan` | First `streamText` generation step |
| `step2-tool_call` | Tool `execute` with side effects |
| `step3-summarize` | Final generation with no further tools |

A production SDK agent may journal many `(generate → tool*)` cycles before summarize;
`seq` increases monotonically across the run.

---

## 3. Capture hook (DEFERRED adapter sketch)

**Not implemented.** Pseudocode — where journaling attaches when an adapter lands.

```ts
// FUTURE — Restate + ai + durabl journal (not in repo today)
async function durableStreamText(
  ctx: restate.WorkflowContext,
  runId: string,
  baseSeq: number,
  options: StreamTextOptions,
) {
  let seq = baseSeq;
  const result = streamText({
    ...options,
    onStepFinish: async (step) => {
      await ctx.run(`step-${seq}-generate`, () =>
        recordStepAsync({
          runId,
          seq: seq++,
          stepName: `step-${seq - 1}-generate`,
          kind: "plan",
          sideEffect: false,
          producer: async () => ({
            text: step.text,
            toolCalls: step.toolCalls,
            finishReason: step.finishReason,
          }),
        }),
      );
      for (const tr of step.toolResults ?? []) {
        await ctx.run(`tool-${tr.toolCallId}`, () =>
          recordStep({
            runId,
            seq: seq++,
            stepName: `step-${seq - 1}-tool-${tr.toolName}-${tr.toolCallId}`,
            kind: "tool_call",
            sideEffect: true,
            producer: (idemKey) => {
              fireEffect({
                runId,
                stepName: `tool-${tr.toolCallId}`,
                idemKey,
                payload: { args: tr.args, toolName: tr.toolName },
              });
              return { toolCallId: tr.toolCallId, result: tr.result };
            },
          }).value,
        );
      }
    },
  });
  await result.text;
}
```

Adapter rules:

1. Wrap SDK + journaling in **`ctx.run`** (or equivalent step journal) — not bare
   route handlers.
2. Side effects only via **`fireEffect(idemKey)`**; never journal-only tool I/O.
3. On replay/fork, return journaled output — do not re-call model or re-run
   `execute` ([`docs/m4-neutrality.md`](../m4-neutrality.md)).
4. Exported rows must round-trip through `parseExport()` unchanged.

---

## 4. DEFERRED surface

| Item | State |
| --- | --- |
| `docs/integrations/vercel-ai.md` | **This document** |
| `src/integrations/vercel-ai-stub.ts` | **Not created** |
| `ai` / `@ai-sdk/*` dependency | **Not added** |
| Parity gate vs `AgentRun` | **Not implemented** |
| Example under `examples/integrations/` | **Not implemented** |

Future env (no secrets in repo):

| Variable | Purpose |
| --- | --- |
| `DURABL_VERCEL_AI_ENABLED` | Gate experimental adapter |
| `DURABL_MODEL_PROVIDER` | Reuse `src/providers/registry.ts` where possible |
| Provider API keys | Vendor env vars — never logged |

---

## 5. Neutrality wedge

- **Today:** model choice is config-only; workflows do not import Vercel AI SDK.
- **With adapter:** SDK is orchestration convenience; **journal schema v1** remains
  the portable contract for replay UI and offline export.
- **Failure mode:** calling `tool.execute` or streaming LLMs outside a durable step
  reintroduces M0 double-fire — same idempotency contract as
  [`docs/m1-slice.md`](../m1-slice.md).

---

## Related

- [`docs/integrations/langchain.md`](langchain.md) — parallel callback mapping (when merged)
- [AI SDK — multi-step tool calls](https://ai-sdk.dev/docs/getting-started/coding-agents)
