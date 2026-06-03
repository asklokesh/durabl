# GitHub Actions

Run the full durabl gate suite in CI with the repository's reusable composite action.

## Prerequisites

- **Node.js** >= 22.5.0 (matches `package.json` `engines`)
- **`npm run gate:all`** defined in the consumer repo (this repo ships it via `scripts/run-all-gates.sh`)
- **Linux or macOS** runner recommended — gates use process teardown, port cleanup, and optional Docker (M4)
- Sufficient runner time — the serial suite is slow; allow **30+ minutes** on first run

## Minimal workflow

Add `.github/workflows/gates.yml` in your fork or downstream project:

```yaml
name: Gates

on:
  pull_request:
  push:
    branches: [main]

jobs:
  gate-all:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - name: Run durabl gates
        uses: asklokesh/durabl/.github/actions/run-gates@main
```

Pin `@main` to a tag or commit SHA for reproducible CI.

## Action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `node-version` | no | `22` | Node.js version passed to `actions/setup-node` |
| `working-directory` | no | `.` | Package root containing `package.json` and `gate:all` |
| `npm-ci` | no | `true` | `true` → `npm ci`; `false` → `npm install` |
| `durabl-data-dir` | no | *(empty)* | When set, exports `DURABL_DATA_DIR` before `gate:all` |

Example with overrides:

```yaml
- uses: asklokesh/durabl/.github/actions/run-gates@v0.1.0
  with:
    node-version: "22"
    working-directory: packages/durabl-app
    npm-ci: "true"
    durabl-data-dir: /tmp/durabl-ci-${{ github.run_id }}
```

## What `gate:all` runs

`npm run gate:all` executes `scripts/run-all-gates.sh`:

1. `npm run typecheck`
2. `npm test` (M1 gate)
3. Serial: `gate:m2`, `gate:m3`, `gate:m4`, `gate:m5`, `gate:harden`, `gate:hitl-ui`

Each milestone gate tears down Restate, service processes, and listening ports between runs. See [`docs/build-status.md`](../build-status.md) for scope and evidence.

## Faster CI (subset gates)

For PR feedback loops, call individual scripts instead of the reusable action:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: "22"
    cache: npm
- run: npm ci
- run: npm test
```

Full merge protection should still use `run-gates` or `npm run gate:all` locally.

## Troubleshooting

| Symptom | Likely cause | Mitigation |
|---------|--------------|------------|
| Port bind errors | Stale listeners on shared runner | Re-run job; set unique `durabl-data-dir` |
| M4 Docker failures | Docker not available on runner | Use `ubuntu-latest` with Docker, or skip M4 locally |
| Timeout | Full suite exceeds job limit | Raise `timeout-minutes`; run subset on PR |
| `npm ci` fails | Lockfile out of sync | Regenerate `package-lock.json` or set `npm-ci: "false"` |

## Local parity

```bash
npm ci
npm run gate:all
```

Same command the action runs in the checked-out consumer tree.
