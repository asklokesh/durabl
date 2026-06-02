# durabl — Competitive comparison (factual)

**Purpose:** Help buyers and contributors place durabl next to tools they already
evaluate. This doc cites Phase 0 primary research — not marketing FUD.

**Source of market/engine facts:** [`docs/phase0/validation-report.md`](phase0/validation-report.md)
(2026-06-01 synthesis with dated primary links). **Source of durabl claims:** gated
milestones M1–M5 on [`docs/build-status.md`](build-status.md).

**What durabl is:** A **neutral, self-hostable agent execution journal** with replay,
logical step-level fork, and HITL — a thin layer on a step-journal substrate (Restate
today), not a replacement for your LLM framework or a full observability suite.

---

## TL;DR positioning

| Question | Answer |
|----------|--------|
| vs **Google AX** | AX is a **durable agent engine** with `ax fork` built in (Apache-2.0, May 2026). durabl does **not** compete on engine features; it competes on **portable journal + offline replay/fork UX** and substrate choice for reads. |
| vs **LangSmith** | LangSmith is **framework-coupled observability** ($1.25B LangChain, 2025-10-20) with strong LangGraph time-travel. durabl is **execution-journal-centric**, self-host-first, and offline-capable from export — different center of gravity. |
| vs **Braintrust** | Braintrust is **eval + trace observability** (SaaS, trace → eval). durabl is **durable execution semantics** (fork without re-fire, HITL across restart), not primarily an eval leaderboard. |

Phase 0: engine-level durability and trajectory fork at the leader are **commoditized**;
the still-defensible slice is **neutral portability + replay/fork over your journal**
([validation-report §1.2, §2.3, STATUS](phase0/validation-report.md#status--gono-go)).

---

## Google Agent Executor (AX)

**Category:** Durable agent **runtime** (Go-primary), event-sourced log + snapshotting,
single-writer consistency, **`ax fork`** trajectory branching, Apache-2.0, self-hostable
with pluggable storage (SQLite default).

**Primary sources (Phase 0):** [Google Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime);
[github.com/google/ax](https://github.com/google/ax); press coverage cited in
validation-report §0, §1.2.

| Dimension | Google AX | durabl (today) |
|-----------|-----------|----------------|
| Owns durable execution core | **Yes** — engine in one binary | **No** — Restate + our journal layer |
| Trajectory fork | **`ax fork` shipped** | Logical step fork (M2), journal-seeded |
| Language / ecosystem | Go-primary | **TypeScript-first** (M1–M5) |
| Replay / time-travel UX | Audit-oriented; not durabl’s CLI/UI story | CLI + web UI; **offline from JSONL export** (M3) |
| Journal portability | AX journal format (self-hostable but AX-native) | **JSONL export**, `JournalSource` abstraction (M3) |
| Neutral model/deploy | AX ecosystem | Config-only provider/deploy switch (M4) |
| HITL across process death | Not durabl’s comparison focus | M5 + web UI resume (live); offline list (export) |

**When AX is the better fit:** Greenfield Go shop wanting one Apache-2.0 engine with fork
and durability in-box; no requirement for cross-engine journal export or TS agent stack.

**When durabl is the better fit:** Team already on **Restate/TS** (or planning DBOS
adapter per [ROADMAP.md](ROADMAP.md)); needs **demonstrable offline replay** after
export; wants fork/replay/HITL as a **portable layer** without adopting AX’s runtime.

**Fair acknowledgment:** Phase 0 found AX closes much of the *original* “build a durable
agent engine” pitch ([validation-report §1.2](phase0/validation-report.md#12-is-there-a-funded-pure-play-agent-native-durable-execution-engine)).
durabl’s re-scope accepts that and does not claim engine superiority.

---

## LangSmith (LangChain)

**Category:** Observability + LangGraph Studio; framework-coupled traces and debugging.

**Funding (Phase 0 validated):** $125M Series B at **$1.25B**, announced **2025-10-20**
([langchain.com/blog/series-b](https://www.langchain.com/blog/series-b)).

**Capabilities relevant to comparison (Phase 0 §1.3):** LangGraph Studio v2
**time-travel** (pause / rewind / restart a step) — strong for LangGraph users;
trace-centric product surface.

| Dimension | LangSmith | durabl (today) |
|-----------|-----------|----------------|
| Primary artifact | **Traces** tied to LangChain/LangGraph | **Execution journal** (steps + effects) |
| Durable exactly-once side effects | Via your app + framework; not LangSmith’s core | **Structural** `IdempotencyKey` + effect sink (M1) |
| Fork without re-firing side effects | Studio time-travel; not same as durabl’s journal fork contract | **Logical fork**, gated no-refire (M2) |
| Self-host / data residency | SaaS-first; enterprise tiers | **Local binary + SQLite**; export offline (M3) |
| Offline replay (substrate killed) | Not durabl’s claim for LangSmith | **Proven** — import JSONL, replay UI (M3) |
| Framework neutrality | LangChain ecosystem | **Config-only** model/deploy (M4); journal types substrate-agnostic |
| HITL durable across restart | Not compared as LangSmith’s core | M5 (+ UI API when live) |

**When LangSmith is the better fit:** Team is **all-in on LangGraph**; wants mature
trace UI, evals, and Studio time-travel inside that ecosystem.

**When durabl is the better fit:** Need **portable execution history** independent of
LangChain SaaS; **SIGKILL-grade** durability demos on your infra; fork/replay over a
journal you can **export and audit offline**.

**Crowded category note:** Phase 0 lists LangSmith among many observability players
(AgentOps, Braintrust, Langfuse, etc.) — replay as a *category* is funded
([§1.3](phase0/validation-report.md#13-adjacent-crowded-market-agent-observability--replay-debugging)).
durabl differentiates on **journal + fork + self-host**, not on trace volume alone.

---

## Braintrust

**Category:** Eval + trace observability; trace → eval loops; SaaS with enterprise tier;
free tier cited in Phase 0 comparisons (e.g. 1M spans/mo in market scans).

**Phase 0 placement:** Funded **observability / replay-debugging** peer — strong for
**evaluation workflows** and trace analysis, not positioned as a portable execution
engine or logical fork over a neutral journal
([§1.3](phase0/validation-report.md#13-adjacent-crowded-market-agent-observability--replay-debugging);
competitive matrix in [`FUNDING.md`](FUNDING.md)).

| Dimension | Braintrust | durabl (today) |
|-----------|------------|----------------|
| Center of gravity | **Evals**, experiments, trace quality | **Durable run semantics** + journal |
| Trajectory fork (execution) | Eval loops; **not** execution-grade fork | Logical step fork (M2) |
| Self-host | SaaS-primary | **Self-host-first** OSS |
| Offline audit bundle | Export story is product-specific | **JSONL export** + offline UI (M3) |
| Prove crash + exactly-once | Not durabl’s Braintrust claim | Adversarial gates (M1) |
| HITL across restart | — | M5 |

**When Braintrust is the better fit:** Primary buying question is **“are my prompts/agents
getting better?”** with trace-backed evals and team workflows.

**When durabl is the better fit:** Primary question is **“does this agent run survive
failure, fork safely, and leave a portable journal I control?”** — then optionally
pair with Braintrust/Langfuse/etc. for evals.

---

## Side-by-side (summary table)

| | **durabl** | **Google AX** | **LangSmith** | **Braintrust** |
|---|:---:|:---:|:---:|:---:|
| **Layer** | Journal + replay/fork/HITL | Engine | Observability (+ Studio) | Eval + traces |
| **Shipped fork** | Logical step (M2) | `ax fork` | Studio time-travel (LangGraph) | Eval branches |
| **Self-host default** | Yes | Yes (Apache-2.0) | SaaS-first | SaaS |
| **Offline replay from export** | **Gated (M3)** | AX-native | Not durabl’s claim | Not durabl’s claim |
| **Engine ownership** | No (Restate) | Yes | No | No |
| **Python / TS** | TS today; Python [roadmap](ROADMAP.md) | Go | Python/JS via LangChain | SDK-agnostic traces |
| **Validated funding / scale** | OSS / early | Google (OSS) | **$1.25B** (2025-10-20) | Funded category |

---

## Where durabl wins and loses (honest)

**Wins on paper (evidence-backed):**

- Portable **execution journal** with **offline** replay after export (M3).
- **Logical fork** without side-effect re-fire (M2).
- **HITL** pause/resume across real process/substrate restart (M5).
- **Neutrality hooks** for model and deploy target without code change (M4).

**Loses on paper (stated in Phase 0 and [`FUNDING.md`](FUNDING.md)):**

- Raw **engine** features and `ax fork` maturity vs **Google AX**.
- Trace UX, ecosystem depth, and LangGraph integration vs **LangSmith**.
- Eval workflows and SaaS polish vs **Braintrust**.
- Ops simplicity vs **fully managed** observability SaaS.
- **DBOS / second substrate** — stub only until [ROADMAP M8](ROADMAP.md#m8--dbos-substrate-parity-not-the-stub).

---

## Kill signals (from Phase 0 + product)

Monitor quarterly ([`RISKS.md`](RISKS.md)):

- Buyers standardize on **AX journal format + tooling** for fork/replay.
- **Langfuse** (or Braintrust) ships **execution-grade fork** plus portable journal with
  the same offline proof durabl gates today.
- No design-partner traction for **managed** or **DBOS** paths after M6–M8 effort.

---

## Related

- Roadmap (M6+): [`ROADMAP.md`](ROADMAP.md)
- Phase 0 validation: [`phase0/validation-report.md`](phase0/validation-report.md)
- Investor matrix (broader): [`FUNDING.md`](FUNDING.md) § Competitive matrix
- Build evidence: [`build-status.md`](build-status.md)
