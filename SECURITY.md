# Security policy

durabl is designed to be **self-hosted**: your agent journal, effect sink, and
exports stay on infrastructure you control. This document covers how to report
vulnerabilities and how to handle secrets and configuration safely.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report suspected security issues privately so we can triage and patch
before disclosure:

1. **Preferred:** [GitHub private vulnerability reporting](https://github.com/durabl/durabl/security/advisories/new) for this repository.
2. **Alternative:** Open a **private** security advisory or contact the maintainers through your usual secure channel if you already have one.

Include:

- A clear description of the issue and impact
- Steps to reproduce (or a minimal proof of concept)
- Affected versions or commits, if known

We aim to acknowledge reports within a few business days and will coordinate
disclosure timing with you when a fix is ready.

## Do not put secrets in issues or PRs

- Never paste API keys, tokens, passwords, or `.env` contents into GitHub
  issues, pull requests, comments, or CI logs.
- Never commit secrets. The repo gitignores `.env`; use environment variables
  or your host's secret manager instead.
- When sharing reproduction steps, redact paths that contain credentials and use
  placeholder values for keys.

If you accidentally expose a secret, **rotate it immediately** at the provider
and treat the old value as compromised.

## Environment variables and credentials

durabl reads configuration and provider credentials **only from the process
environment** at runtime:

| Concern | Practice |
|--------|----------|
| API keys | Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. in the environment or secret store — never hardcode in source or config committed to git. |
| Data paths | Use `DURABL_DATA_DIR`, `DURABL_JOURNAL_DB`, `DURABL_EFFECT_DB` for local storage locations (see README **Configuration**). |
| Service URLs | Use `DURABL_RESTATE_INGRESS`, `DURABL_RESTATE_ADMIN`, `DURABL_UI_HOST`, `DURABL_UI_PORT` for network binding — defaults bind the UI to loopback. |

The CLI and replay UI **do not read or log credential values**; provider
modules redact secrets from error messages. See `docs/HARDENING.md` for live
provider and HTTP retry policy.

## Self-hosted data stays local

By default, durable state is stored on **your machine or your cluster**:

- Step journals and effect deduplication use SQLite files under `DURABL_DATA_DIR`
  (or paths you set explicitly).
- JSONL export/import is file-based; offline replay (`durabl ui --from
  export.jsonl`) does not require a live substrate or cloud upload.
- Restate runs as a substrate you deploy (native binary or Docker on your
  network); durabl does not phone home with run contents.

You are responsible for:

- Filesystem permissions and backups on journal/effect databases
- Network exposure if you bind services beyond `127.0.0.1`
- Compliance when exporting journals that may contain prompts or tool outputs

Treat exported JSONL and database files as **sensitive** if your workflows
include PII or confidential prompts.

## Supported versions

Security fixes are applied on the default branch (`main`) and released as tagged
versions when applicable. Older tags may not receive backports unless noted in
the advisory.

## Security-related documentation

- [`docs/HARDENING.md`](docs/HARDENING.md) — live provider gates, HTTP retries, redaction
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — no secrets in commits
