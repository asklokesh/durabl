# durabl — PRD Redline (Phase 0 output)

Date: 2026-06-01. Redline of the original product hypothesis against Phase 0
evidence. `~~strike~~` = removed/invalidated; **bold** = changed/added. Every change
is justified by a finding in `validation-report.md`.

---

## Positioning

- ~~"Own ONE durable execution model for agents — Temporal/DBOS but shaped around
  the agent execution loop."~~
  **CHANGED → "A neutral, self-hostable replay & time-travel layer for agent
  execution journals — your agent's execution journal lives in your infra, portable
  across substrates, with step-level fork/replay."** Rationale: the durable-execution
  *engine* was commoditized and open-sourced (Google AX, Apache-2.0, May 2026;
  Temporal $5B Feb 2026; DBOS/Restate/CF/MS/AWS all ship it). Owning the engine is
  no longer available and not solo-buildable (validation-report §1.2, §2.3, Attack #4/#5/#6).

- ~~"What we own: durable execution state surviving process death; exactly-once
  external side effects across crashes."~~
  **REMOVED as the moat.** These are table stakes shipped by every substrate. Kept
  only as *consumed capabilities* from the underlying engine, not as our differentiator.

- ~~"agent-loop-native semantics: branching, backtracking, trajectory exploration as
  OUR owned core."~~
  **CHANGED → consumed/extended, not owned.** Google `ax fork` ships trajectory
  branching free. We provide branching as **logical step-level fork over a portable
  journal** with a replay/debug DX, not as a novel engine primitive (Attack #1/#3).

- **KEPT (now the actual moat): neutrality + portability + self-hosting.** Neutral on
  model provider, agent framework, and cloud/VPC; **journal is exportable and lives in
  the customer's infra, not a lab's, and not locked to one cloud (vs AWS AgentCore /
  MS Azure Durable Task which are cloud-locked).** This is the one defensible corner
  (validation-report §2.3 "still open").

## Wedge / v0

- ~~v0 = durable execution runtime (OSS engine core + managed layer).~~
  **CHANGED → v0 = replay-debugging / time-travel observability over a neutral
  portable execution journal.** Rationale: lower correctness-risk, demonstrable,
  solo-buildable beachhead (Attack #7, Decision 4). Durable-execution/portability
  layer becomes v1+ "grow-down," not v0.

## Build vs buy (substrate)

- ~~Build the durable core (lean DBOS-style on Postgres).~~
  **CHANGED → build on an existing step-journal engine; do NOT build the engine.**
  Reference substrate: **Restate** (first-class TS SDK + single self-hostable binary
  + neutral) primary; **DBOS** (Postgres, lightest ops) as the simple alternative.
  Cloudflare DO+Workflows **rejected as substrate** — best TS DX but CF-locked,
  violating the "your infra / neutral cloud" positioning (Attack #2, Decision 2).

## Durability mechanism

- ~~(implicit hybrid / snapshot-fork ambition).~~
  **FIXED → step-journal (replay-from-journal) only. No process snapshot, no hybrid.**
  Trajectory fork = logical step-level branching over the journal, not CRIU snapshot
  (Decision 1, Attack #1/#3).

## Language

- ~~DBOS/Postgres lean implies Python-ish default.~~
  **CHANGED → TypeScript-first, Python fast-follow.** Agent builders are TS-first
  (Mastra, Inngest, Trigger.dev, CF, Vercel AI SDK). Postgres simplicity is a
  deployment detail, not an ecosystem choice (Decision 3, Attack #2).

## Non-goals — unchanged, plus one addition

- Unchanged: not an agent memory product, not a general agent framework, not
  cognitive scaffolding, not a multi-backend durability abstraction ("Terraform for
  agents").
- **ADDED non-goal: do not build the durable execution engine.** Consume an existing
  one. The engine is commoditized; reimplementing it is the highest-risk,
  lowest-differentiation work and is not solo-buildable to correctness.

## Competitive reality added to PRD

- Direct overlap to flag: **Google AX** (free, self-hosted, has fork) at the engine
  layer; **LangSmith / AgentOps / Braintrust / Langfuse / Latitude / Galileo** at the
  observability/replay-debug layer. Our only durable edge vs both: **neutral +
  self-hosted + portable journal + execution-grade fork/replay** in one product.
