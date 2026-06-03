# durabl (Python)

Minimal Python SDK for **offline portable journal replay** and the **replay UI HTTP API**. This is an MVP — not full parity with the TypeScript library (no journal write, fork seed, or Restate wiring yet).

## Install

From the monorepo (editable):

```bash
cd python
pip install -e ".[dev]"
```

## Offline replay (JSONL export)

```python
from durabl import import_journal_source, reconstruct, state_at

jsonl = open("run-bundle.jsonl", encoding="utf-8").read()
source = import_journal_source(jsonl)

run_id = "m3-root-1780353444814"  # from export
replayed = reconstruct(source, run_id)
print(replayed.trajectory, len(replayed.steps), replayed.outcome)

at_n = state_at(source, run_id, 2)
print(at_n.current_output)
```

Or load from disk:

```python
from durabl.journal_source import load_journal_source
from durabl import reconstruct

source = load_journal_source("run-bundle.jsonl")
replayed = reconstruct(source, "your-run-id")
```

Exports match the portable format documented in [`docs/JOURNAL-SCHEMA.md`](../docs/JOURNAL-SCHEMA.md) and produced by `durabl export` / `durabl export-bundle`.

## Replay UI HTTP client

Requires a running replay server (`npm run ui` or `durabl ui`, optionally `--from export.jsonl`).

```python
from durabl import ReplayClient

with ReplayClient("http://127.0.0.1:7878") as client:
    print(client.health())
    runs = client.list_runs()
    replay = client.get_replay("your-run-id")
```

Environment: `DURABL_UI_HOST`, `DURABL_UI_PORT` (defaults `127.0.0.1:7878`).

## Tests

```bash
cd python && pip install -e ".[dev]" && pytest -q
```

## Scope (v0.1)

| Surface | Python MVP |
|---------|------------|
| `parse_export` / `import_journal_source` | Yes |
| `reconstruct` / `state_at` | Yes |
| `ReplayClient` (`/api/health`, `/api/runs`, `/api/replay`, …) | Yes |
| Journal write, fork, Restate, LangGraph | No — see [`docs/PYTHON-SDK.md`](../docs/PYTHON-SDK.md) |

Reference: TypeScript API in `src/index.ts`.
