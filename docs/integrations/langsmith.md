# LangSmith integration

**Status:** **NOT IMPLEMENTED** — design and field mapping only. No LangSmith SDK,
API client, tracer callback, or import/export code ships in this repository.

**Related:** portable journal ([`docs/JOURNAL-SCHEMA.md`](../JOURNAL-SCHEMA.md)),
replay wedge ([`docs/m3-observability-replay.md`](../m3-observability-replay.md)),
neutrality seams ([`docs/m4-neutrality.md`](../m4-neutrality.md)).

---

## Neutrality wedge (why this doc exists)

LangSmith is the observability and LangGraph Studio surface for the LangChain
ecosystem — strong trace UX, evals, and **framework-coupled** time-travel for
LangGraph users ([LangSmith run format](https://docs.langchain.com/langsmith/run-data-format)).

durabl’s wedge is different on purpose (Phase 0 validation report, Attack #7):

| Dimension | LangSmith (typical) | durabl (shipped) |
|-----------|---------------------|------------------|
| Center of gravity | Traces/spans in a **project** (SaaS or enterprise deploy) | **Execution journal** you export as JSONL |
| Coupling | LangChain / LangGraph instrumentation | **Substrate-agnostic** step model (`src/step-model.ts`) |
| Fork / branch | LangGraph Studio v2 time-travel over graph state | **Logical step fork** over journal + `IdempotencyKey` (M2) — no graph VM required |
| Replay after substrate death | Not durabl’s claim for LangSmith | **Proven** — `importJournalSource()` + replay UI (M3) |
| Model / cloud neutrality | Via framework integrations | **Config-only** `DURABL_MODEL_PROVIDER` + deploy target (M4) |
| Exactly-once side effects | Application responsibility | **Structural** `fireEffect` + effect sink (M1) |

**Positioning:** Teams **all-in on LangGraph** who want LangSmith traces + Studio should
stay there. durabl targets teams that want a **portable execution journal** (self-host,
offline replay, logical fork) and may still **emit** LangSmith spans for evals/ops —
but must not require LangSmith as the system of record for durability.

**Crowded category note:** LangSmith, Braintrust, Langfuse, and others own
observability; durabl does not compete on trace UX maturity. The bet is the
intersection **self-hosted + neutral + portable journal + execution-grade fork/replay**
([`docs/FUNDING.md`](../FUNDING.md) competitive matrix).

---

## Conceptual mapping (two trees)

LangSmith models a **trace** as a tree of **runs** (spans): each run has `id`,
`trace_id`, optional `parent_run_id`, `dotted_order`, `run_type`, `inputs` /
`outputs`, token/cost fields, etc.

durabl models a **run** as a linear **step journal** (plus optional **fork lineage**):

```
run_meta  →  step (seq 1)  →  step (seq 2)  →  …  →  effect lines (side-effect steps)
```

Forks are **sibling runs** linked by `run_meta.parentRun` / `forkedAtSeq`, not by
mutating a single trace tree in place.

| durabl concept | LangSmith concept | Notes |
|----------------|-------------------|--------|
| `runId` (workflow key) | Root run `id` == `trace_id` for the trace | durabl ids are app-chosen strings (e.g. Restate `ctx.key`), not required UUIDv7 |
| `run_meta.trajectory` | `tags` / `session_name` / metadata | Human label; no first-class LangSmith field |
| `JournalEntry` (`step`) | Child **Run** (span) under the trace | One durabl step ≈ one logical span; not 1:1 with every LangChain callback event |
| `idemKey` (`runId:stepName`) | — | **durabl-only** structural idempotency; LangSmith has no equivalent |
| `forkRun` → new `runId` | New branch / checkpoint in LangGraph Studio | Different mechanism: copy prefix + new steps, no re-fire (M2) |
| `effect` record | — | Exactly-once sink audit; map to custom `events` or omitted in export |

---

## Field mapping: portable journal ↔ LangSmith run

References: [`schemas/journal-v1.json`](../../schemas/journal-v1.json),
LangSmith [Run data format](https://docs.langchain.com/langsmith/run-data-format).

### `run_meta` ↔ trace / root run

| durabl (`run_meta`) | LangSmith run (root) | Import rule (future) | Export rule (future) |
|---------------------|----------------------|----------------------|----------------------|
| `runId` | `id`, `trace_id` | Generate or map from trace root UUID | Emit as string id; document if not UUID |
| `parentRun` | — (fork is a **new** trace or linked via metadata) | Set from `extra.durabl_parent_run` if present | `extra.durabl_parent_run` |
| `forkedAtSeq` | — | From `extra.durabl_forked_at_seq` | Same |
| `trajectory` | `tags[]` or `extra.durabl_trajectory` | Parse tag prefix `trajectory:` | `tags: ["trajectory:<name>"]` |
| `createdAt` | `start_time` (root) | Min child `start_time` or root | Root `start_time` |
| `schema` | `extra.durabl_journal_schema` | Must be `1` | Always `1` |

### `step` ↔ LangSmith run (span)

| durabl (`step`) | LangSmith run (span) | Notes |
|-----------------|----------------------|--------|
| `stepName` | `name` | Stable logical name (e.g. `step1-plan`) |
| `kind` | `run_type` + `extra.durabl_step_kind` | See kind table below |
| `seq` | `extra.durabl_seq` | Ordering within durabl run; LangSmith uses `dotted_order` / `execution_order` |
| `output` | `outputs` | durabl stores scalar or string; export as `{ "value": <output> }` or structured JSON |
| `sideEffect` | `extra.durabl_side_effect` | LangSmith does not encode exactly-once |
| `idemKey` | `extra.durabl_idem_key` | **Do not** use LangSmith id as idempotency key |
| `seededFrom` | `extra.durabl_seeded_from` | Fork provenance |
| `recordedAt` | `end_time` (or `start_time` if in-flight) | Wall-clock when journaled, not model latency |
| `runId` | `trace_id` (all spans in trace) | Span `parent_run_id` = mapped parent span id |

### `kind` ↔ `run_type` (proposed export)

| durabl `kind` | Suggested LangSmith `run_type` | Typical span role |
|---------------|-------------------------------|-------------------|
| `plan` | `llm` or `chain` | Model / planner step |
| `tool_call` | `tool` | Tool invocation |
| `summarize` | `chain` | Aggregation / final answer |
| `hitl_pause` | `chain` | Durable pause marker |
| `hitl_input` | `chain` | Human input recorded once |

Token and cost fields (`total_tokens`, `prompt_cost`, …) are **LangSmith-native**.
durabl does not record them today; a future adapter may parse provider metadata from
`output` (e.g. M4 `…@provider:mode` suffix) into `extra` only — not into the journal.

### `effect` ↔ LangSmith

| durabl (`effect`) | LangSmith | Notes |
|-------------------|-----------|--------|
| `payload` | `events[]` entry or `extra.durabl_effect` | Side-effect audit trail |
| `firedAt` | event timestamp | |
| `idemKey` | `extra.durabl_idem_key` | Correlate with side-effect `step` |
| `pid` | — | Omit or `extra.durabl_pid` (non-portable) |

---

## Import / export (honest status)

| Capability | Status | Notes |
|------------|--------|--------|
| **Export** durabl JSONL → LangSmith batch ingest | **NOT IMPLEMENTED** | Would POST runs with computed `dotted_order` / `trace_id` per [batch API](https://docs.langchain.com/langsmith/trace-with-api) |
| **Export** live dual-write (tracer alongside `recordStep`) | **NOT IMPLEMENTED** | Would use LangSmith SDK callbacks; must not break idempotency short-circuit |
| **Import** LangSmith trace → `importJournalSource()` | **NOT IMPLEMENTED** | Lossy: spans ≠ steps; no `idemKey`; fork semantics differ |
| **Import** LangSmith → durabl SQLite journal | **NOT IMPLEMENTED** | Out of scope until mapping + validation fixtures exist |
| Offline replay from LangSmith export alone | **NOT IMPLEMENTED** | durabl replay requires durabl journal shape (M3) |

### Future export (design sketch)

1. Read `exportBundleJsonl(rootRunId)` (or tagged `exportJsonlWithEffects`).
2. For each `run_meta`, create root LangSmith run (`trace_id` = mapped id).
3. For each `step`, create child run with `parent_run_id`, map `kind` → `run_type`,
   attach `extra.durabl_*` fields for round-trip hints.
4. Optionally attach `effect` lines as `events` without implying LangSmith exactly-once.

### Future import (design sketch)

1. List runs in trace; sort by `dotted_order`.
2. Collapse fine-grained spans into **logical steps** (heuristic or `extra.durabl_step_kind`).
3. Assign synthetic `seq`, `idemKey` only if `extra.durabl_idem_key` present — otherwise
   import is **view-only** (replay divergence likely).
4. Load via `importJournalSource()` for M3 UI — mark `origin: langsmith-import` in metadata.

**Security (future):** LangSmith API keys via env only; never in journal export;
`# SECURITY-REVIEW` on any HTTP client. No PII in webhook-style payloads.

---

## What ships today without LangSmith

- Journal + gates: M1–M5 as in [`docs/build-status.md`](../build-status.md).
- Replay/fork over **durabl** export only: `durabl replay`, `durabl ui`, `importJournalSource`.
- LangChain users can add LangSmith separately; durabl does not bundle `langsmith` npm dep.

---

## When to use which

| Choose **LangSmith** | Choose **durabl** (± optional LangSmith export later) |
|----------------------|--------------------------------------------------------|
| LangGraph Studio time-travel is the workflow | Logical fork over **your** journal without LangGraph lock-in |
| Managed trace + evals SaaS is acceptable | Self-host + JSONL you own |
| Trace UX is the product | Execution journal + offline replay after SIGKILL |

**Composed future:** durabl = system of record for durability/fork; LangSmith = optional
observability projection for the same run (dual-write), with durabl authoritative on replay.

---

**READY FOR MERGE** (documentation-only branch).
