# Python SDK

**Status: MVP shipped** (`python/` on `main`, PyPI publish deferred)

Installable package **`durabl`** (v0.1.0) with offline JSONL journal import + read-only replay, plus an `httpx` client for the replay UI HTTP API. Full TypeScript parity (journal write, fork seed, Restate, LangGraph) remains on the roadmap below.

---

## Quick start

```bash
cd python && pip install -e ".[dev]"
pytest -q
```

```python
from durabl import import_journal_source, reconstruct, ReplayClient

# Offline — no server
source = import_journal_source(open("bundle.jsonl", encoding="utf-8").read())
run = reconstruct(source, "your-run-id")

# Live replay UI (npm run ui / durabl ui)
with ReplayClient() as client:
    client.health()
    client.get_replay("your-run-id")
```

Package README: [`python/README.md`](../python/README.md). HTTP paths: [`API.md`](API.md).

---

## What ships in v0.1

| Module | API | Notes |
|--------|-----|--------|
| `durabl.types` | `JournalEntry`, `RunMeta`, `EffectRow`, `StepKind`, `JOURNAL_SCHEMA_VERSION` | Schema v1 |
| `durabl.journal_source` | `parse_export`, `import_journal_source`, `load_journal_source` | Same JSONL shapes as TS `parseExport` / `importJournalSource` |
| `durabl.replay` | `reconstruct`, `state_at`, `divergence_points` | Read-only; mirrors `src/replay.ts` subset |
| `durabl.client` | `ReplayClient` | `GET /api/health`, `/api/runs`, `/api/replay`, `/api/state-at`, `/api/tree`, `/api/diff` |

---

## Not in v0.1 (target parity)

Still TypeScript-only until a later milestone:

| Surface | TS | Python |
|---------|----|--------|
| `record_step`, `fork_run`, export write | ✅ | ❌ |
| `seed_fork`, `fork_and_run` | ✅ | ❌ |
| `assert_replay_matches` / gate parity | ✅ | ❌ |
| LangGraph / provider integrations | sketch | ❌ |
| PyPI publish + `gate:python` | — | deferred |

---

## Target API (full parity)

Naming follows Python conventions; semantics should match `src/journal.ts`, `src/fork.ts`, `src/replay.ts`, and `src/journal-source.ts`.

### Types

```python
JOURNAL_SCHEMA_VERSION: int = 1

StepKind = Literal["plan", "tool_call", "summarize", "hitl_pause", "hitl_input"]

@dataclass(frozen=True)
class JournalEntry: ...

@dataclass(frozen=True)
class RunMeta: ...
```

### Journal (write + export) — not implemented

```python
def record_step(...) -> RecordResult: ...
def trajectory(run_id: str) -> list[JournalEntry]: ...
def fork_run(...) -> int: ...
def export_jsonl(run_id: str | None = None) -> str: ...
```

### Replay — **implemented (read path)**

```python
def reconstruct(source: JournalSource, run_id: str) -> ReplayedRun: ...
def state_at(source: JournalSource, run_id: str, seq: int) -> StateAsOf: ...
```

### Fork / inspect / LangGraph — not implemented

See prior design notes in git history; LangGraph hook constraints unchanged (one logical step → one journal row, fork seeds `seq <= N`, replay stays read-only).

---

## Suggested implementation order (remaining)

1. ~~**Pure read path** — `import_journal_source` + `reconstruct` / `state_at`~~ ✅ MVP
2. **Journal write** — SQLite or in-memory backend sharing schema v1 with TS
3. **Fork seed + `fork_and_run`** — inject Restate Python invoke; adversarial test mirroring `gate:m2`
4. **`durabl.integrations.langgraph`** — optional extra
5. **Docs + PyPI** — align with `docs/build-status.md` when `gate:python` exists

---

## Related docs

- TypeScript public API: `src/index.ts`
- Replay / offline: [`m3-observability-replay.md`](m3-observability-replay.md)
- Journal schema: [`JOURNAL-SCHEMA.md`](JOURNAL-SCHEMA.md)
- Phase 0 language decision: [`phase0/validation-report.md`](phase0/validation-report.md)
