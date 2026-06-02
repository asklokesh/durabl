# durabl CLI

Entry point: `durabl` (or `npx durabl` after `npm run build`). Global help: `durabl --help`. Per-command help: `durabl <command> --help`.

Environment variables are documented in the [README](../README.md#environment-variables).

TTY stderr gets colored errors and spinners for Restate/UI operations (`NO_COLOR` disables styling). Actionable hints are printed on usage and runtime failures via `src/cli-ui.ts`.

## Commands

| Command | Summary | Requires Restate ingress |
|---------|---------|--------------------------|
| `run` | Invoke `AgentRun` (sync attach) | Yes |
| `fork` | Seed journal through seq *N*, invoke new run | Yes |
| `inspect` | Trajectory, lineage, effects, forks | No |
| `list-forks` | Direct child forks | No |
| `tree` | Descendant fork tree (stdout) | No |
| `diff` | Per-seq divergence between two runs | No |
| `export` | Portable JSONL for one run | No |
| `export-bundle` | JSONL bundle for a fork-tree root | No |
| `replay` | Human-readable step replay | No |
| `state-at` | Time-travel state after step *N* | No |
| `ui` | Replay web UI on localhost | No |
| `runs` | List all known run ids | No |
| `hitl-run` | Start HITL run (pauses for input) | Yes |
| `hitl-input` | Resume paused HITL with decision | Yes |
| `hitl-status` | HITL state for a run | No |
| `paused` | Runs awaiting human input | No |

## Usage reference

### Run & fork

```bash
durabl run <runId> --prompt <p> [--trajectory <t>]
durabl fork <sourceRunId> --at <N> --new <newRunId> --prompt <p> [--trajectory <t>]
```

### Inspect

```bash
durabl inspect <runId>
durabl list-forks <runId>
durabl tree <runId>
durabl diff <runA> <runB>
durabl runs
```

### Export

```bash
durabl export <runId> [--meta]
durabl export-bundle <rootRunId>
```

### Replay & UI

Journal-only unless noted. Use `--from <export.jsonl>` for offline replay/state/UI.

```bash
durabl replay <runId> [--from <file>]
durabl state-at <runId> --n <N> [--from <file>]
durabl ui [--port <p>] [--from <file>]
```

### Human-in-the-loop

```bash
durabl hitl-run <runId> --prompt <p> [--trajectory <t>]
durabl hitl-input <runId> --decision <text>
durabl hitl-status <runId>
durabl paused
```
