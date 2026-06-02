# Architecture Decision Records (ADR)

Canonical decisions for durabl foundations — durable enough to survive substrate swaps and offline export.

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-portable-journal.md) | Portable step journal (JSONL/SQLite), idempotency key, no CRIU | Accepted |

## How to read these

- **ADR** = the *why* and *what we rejected* (durable product/architecture choices).
- **Milestone docs** = the *how it ships* (gates, evidence, module map). Start with [`../m1-slice.md`](../m1-slice.md) for the M1 implementation reference.

When an ADR and a milestone doc overlap, the ADR is the decision record; the milestone doc is the operational proof.

## Adding an ADR

1. Copy the next number: `NNN-short-title.md`.
2. Include: **Status**, **Context**, **Decision**, **Consequences**, **Alternatives considered**.
3. Link related milestone docs and source modules.
4. Update this index table.
