# durabl — Phase 0 Validation Report

**Date:** 2026-06-01
**Author:** Phase 0 validation gate (research synthesis)
**Status of gate:** see [STATUS](#status--gono-go) at end.

> Method: every market/version fact below is sourced to a primary doc, funding
> announcement, repo, or vendor doc with a date. Where a claim could not be
> independently confirmed it is flagged as UNCERTAIN. The brief was treated as a
> hypothesis to break, not a spec to build. The headline finding is adversarial
> to the brief.

---

## 0. TL;DR (read this first)

The single most important finding: **the core durabl claims to own — event-sourced
durable agent state, single-writer session consistency, and trajectory branching
(`fork`) — were open-sourced by Google as "Agent Executor / AX" (Apache-2.0) and
covered in mainstream agent-infra press in May 2026.** AX ships durable execution +
`ax fork` trajectory branching + single-writer consistency in one Go binary, default
SQLite backend, pluggable storage. ([Google Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime); [github.com/google/ax README](https://github.com/google/ax); [Towards AI writeup, May 2026](https://pub.towardsai.net/google-open-sourced-ax-and-it-ended-the-4-hour-agent-crash-with-1-go-install-965ba8c8d78f))

This does not zero out the opportunity, but it **invalidates the original wedge as
stated** ("own the durable execution model for agents; your journal lives in your
infra"). Google now gives that away free, self-hostable, with the marquee
trajectory-fork feature. The genuinely-open space is narrower and is **not** "build
a durable execution engine."

**Recommendation: NO-GO on the durable-execution-engine wedge as written. Conditional GO on a re-scoped wedge** (replay-debugging / journal-portability layer). Details in STATUS.

---

## 1. Market / white-space validation (§2.1)

### 1.1 Funding figures — validated against primary sources

| Claim in brief | Verdict | Primary source (dated) |
|---|---|---|
| Temporal raising at ~$5B | **CONFIRMED** — $300M Series D at **$5B post-money**, led by a16z, announced **2026-02-17** | [temporal.io news](https://temporal.io/news/temporal-raises-300M-to-make-agentic-ai-real-for-companies); [BusinessWire 2026-02-17](https://www.businesswire.com/news/home/20260217453156/en/); [GeekWire](https://www.geekwire.com/2026/temporal-raises-300m-hits-5b-valuation-as-seattle-infrastructure-startup-rides-ai-wave/) |
| (context) Temporal valuation trail | $1.72B Series C (early 2025) → $2.5B secondary (2025-10-01) → $5B (2026-02) | [BusinessWire 2025-10-01](https://www.businesswire.com/news/home/20251001930769/en/); [temporal.io blog](https://temporal.io/blog/temporal-raises-secondary-funding) |
| LangChain at ~$1.25B | **CONFIRMED** — $125M Series B at **$1.25B**, led by IVP, announced **2025-10-20** | [langchain.com/blog/series-b](https://www.langchain.com/blog/series-b); [Fortune 2025-10-20](https://fortune.com/2025/10/20/exclusive-early-ai-darling-langchain-is-now-a-unicorn-with-a-fresh-125-million-in-funding/); [TechCrunch 2025-10-21](https://techcrunch.com/2025/10/21/open-source-agentic-startup-langchain-hits-1-25b-valuation/) |

Both prior figures are correct. Note Temporal explicitly repositioned around
**agentic AI** in the Series D ("make agentic AI real," partnerships with OpenAI,
Vercel, Pydantic, Braintrust) — i.e. the incumbent is actively moving onto durabl's lawn with a $5B war chest.

### 1.2 Is there a funded pure-play "agent-native durable execution engine"?

Re-scan (2026-06-01) of GitHub, HN/YC launches, and funding press. Findings:

- **Google AX / Agent Executor** (Apache-2.0, `github.com/google/ax`). Not a startup, but it occupies the exact technical position. Event log + snapshotting durability, single-writer consistency, `ax fork` trajectory branching, connection recovery. ([Google Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime), preview; press coverage May 2026.) **This is the position-taker.**
- **Runtime (YC P26)** — *not* the same thing. Sandboxed coding-agent infra for teams (snapshots of full running environments). Launch HN P26. ([HN 48225040](https://news.ycombinator.com/item?id=48225040)) Different problem (sandbox orchestration, not durable execution journal).
- **JamJet** (`jamjet-labs/jamjet`) — OSS "agent-native runtime," Rust/Tokio core, event-sourced crash-safe resume, Python authoring. Closest *independent* OSS pure-play. No funding signal found; appears to be an early/solo or small project. Already claims durable event-sourced execution as core. ([repo](https://github.com/jamjet-labs/jamjet))
- **shenjianan97/persistent-agent-runtime** — Postgres-backed LangGraph checkpointer, lease-based workers. Checkpoint-resume (explicitly *not* deterministic replay). Solo/OSS. ([repo](https://github.com/shenjianan97/persistent-agent-runtime))
- **piotrwachowski/durable-agents** — DeepAgents DX on top of Temporal activities. Thin layer, alpha. ([repo](https://github.com/piotrwachowski/durable-agents))
- **tim-osterhus/millrace** — governed local runtime owning project state; adjacent, more workflow-governance than durable-execution engine. ([repo](https://github.com/tim-osterhus/millrace))

I did **not** find a *well-funded venture-backed* independent pure-play that has
publicly taken "the agent-native durable execution engine" position and only that.
But the position is no longer empty: **Google occupies it with a free Apache-2.0
runtime**, and Temporal/Restate/Cloudflare/Microsoft/AWS all ship agent-durability
features. The "white space" the brief assumed is effectively **closed at the engine
layer**. (UNCERTAIN: private/stealth S26 companies not yet in any public directory;
the public YC directory at scan time surfaced P26 launches but no S26 pure-play durable-execution engine.)

**What's left?** Not the engine. The still-open slivers:
1. **Cross-substrate journal portability / ownership** ("export your execution journal, not locked to Google/AWS/MS clouds"). Google AX is self-hostable but its `fork`/journal format is its own; AWS/MS durability is cloud-locked.
2. **Replay-debugging / observability over a portable journal** (see §1.3 and Attack #7).

### 1.3 Adjacent crowded market: agent observability / replay-debugging

The "replay/time-travel debugging" capability the brief treats as a side-effect is
itself a **crowded, funded category** as of 2026: LangSmith (LangGraph Studio v2
time-travel: pause/rewind/restart a step), AgentOps (time-travel + session replay,
400+ LLMs), Braintrust (trace→eval, free tier 1M spans/mo), Langfuse (self-hosted,
data residency), Latitude, Galileo, Phoenix. ([Latitude 2026 comparison](https://latitude.so/blog/best-ai-agent-observability-tools-2026-comparison); [MLflow top-5 2026](https://mlflow.org/top-5-agent-observability-tools/); [LangChain LangSmith](https://www.langchain.com/langsmith-platform)) So even the fallback wedge has incumbents — the differentiator there must be **portability + self-hosting + neutrality**, which most of these (except Langfuse/Phoenix) lack.

---

## 2. Technical-premise validation (§2.2)

### 2.1 Is the determinism problem real and current? — YES, confirmed

Replay-based durable execution requires deterministic workflow control flow; LLM
calls and tool I/O are non-deterministic; naive replay breaks. Every major engine
handles this the **same way**: keep the orchestration deterministic, push every
non-deterministic action into a **journaled step whose result is recorded once and
replayed from the journal** thereafter.

- **DBOS**: workflow must be deterministic; wrap LLM/tool/random/time in `@DBOS.step`. On recovery DBOS *replays the workflow from the beginning* and *skips completed steps by returning checkpointed outputs* from Postgres. Explicit "deterministic replay" doc. ([DBOS durability](https://docs.dbos.dev/architecture.md); [DBOS AI quickstart](https://docs.dbos.dev/ai/ai-quickstart) — wraps Pydantic AI / OpenAI Agents loop)
- **Restate**: journal-based replay; wrap non-deterministic ops in `ctx.run(...)`; provides deterministic `ctx.rand`, `ctx.date.now()`. Native OpenAI Agents SDK integration. ([Restate durable steps](https://docs.restate.dev/develop/ts/durable-steps); [durable agents](https://docs.restate.dev/ai/patterns/durable-agents))
- **Temporal**: deterministic workflow + activities for side effects; durable event history. Agent layers wrap each LLM/tool call as an activity. ([durable-agents repo built on Temporal](https://github.com/piotrwachowski/durable-agents))
- **Cloudflare**: two models — **Workflows** (`step.do()` persists result to SQLite-backed DO, completed steps never re-execute) for linear durable steps, and **agent-internal Fibers** (`runFiber()`/`startFiber()` checkpoint into the DO's SQLite, recover via `onFiberRecovered()` after eviction). ([CF Agents durable execution](https://developers.cloudflare.com/agents/api-reference/durable-execution/); [CF durable AI agent](https://developers.cloudflare.com/workflows/get-started/durable-agents/))
- **Google AX**: event-sourced log + snapshotting; the *result* of each step is journaled (not the in-memory process). Same conceptual model. ([Google Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime))

So the problem is real, and the **industry-standard answer is already settled**:
step-journal (record output once, replay from journal), **not** process snapshot. This
is decisive for the §2.3 decisions.

### 2.2 Substrate comparison

| Engine | Durability model | Mature SDKs | Solo-operator weight | Can trajectory-fork sit on top w/o reimplementing core? |
|---|---|---|---|---|
| **DBOS** | **Step-journal** in Postgres (replay-from-start, skip completed steps). Library-in-your-process. | Python, TypeScript | **Lightest** — just Postgres + a library, no separate server/worker fleet. Solo-friendly. | Partially. Journal is append-only step log keyed to a workflow ID. A *logical* fork (new workflow seeded from another's step outputs) is buildable; DBOS has no native fork primitive. (See Attack #1.) |
| **Temporal** | Step-journal as **event history**; separate Temporal Server + worker fleet. | Go, Java, TS, Python, .NET, PHP | **Heaviest** — server cluster, workers, ops. Not solo-friendly to *operate* at scale; cloud removes ops but adds lock-in/cost. | Yes-ish via signals/child workflows, but heavy. Reimplementing fork semantics is non-trivial. |
| **Restate** | Step-journal in a **single self-contained binary** (log + state); SDK talks to server-proxy. | TS, Python, Java/Kotlin, Go, Rust | **Light-medium** — one binary to run; lighter than Temporal, heavier than DBOS-as-library. | Plausible — Virtual Objects + journal give good primitives; fork still a build-on-top. |
| **Cloudflare DO + Workflows** | **Actor state + step-journal**: DO = single-threaded stateful singleton w/ SQLite; Workflows = step persistence. | TS-first (JS/TS) | **Lightest to operate** (fully managed, serverless, zero ops) but **platform lock-in to CF**; not self-hostable; contradicts "your infra." | Logical fork over DO SQLite journal is buildable; CRIU-style process snapshot is not what CF offers. |
| **Google AX** | **Event-sourced log + snapshotting**, single-writer, pluggable storage (SQLite default). | Go (primary) | Medium — Go binary, scales to k8s. Self-hostable. | **Already has it** — `ax fork`. Nothing to build; it's shipped. |

### 2.3 How much of "the part we own" is already shipped free?

- **Google AX**: durability ✅, session consistency (single-writer) ✅, **trajectory branching (`ax fork`) ✅**, connection recovery ✅, audit (single controller) ✅. Apache-2.0, self-hostable, customer-owned state. **This is ~the entire claimed moat, free.** ([Google Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime); [github.com/google/ax](https://github.com/google/ax))
- **Microsoft Agent Framework**: graph checkpointing at superstep boundaries (In-Memory/File/Cosmos providers); **true crash-recovery durability requires the Azure Durable Task extension → Azure-locked**, not a framework primitive, not cloud-agnostic. ([MS Learn checkpoints, upd. 2026-04-10](https://learn.microsoft.com/en-us/agent-framework/user-guide/workflows/checkpoints); [Diagrid critique](https://www.diagrid.io/blog/still-not-durable-how-microsoft-agent-framework-and-strands-agents-repeat-the-same-mistake); [MS Learn durable task ext, upd. 2026-05-05](https://learn.microsoft.com/en-us/azure/durable-task/sdks/durable-agents-microsoft-agent-framework))
- **AWS Bedrock AgentCore Runtime**: managed session storage (filesystem persistence across stop/resume, 1GB/session, 14-day idle retention, preview 2026-03-24) + bring-your-own S3/EFS (2026-05). This is **filesystem-state persistence, not step-journal replay or trajectory fork**; and it's AWS-locked. ([AWS what's-new 2026-03](https://aws.amazon.com/about-aws/whats-new/2026/03/bedrock-agentcore-runtime-session-storage/); [AWS docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-filesystem-configurations.html))

**Re-scoped genuinely-open core (quantified):**
- Engine-level durable execution for agents: **CLOSED** (Temporal, DBOS, Restate, CF, AX all ship it).
- Trajectory fork as a feature: **CLOSED at the leader** (Google `ax fork` is free + self-hosted).
- **STILL OPEN (narrow):** (a) a **neutral, cross-substrate, self-hostable journal format + portability/export** layer that is not bound to one cloud or one engine; (b) a **replay-debugging / time-travel observability** product over that journal with strong self-hosting + neutrality (the funded observability players are mostly SaaS or framework-locked; Langfuse/Phoenix are the self-host exceptions). The open space is a **layer/format + DX**, not an engine.

---

## 3. The four decisions (§2.3) — resolved with rationale

### Decision 1 — Durability mechanism: **STEP-JOURNAL (replay-from-journal), NOT process snapshot, NOT hybrid.**

Rationale: Every production engine for agent workloads converged on step-journal:
keep orchestration deterministic, journal each non-deterministic step's *output*,
replay by re-running control flow and short-circuiting completed steps from the
journal (DBOS, Temporal, Restate, CF, AX). Process snapshot (CRIU-style, snapshot
the whole process/memory) is operationally gnarly, language-runtime-specific, huge
state, and unnecessary because LLM/tool outputs serialize cleanly as journal
entries. Snapshot buys nothing for agent loops that snapshot-via-journal doesn't,
and costs enormously in buildability. **Hybrid is also rejected** for v0: it doubles
the correctness surface for no demonstrated agent-loop benefit. Pick step-journal.

### Decision 2 — Substrate: **DO NOT build the core engine. Build a thin neutral layer on top of an existing step-journal engine; default reference target = DBOS (Postgres) for solo simplicity, with Restate as the portable-binary alternative.**

Rationale: The engine is a solved, multiply-implemented, well-funded commodity
(Temporal $5B, DBOS, Restate, CF, free Google AX). Reimplementing the
correctness-critical durable core solo is the worst possible use of a solo
founder's time and the highest-risk part. The step-journal mechanism (Decision 1)
**sits cleanly on top of** DBOS/Restate without reimplementing their cores —
*except* the trajectory-fork differentiator (see Decision on Attack #1/#3). Building
the engine is explicitly **not** required and would change difficulty from
"hard-but-solo-able layer" to "needs a distributed-systems team."

### Decision 3 — Language/ecosystem: **TypeScript-first, Python-second. This OVERRIDES the prior brief's DBOS-for-Postgres lean as the primary ecosystem driver.**

Rationale: Agent dev skews TS-first (Mastra, Inngest, Trigger.dev, Vercel AI SDK,
CF Agents are all TS-native; LangGraph/OpenAI-Agents/Pydantic-AI cover Python).
The mismatch in the brief is real: DBOS is loved for *Postgres operational
simplicity*, but its agent ergonomics are Python-centric and the TS audience lives
elsewhere. **Resolution:** prioritize the TS developer surface (where the agent
builders are), and choose a substrate that has a *mature TS SDK*. DBOS has TS;
Restate has first-class TS; CF is TS-native. Postgres simplicity is a deployment
convenience, not an ecosystem strategy — don't let the tail wag the dog. Ship TS
SDK first, Python SDK fast-follow.

### Decision 4 — Solo-buildability verdict: **The ENGINE is NOT solo-buildable to correctness; therefore DON'T build it. A thin journal/portability + replay-debugging LAYER on top of an existing engine IS solo-plus-Claude-Code-buildable.**

Rationale: Correctness-critical distributed durable execution (crash semantics,
exactly-once side effects, recovery races) realistically needs a distributed-systems
co-founder *if you build the engine*. The honest call: **building the engine solo is
a no.** But the re-scoped product (Decision 2: layer on a proven engine + Decision
1: logical step-journal fork + a replay/observability DX) pushes the
correctness-critical part down into the battle-tested substrate, leaving a layer
that is solo-buildable. **Verdict: solo-buildable only if you accept the re-scope.
Not solo-buildable as the original engine.**

---

## 4. Section 6 — attack the suspected planner errors (verdicts)

**#1 — DBOS-vs-snapshot contradiction.** **VERDICT: CONFIRMED ERROR.** DBOS is a
step-journal (replay-from-start, skip checkpointed steps in Postgres), explicitly
**not** process snapshot ([DBOS architecture](https://docs.dbos.dev/architecture.md)). A "true snapshot-fork" on DBOS would mean
reimplementing fork semantics it doesn't have. *Resolution:* don't do snapshot-fork;
do **logical step-level trajectory branching** = create a new workflow/journal seeded
by copying/referencing another journal's step outputs up to sequence N, then diverge.
This is exactly what Google `ax fork` does conceptually (fork from a sequence number).
Buildable on a structured journal without reimplementing the engine core.

**#2 — Substrate may be wrong for ecosystem (TS-first).** **VERDICT: PARTIALLY
CONFIRMED.** TS-first ecosystem is real (Mastra, Inngest, Trigger.dev, CF). DBOS is
not wrong (it has a TS SDK + unbeatable ops simplicity), but choosing it *for Postgres
reasons* while the audience is TS is the mistake. **Cloudflare DO+Workflows is a
better DX fit for TS** — but it **fails the "your state in your infra / neutral on
cloud" positioning** (CF-locked, not self-hostable). So: CF is a better *runtime fit*
but a worse *positioning fit*. Net: **Restate** (first-class TS, single self-hostable
binary, neutral) is the best reconciliation of ecosystem + neutrality; **DBOS** stays
the simplest if Postgres-only is acceptable. Don't pick CF as the substrate given the
"your infra" wedge.

**#3 — Differentiator may be as hard as the engine.** **VERDICT: CONFIRMED for the
hard version, AVOIDABLE.** Process-snapshot fork (CRIU-style, like some Trigger.dev
checkpointing) is gnarly and likely intractable solo. The cheaper, sufficient
alternative — **logical step-level trajectory branching over a structured journal** —
is tractable and is what the market leader (Google AX) actually ships. *Resolution:*
adopt the cheap version; never attempt CRIU-style snapshot fork.

**#4 — White space may have closed.** **VERDICT: CONFIRMED — substantially closed.**
Google AX (Apache-2.0) now ships durability + single-writer consistency + `ax fork`
trajectory branching + connection recovery, free and self-hostable. Temporal ($5B,
Feb 2026) repositioned onto agents. Restate, CF, MS, AWS all ship agent durability.
The "empty agent-native durable execution engine" position the brief assumed **does
not exist anymore at the engine layer.** (See §1.2.)

**#5 — Un-absorbable core may be narrower than claimed.** **VERDICT: CONFIRMED.**
Google Agent Executor ships durability + session consistency + trajectory branching
**free**. The truly-still-open core is **not the engine** but: (a) neutral,
cross-substrate, self-hostable **journal portability/export**, and (b) a
**replay-debugging DX** layer with neutrality/self-hosting. Quantified: ~80% of the
originally-claimed moat is now commoditized; ~20% (portability + neutral DX) remains,
and even that overlaps a crowded observability market (§1.3).

**#6 — Solo-buildability unverified.** **VERDICT: CONFIRMED CONCERN; now resolved
(Decision 4).** Engine = not solo-buildable to correctness (needs distsys co-founder).
Re-scoped layer = solo-buildable. The brief did not verify this; it's now an explicit
gate.

**#7 — Durable execution may not be the right first wedge; replay-debugging/
observability is more demonstrable.** **VERDICT: STRONGLY AGREE — this should be v0.**
A replay-debugging / agent-trajectory time-travel product is (a) **far less
correctness-critical** (read-mostly over a journal; a bug shows the wrong trace, it
doesn't corrupt production side effects), (b) **demonstrable in a demo** (visual
time-travel sells itself), (c) **a beachhead** into the durability layer later. The
catch (§1.3): the observability category is crowded and funded (LangSmith, AgentOps,
Braintrust, Langfuse, Latitude, Galileo). To win, the v0 must differentiate on the
durabl thesis itself: **self-hosted + neutral (model/framework/cloud) + the journal
is portable and lives in your infra + replay/fork over that journal** — the gap
Langfuse/Phoenix partially fill but without the durable-execution/fork angle.

---

## STATUS / go-no-go

**STATUS: DONE_WITH_CONCERNS**

**Go/No-Go:** **NO-GO on the original wedge** (build/own an "agent-native durable
execution engine; your journal lives in your infra"). Evidence is decisive: Google
Agent Executor (Apache-2.0, May 2026) already ships the entire claimed moat —
event-sourced durability, single-writer consistency, and `ax fork` trajectory
branching — free and self-hostable, while Temporal ($5B, Feb 2026), Restate, DBOS,
Cloudflare, Microsoft, and AWS all ship agent durability. The engine is a commodity
and its correctness-critical core is **not solo-buildable** without a distributed-systems co-founder.

**Conditional GO on a re-scoped wedge:** pivot v0 to a **replay-debugging /
time-travel observability product over a neutral, portable, self-hostable execution
journal** (Attack #7), built as a thin layer on a proven step-journal substrate
(Restate for TS+neutrality, or DBOS for Postgres simplicity — Decisions 1–3), using
**logical step-level trajectory branching** (never CRIU snapshot — Attacks #1/#3).
This is solo-plus-Claude-Code-buildable (Decision 4), demonstrable, and lower
correctness-risk, and can later grow down into the durability/portability layer that
is the one genuinely-open sliver. **Do NOT proceed to M1 on the engine.** Proceed to
M1 only on the re-scoped replay-debugging wedge after a spike validating logical
fork over a Restate/DBOS journal. Differentiation vs the crowded observability market
(LangSmith/AgentOps/Braintrust/Langfuse) must be: self-hosted + neutral + portable
journal + fork/replay — the corner none of them fully own.
