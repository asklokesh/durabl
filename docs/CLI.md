# durabl CLI

The `durabl` binary is the operator surface for runs, forks, journal inspection, export/replay, the local replay UI, and HITL commands. Build with `npm run build`; run via `npm run cli -- <args>` or `node dist/cli.js`.

## Command overview

| Area | Commands |
|------|----------|
| Run / fork | `run`, `fork` (Restate ingress required) |
| Inspect | `inspect`, `list-forks`, `tree`, `diff`, `runs` |
| Export / replay | `export`, `export-bundle`, `replay`, `state-at` |
| UI | `ui [--port <p>] [--from <export.jsonl>]` |
| HITL | `hitl-run`, `hitl-input`, `hitl-status`, `paused` |

Environment variables (`DURABL_DATA_DIR`, `DURABL_JOURNAL_DB`, `DURABL_RESTATE_INGRESS`, `DURABL_UI_PORT`, …) are documented in the [README](../README.md).

## UX

The CLI uses **stdout/stderr only** — no extra styling dependencies. Presentation lives in `src/cli-ui.ts`.

### Colors

When **stderr is a TTY** and `NO_COLOR` is unset, errors and status lines use ANSI colors (red errors, cyan info, dim hints). Pipes and CI logs stay plain text. Set `NO_COLOR=1` to force plain output everywhere.

### Spinner

Long-running substrate calls (`run`, `fork`, HITL submit/resume, `ui` startup) show a tty spinner on stderr. Non-interactive runs skip the spinner.

### Errors and hints

Failures print as:

```text
durabl: error: <message>
  hint: <actionable fix>
```

Common cases:

| Symptom | Typical fix |
|---------|-------------|
| Restate / ingress on **:8080** unreachable | `docker compose --profile docker-demo up -d`, or start local `restate-server`; set `DURABL_RESTATE_INGRESS` if not `http://localhost:8080` |
| **Port in use** (UI default `7878` or ingress `8080`) | `durabl ui --port <p>` / `DURABL_UI_PORT`; free or remap the conflicting service |
| **Harness lock** (`/tmp/durabl-harness.lock` or `DURABL_HARNESS_LOCK`) | Wait for `npm run gate` to finish; if the holder PID is dead, `rm -f` the lock file; run gates serially |
| **SQLite journal locked** | Stop other processes using the same `DURABL_DATA_DIR` / `DURABL_JOURNAL_DB` |
| Wrong command / flags | Message includes usage; `durabl --help` lists all commands |

Usage mistakes (missing `--prompt`, unknown subcommand) exit with code **2**. Runtime failures (ingress down, bind errors) exit with code **1**.

### Examples

```bash
durabl --help
durabl --version
durabl replay my-run --from ./export.jsonl
durabl ui --port 8787
```

See [QUICKSTART.md](./QUICKSTART.md) for a full local stack including Restate on port 8080.
