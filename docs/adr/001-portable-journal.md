# ADR 001: Portable step journal (JSONL/SQLite), structural idempotency, no CRIU

**Status:** Accepted  
**Date:** 2026-06-01  
**Deciders:** durabl core (Phase 0 validation + M0 spike + M1 gate)  
**Implementation reference:** [`../m1-slice.md`](../m1-slice.md) · `src/journal.ts`, `src/step-model.ts`, `src/idempotency.ts`, `src/effect-sink.ts`

---

## Context

durabl is a **replay / fork / portability layer** on top of a durable execution substrate (Restate in M1), not a new engine. Users need:

1. A **journal they own** — exportable, inspectable, forkable without vendor lock-in.
2. **End-to-end exactly-once** for side effects despite substrate **at-least-once** step execution after crashes.
3. **Logical trajectory fork** (branch from step *N*) without re-firing seeded effects.

Phase 0 ([`../phase0/validation-report.md`](../phase0/validation-report.md)) compared step-journal engines vs process-snapshot (CRIU-style) fork. The M0 spike proved a real double-fire in the “after effect, before journal” window. M1 gates (10/10, real SIGKILL) lock the contract in code.

---

## Decision

### 1. Dual persistence: substrate journal + portable app journal

- **Substrate** (`ctx.run` on Restate): crash durability and invocation retry (at-least-once step bodies).
- **durabl journal** (SQLite via `node:sqlite`, export to JSONL): portable truth for replay UI, offline reconstruction, lineage, and logical fork.

Both must agree on each step’s **output**; durabl records that output once under a deterministic key inside the durable step. See [`../m1-slice.md` §1–2](../m1-slice.md).

### 2. Schema: versioned `JournalEntry` in SQLite, JSONL as export interchange

**Canonical record** (`JOURNAL_SCHEMA_VERSION = 1`, `src/step-model.ts`):

| Field | Role |
|-------|------|
| `schema` | Breaking-change version (integer, currently `1`) |
| `runId`, `seq` | Primary trajectory key `(run_id, seq)` in SQLite |
| `stepName`, `kind` | Stable logical identity + neutral step taxonomy |
| `idemKey` | Deterministic idempotency key (see below) |
| `output` | JSON-serialized step result (substrate-agnostic) |
| `sideEffect` | Whether this step touched the outside world |
| `seededFrom` | Source `runId` when entry copied by fork; else `null` |
| `recordedAt` | ISO timestamp |

**SQLite** (`step_journal`, `run_meta` in `src/journal.ts`):

- `PRIMARY KEY (run_id, seq)` — ordered trajectory.
- `UNIQUE (run_id, idem_key)` — at most one journal row per logical step per run.
- `run_meta` holds fork lineage: `parent_run`, `forked_at_seq`, `trajectory`.

**JSONL export** (`exportJsonl`, `exportJsonlWithEffects`, `exportBundleJsonl`):

- One JSON object per line; no Restate/engine fields.
- Optional tagged lines: `run_meta`, `effect` (M3 bundle) for fully offline replay.
- JSONL is the **portability interchange**; SQLite is the **live write path** on a single node.

Bump `JOURNAL_SCHEMA_VERSION` only on breaking shape changes; importers must reject unknown versions.

### 3. Idempotency key: structural `runId:stepName`

**Format:** `` `${runId}:${stepName}` `` — branded `IdempotencyKey`, only from `deriveIdempotencyKey(runId, stepName)` (`src/idempotency.ts`).

**Enforcement (not advisory):**

1. `recordStep` derives the key and passes it to the step producer.
2. `fireEffect` **requires** `IdempotencyKey` — no string escape hatch.
3. Effect sink: `UNIQUE` on `idem_key`.
4. Journal: `UNIQUE (run_id, idem_key)`.

Determinism: same logical step → same key on every replay → deduped re-fire after crash.

**Fork:** new run gets a new `runId`; seeded steps keep parent outputs and do **not** re-derive keys for re-execution (entries copied with `seededFrom`). Steps after the fork point use `deriveIdempotencyKey(newRunId, stepName)`.

Validated in M1 gates: crash at every boundary, 8-worker race, fork-no-refire — [`../m1-slice.md` §3](../m1-slice.md), `docs/m1-evidence/`.

### 4. Fork model: logical step-level branching only — **not CRIU**

**We adopt:** copy journal entries with `seq <= N` into a new run, record lineage, diverge past `N`. Seeded side effects do not re-fire (reuse journaled outputs + idempotency contract).

**We reject:** process snapshot / CRIU-style fork for agent workflows.

| CRIU / snapshot | Step journal + portable export |
|---------------|--------------------------------|
| Heavy ops (caps, kernels, image size) | Plain SQLite + JSONL files |
| Opaque to replay/debug tooling | Schema-versioned, human-readable export |
| Platform- and runtime-coupled | Substrate-agnostic records |
| “Resume this process” semantics | “Branch this *trajectory*” semantics |
| Poor fit for LLM/tool non-determinism | Records *outputs* once; replay is deterministic |

Phase 0 Decisions 1–3 and Attacks #1/#3: industry and hyperscaler convergence on **step journal** for agents; snapshot fork is the avoidable hard path ([`../phase0/validation-report.md`](../phase0/validation-report.md), [`../m2-trajectory-branching.md`](../m2-trajectory-branching.md)).

durabl aligns with Google AX-style **logical fork**; differentiation is **neutral, self-hosted, exportable journal DX** — not inventing fork mechanics.

---

## Consequences

### Positive

- Journal is **data the user owns** (export, offline replay in M3, HITL bundle in M5).
- Exactly-once is **type-enforced**, not documentation-only.
- M2/M3/M4/M5 build on the same `JournalEntry` without engine forks.

### Negative / accepted limits

- Two stores to reason about (substrate + app journal); dual-write window required M1 crash proof.
- Single-node SQLite in M1; clustering/sharding is out of scope.
- Real external tools must route effects through `fireEffect` + real provider idempotency where needed (M4 provider seam).

### Follow-ups (not reversing this ADR)

- Second substrate adapter must map foreign step rows → `JournalEntry` without losing `idemKey` ([`../SECOND-SUBSTRATE.md`](../SECOND-SUBSTRATE.md)).
- Schema v2 only if we break `JournalEntry`; provide migration or parallel import.

---

## Alternatives considered

| Alternative | Outcome |
|-------------|---------|
| **CRIU / VM snapshot fork** | Rejected — ops cost, opacity, poor agent fit (Phase 0). |
| **Substrate-only journal (no app journal)** | Rejected — no portable export, vendor lock-in, weak fork/replay story. |
| **Optional / string idempotency keys** | Rejected — M0 double-fire; M1 makes keys branded + required. |
| **JSONL-only (no SQLite)** | Rejected for live path — need indexed dedup + fork copy; JSONL remains export. |
| **Build our own durable engine** | Rejected (Phase 0 NO-GO) — integrate Restate/others; own the journal layer. |

---

## Links

- Implementation & gates: [`../m1-slice.md`](../m1-slice.md)
- Fork UX & demo: [`../m2-trajectory-branching.md`](../m2-trajectory-branching.md)
- Offline replay: [`../m3-observability-replay.md`](../m3-observability-replay.md)
- Phase 0 rationale: [`../phase0/validation-report.md`](../phase0/validation-report.md)
- Index: [`README.md`](README.md)
