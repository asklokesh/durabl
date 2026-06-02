# Python SDK — status and target surface

**Status: DEFERRED** (Phase 0 fast-follow, not shipped)

Phase 0 committed to **TypeScript-first, Python fast-follow** (`docs/phase0/validation-report.md`, Decision 3). The TypeScript library, CLI, gates, and replay UI on `main` are the product proof. **There is no `durabl` Python package in this repository yet** — no PyPI module, no Restate Python service wiring, no Python gate. This document is the contract sketch for when implementation starts; it is not a release note.

---

## What exists today

| Surface | Shipped? | Notes |
|---------|----------|--------|
| Portable journal schema v1 (`step-model`) | ✅ (TS) | JSONL/SQLite export is language-neutral |
| Journal write path (`recordStep`, `forkRun`, export) | ✅ (TS) | Python would call the same schema, not re-invent semantics |
| Fork ergonomics (`seedFork`, `forkAndRun`) | ✅ (TS) | Substrate invoke stays injectable |
| Replay read path (`JournalSource` → `reconstruct` / `stateAt`) | ✅ (TS) | Read-only; safe to port as pure Python over JSONL |
| LangGraph / OpenAI Agents / Pydantic AI integration | ❌ | Sketched below only |
| Python adversarial harness | ❌ | Reuse TS gate evidence until parity gate exists |

**Honest boundary:** Python consumers can already **read** exported JSONL bundles offline (schema is documented in `src/step-model.ts` and `docs/m3-observability-replay.md`). They cannot **produce** durable runs through durabl from Python until this SDK lands.

---

## Target API (mirror TypeScript `src/index.ts`)

Naming follows Python conventions; semantics match the TS public API in `src/journal.ts`, `src/fork.ts`, `src/replay.ts`, and `src/journal-source.ts`.

### Types (from `step-model`)

```python
# durabl.types — mirrors step-model.ts + idempotency branding

JOURNAL_SCHEMA_VERSION: int = 1

StepKind = Literal["plan", "tool_call", "summarize", "hitl_pause", "hitl_input"]

@dataclass(frozen=True)
class JournalEntry: ...

@dataclass(frozen=True)
class RunMeta: ...
```

### Journal (write + export)

```python
# durabl.journal — mirrors journal.ts

def record_step(
    run_id: str,
    step_name: str,
    kind: StepKind,
    output: Any,
    *,
    side_effect: bool = False,
) -> RecordResult: ...

def trajectory(run_id: str) -> list[JournalEntry]: ...
def run_meta(run_id: str) -> RunMeta | None: ...
def fork_run(
    source_run_id: str,
    new_run_id: str,
    through_seq: int,
    trajectory: str,
) -> int: ...  # seeded step count

def export_jsonl(run_id: str | None = None) -> str: ...
def export_bundle_jsonl(run_id: str | None = None) -> str: ...
```

Idempotency keys remain **deterministic** (`run_id:step_name`); the Python layer must enforce the same branded-key contract as `IdempotencyKey` in TS (no ad-hoc strings).

### Journal source (substrate-independent reads)

```python
# durabl.journal_source — mirrors journal-source.ts

class JournalSource(Protocol):
    origin: str
    def trajectory(self, run_id: str) -> list[JournalEntry]: ...
    def run_meta(self, run_id: str) -> RunMeta | None: ...
    def child_runs(self, parent_run_id: str) -> list[RunMeta]: ...
    def effects_for(self, run_id: str) -> list[EffectRow]: ...
    def all_run_ids(self) -> list[str]: ...

def live_journal_source() -> JournalSource: ...
def import_journal_source(jsonl: str) -> JournalSource: ...
```

### Replay (read-only)

```python
# durabl.replay — mirrors replay.ts

def reconstruct(source: JournalSource, run_id: str) -> ReplayedRun: ...
def state_at(source: JournalSource, run_id: str, seq: int) -> StateAsOf: ...
def divergence_points(source: JournalSource, run_id: str) -> list[DivergencePoint]: ...
def assert_replay_matches(a: JournalSource, b: JournalSource, run_id: str) -> None: ...
```

### Fork (product ergonomics)

```python
# durabl.fork — mirrors fork.ts

@dataclass(frozen=True)
class ForkDecision:
    prompt: str
    trajectory: str

def validate_fork_plan(plan: ForkPlan) -> None: ...
def seed_fork(plan: ForkPlan) -> int: ...  # journal-only seed
async def fork_and_run(
    plan: ForkPlan,
    invoke: Callable[[str, ForkDecision], Awaitable[Any]],
) -> ForkResult: ...
```

`invoke` is the same injection seam as TS `SubstrateInvoke`: Restate Python SDK (or a test double) supplies durable execution; durabl owns journal seeding and idempotent short-circuit after the fork point.

### Inspection (CLI/UI helpers)

```python
# durabl.inspect — mirrors inspect-source.ts / inspect.ts

def lineage(source: JournalSource, run_id: str) -> list[LineageNode]: ...
def fork_tree(source: JournalSource, root_run_id: str) -> ForkTreeNode: ...
def diff_trajectories(
    source: JournalSource, run_a: str, run_b: str
) -> TrajectoryDiff: ...
```

HITL (`hitl_pause` / `hitl_input`) and M4 provider/registry surfaces are **in scope for parity** but **second wave** after journal + fork + replay import path is green.

---

## LangGraph hook sketch (not implemented)

Goal: wrap a LangGraph `StateGraph` (or compiled graph) so each **durable logical step** maps to one journaled entry, without re-firing side effects on replay/fork seed.

```text
┌─────────────────────────────────────────────────────────────┐
│  LangGraph node(s)  ──►  durabl step adapter                │
│       │                      │                              │
│       │                      ├─ derive_idempotency_key()    │
│       │                      ├─ record_step() if missing    │
│       │                      └─ fire_effect() if side_effect│
│       ▼                                                     │
│  Restate Python service (substrate) — crash durability      │
└─────────────────────────────────────────────────────────────┘
```

**Sketch API (pseudocode only):**

```python
# durabl.integrations.langgraph — NOT IN REPO

class DurablCheckpointSaver(BaseCheckpointSaver):
    """Optional: map LangGraph checkpoint writes ↔ journal export lines.
    Default v0: explicit per-node adapter instead of full checkpoint bridge."""

class DurablNode:
    """Wraps one graph node: journal kind + side_effect flag."""

    def __call__(self, state: dict) -> dict:
        async with durable_step(self.run_id, self.step_name, self.kind):
            if journal_has(self.run_id, self.step_name):
                return journal_output(self.run_id, self.step_name)
            out = await self.inner(state)
            record_step(...)
            return out

def bind_graph(
    graph: StateGraph,
    *,
    run_id: str,
    substrate_client: RestateIngress,
) -> CompiledGraph:
    """Attach DurablNode wrappers; fork via seed_fork + new run_id."""
    ...
```

**Design constraints (carry from TS gates):**

1. **One logical step → one journal row** — do not journal entire graph state blobs unless schema-versioned and explicitly opted in.
2. **Fork seeds `seq <= N` only** — LangGraph resume on the child run must not re-invoke tools for seeded steps (`record_step` short-circuit).
3. **Replay stays read-only** — `reconstruct()` / `import_journal_source()` never call LangGraph or Restate.
4. **No LangGraph import in core** — `durabl.journal` / `durabl.replay` remain framework-agnostic; `durabl.integrations.langgraph` is an optional extra.

Open questions for implementation (documented here, not resolved):

- Whether to use Restate’s Python SDK `@workflow` / `@step` decorators vs. a thin custom loop (TS uses `workflow.ts` as reference).
- How LangGraph `interrupt()` maps to `hitl_pause` / `hitl_input` kinds (M5 parity).
- Parity gate: Python harness reproducing M2 fork-no-refire + M3 offline export at minimum before claiming “Python SDK shipped.”

---

## Suggested implementation order

1. **Pure read path** — `import_journal_source` + `reconstruct` / `state_at` over JSONL (no Restate).
2. **Journal write** — SQLite or in-memory backend sharing schema v1 with TS.
3. **Fork seed + `fork_and_run`** — inject Restate Python invoke; one adversarial test mirroring `gate:m2` fork-no-refire.
4. **`durabl.integrations.langgraph`** — optional extra; LangGraph in dev dependencies only.
5. **Docs + PyPI** — align with `docs/build-status.md` milestone table when a `gate:python` exists.

---

## Related docs

- TypeScript public API: `src/index.ts`
- Replay / offline: [`m3-observability-replay.md`](m3-observability-replay.md)
- Fork product: [`m2-trajectory-branching.md`](m2-trajectory-branching.md)
- Phase 0 language decision: [`phase0/validation-report.md`](phase0/validation-report.md)
- Package layout stub: [`../python/README.md`](../python/README.md)
