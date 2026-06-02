# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## [0.1.0] - 2026-06-01

First release-candidate slice after M5 (HITL pause/resume). Includes productization,
hardening, HITL replay UI, adversarial harness stability, and fundability documentation.

### Added

- **Productization:** `Dockerfile`, `scripts/quickstart.sh`, polished `durabl` CLI, npm
  package metadata, root `README.md`, and `CONTRIBUTING.md` (`915e82b`, `926dc2c`).
- **HITL web UI:** pause/resume from the replay UI with an adversarial gate
  (`7f0cf19`, `58a8673`).
- **Hardening:** live OpenAI/Anthropic provider gate (`npm run gate:live`), HTTP retry
  policy for provider calls, and `docs/HARDENING.md` (`6da9f0a`).
- **Fundability:** investor-oriented docs grounded in Phase 0 evidence (`5227c9f`).
- **Evidence:** HITL UI offline JSONL bundle under `docs/hitl-ui-evidence/` (`18cb2fa`).

### Changed

- **Harness:** gate registration stabilized; HITL UI folded into M5 G5 (`911a19a`).
- **Harness:** gates serialized with a file lock and more reliable Restate lifecycle
  (`0b3b097`).
- **Docs:** `docs/build-status.md` HEAD pointers refreshed for current `main`
  (`18cb2fa`, `a804a6b`, `5927c22`, `077589c`).

### Fixed

- **Harness:** wait for service down before restart to reduce port races (`9a5fb34`).
- **Harness:** improved crash-gate recovery between SIGKILL injection points
  (`d206675`).
- **Harness:** extended crash-gate attach timeout to 120s (`0a376fd`).
- **HITL UI:** stabilized gate script and npm package wiring (`58a8673`).

[0.1.0]: #010---2026-06-01
