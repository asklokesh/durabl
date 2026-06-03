# durabl — Fundability narrative

**Date:** 2026-06-01 · **Evidence base:** [`docs/phase0/validation-report.md`](phase0/validation-report.md) · **Build proof:** [`docs/build-status.md`](build-status.md)

---

## One-line pitch

**durabl** is a neutral, self-hostable **agent execution journal** with **replay / time-travel**, **logical trajectory fork**, and **durable human-in-the-loop** — a thin layer on a proven step-journal substrate (Restate), not another durable execution engine.

---

## The wedge (what we sell)

| Layer | What it is | Why it matters |
|---|---|---|
| **Portable journal** | Schema-versioned step journal (SQLite + JSONL export) with structural per-step idempotency | Your run history is **data you own**, not a SaaS trace blob |
| **Replay / time-travel** | Reconstruct any run (and fork tree) from live journal **or** exported bundle with **substrate killed** | Debug production agents offline; prove causality without vendor lock-in |
| **Logical fork** | `seedFork` / `forkAndRun` — branch at step *N* with copied journal prefix, no side-effect re-fire | “What if we decided differently at step 2?” without re-running the expensive prefix |
| **Neutrality seams** | Model provider + deploy target by env only (M4); HITL pause/resume across real process restart (M5) | Same agent loop, different models/clouds; approvals survive crashes |

**What we explicitly do not sell:** owning the durable execution engine, CRIU/process snapshot fork, or cloud-specific durability primitives.

---

## Why the original engine wedge is NO-GO

Phase 0 treated the brief as a hypothesis to break. The engine-layer position is **closed**.

### Google Agent Executor (AX) — position-taker

| Fact | Source / date |
|---|---|
| Apache-2.0 runtime: event-sourced durability, single-writer session consistency, **`ax fork` trajectory branching**, connection recovery, pluggable storage (SQLite default) | [Google Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime); [`github.com/google/ax`](https://github.com/google/ax) |
| Mainstream agent-infra press coverage | May 2026 (e.g. [Towards AI, May 2026](https://pub.towardsai.net/google-open-sourced-ax-and-it-ended-the-4-hour-agent-crash-with-1-go-install-965ba8c8d78f)) |

AX ships roughly **the entire originally claimed moat** — durable execution, consistency, and fork — **free and self-hostable**.

### Funded incumbents on the lawn

| Player | Signal | Date |
|---|---|---|
| **Temporal** | $300M Series D at **$5B** post-money; repositioned explicitly for **agentic AI** (“make agentic AI real”) | Announced **2026-02-17** ([temporal.io](https://temporal.io/news/temporal-raises-300M-to-make-agentic-ai-real-for-companies), [BusinessWire](https://www.businesswire.com/news/home/20260217453156/en/)) |
| **LangChain / LangSmith** | $125M Series B at **$1.25B** | Announced **2025-10-20** ([langchain.com/blog/series-b](https://www.langchain.com/blog/series-b)) |
| **Restate, DBOS, Cloudflare Agents/Workflows, Microsoft Agent Framework, AWS Bedrock AgentCore** | All ship agent durability or adjacent checkpointing (with varying lock-in) | Scanned **2026-06-01** — see validation report §1.2, §2.2 |

### Industry-standard durability mechanism

Every production engine converged on **step-journal** (record non-deterministic step *output* once; replay control flow from journal). Process snapshot (CRIU) was rejected for agents — see validation report Decisions 1–2.

**Verdict (Phase 0):** **NO-GO** on “build/own an agent-native durable execution engine.” **Conditional GO** on replay-debugging / portable journal layer (Attack #7).

---

## What is genuinely defensible

Not the engine (~80% commoditized per Phase 0). The remaining slivers:

1. **Cross-substrate journal portability** — export bundle travels; replay works with Restate **stopped** (M3 gate: substrate killed). AX’s fork format is AX’s; hyperscaler durability is cloud-locked.
2. **Replay + fork over *your* journal** — observability incumbents do traces/evals; few combine **self-host + neutral + portable journal + logical fork** in one story.
3. **Structural exactly-once at the journal boundary** — branded `IdempotencyKey`, effect sink requires it; crash at “after effect, before journal” dedupes to once (M1 **10/10** gates, real SIGKILL).
4. **Demonstrable, lower correctness risk than building an engine** — read-mostly replay layer; bugs skew observability, not double-charging production (validation report §4 Attack #7).

**Honest ceiling:** Differentiation is a **layer + format + DX**, not a new distributed runtime. Winning requires sharp ICP and distribution, not “we invented durability.”

---

## Ideal customer profile (ICP)

**Primary (beachhead):** Platform / infra engineers at **regulated or data-sovereign** companies running **multi-step LLM agents in production** who need:

- Audit-grade run history in **their** VPC / Postgres / object store
- Time-travel debugging when a tool call or approval went wrong
- Counterfactual exploration (fork) without re-firing paid/sensitive side effects

**Secondary:** Agent framework authors (TS-first: Mastra, Inngest, Trigger.dev ecosystems per Phase 0 Decision 3) who want a **portable journal adapter** rather than binding users to LangSmith-only or a single cloud actor.

**Not ICP (yet):** Teams happy with Google AX end-to-end; greenfield apps that only need LangSmith traces; single-cloud shops fully on Bedrock AgentCore or CF Agents with no portability requirement.

---

## Go-to-market (OSS + managed)

| Motion | What ships | Role |
|---|---|---|
| **OSS core (Apache-2.0)** | Journal schema, Restate reference integration, CLI (`inspect`, `fork`, `replay`, `export-bundle`, `ui`), adversarial gates | Trust, adoption, “show me the SIGKILL demo” |
| **Managed (future)** | Hosted journal ingest, retention policies, RBAC, team replay UI, export compliance | Revenue; ops burden we absorb — architecture only: [`architecture/control-plane.md`](architecture/control-plane.md), [`architecture/m6-saas.md`](architecture/m6-saas.md) (**not live**) |
| **Services / design partners** | Help wire durabl journal into existing Restate/Temporal/DBOS deployments | Learn ICP; prove portability claims |

**Beachhead narrative for sales:** “Your agent’s *truth* is a portable journal in your infra; replay and fork are first-class, offline-capable, and substrate-optional for reads.”

**Demo asset:** `npm run demo` + [`docs/DEMO-NARRATIVE.md`](DEMO-NARRATIVE.md) (kill → resume → fork → diff → export).

---

## Competitive matrix (honest)

Crowded observability; commoditized engines. durabl’s bet is the **intersection** of portability + fork + self-host.

| Vendor | Category | Durability / journal | Fork / branch | Self-host / data residency | Replay / time-travel | Neutral (model + cloud) | Notes |
|---|---|---|---|---|---|---|---|
| **durabl** (target) | Portable journal + replay/fork layer | Step journal on Restate; JSONL export | Logical step fork, no re-fire (M2) | **Yes** — local binary + export offline (M3) | **Yes** — CLI + UI, offline from export | **Config-only** seams (M4); real keys optional | Thin layer; engine not owned |
| **Google AX** | Durable agent **engine** | Event log + snapshot; SQLite default | **`ax fork`** shipped | Apache-2.0 self-host | Audit-oriented; not durabl’s replay UX | Go-primary | **Closes engine wedge** (May 2026) |
| **Temporal** | Workflow engine ($5B, agentic pivot) | Event history; activities for side effects | Heavy (signals/children) | Self-host server; ops weight | Via history replay patterns | Multi-SDK | **2026-02-17** Series D |
| **LangSmith** | Observability + LangGraph Studio | Framework-coupled traces | LangGraph Studio v2 time-travel | SaaS-first; enterprise tiers | Strong for LangGraph users | LangChain ecosystem | **$1.25B** (**2025-10-20**) |
| **Braintrust** | Eval + trace observability | Trace-centric | Eval loops, not execution fork | SaaS; enterprise | Trace → eval | Multi-model via integrations | Funded category peer |
| **Langfuse** | OSS observability | Traces/scores | Limited vs execution fork | **Strong self-host** | Session-style replay | Open-source friendly | Closest observability comp on self-host |
| **Inngest** | TS durable steps / workflows | Step functions model | Workflow branching | Cloud + dev server | Execution history | TS-native | Adjacent DX, not portable journal story |
| **Trigger.dev** | TS background jobs / agents | Durable runs; checkpointing angles | Task-level, not journal portability | Managed + self-host options | Run inspection | TS ecosystem | Different center of gravity |

**Where durabl wins on paper:** portable **execution journal** (not just traces), **offline replay after export**, **logical fork without re-fire**, **HITL durable across process death** — with neutrality hooks.

**Where durabl loses on paper:** raw engine features vs **AX**; trace UX maturity vs **LangSmith/Braintrust**; ops simplicity vs **fully managed** SaaS; TS agent ergonomics vs **Inngest/Trigger** if buyer only wants “easy durable steps.”

---

## Milestone evidence (investor checklist)

All gates use real `restate-server`, real SIGKILL on crash paths, assertions from real SQLite journal + effect sink — see [`docs/build-status.md`](build-status.md).

| Milestone | Proof |
|---|---|
| M1 | Exactly-once across crash boundaries (**10/10**) |
| M2 | Logical fork, lineage, diff (**6/6**) |
| M3 | Offline replay from export, substrate killed (**5/5**) |
| M4 | Provider + deploy switch, config-only (**4/4**) |
| M5 | HITL pause/resume across real restart + export (**4/4**) |

---

## Ask framing (fundability)

- **Round story:** Category is validated ($5B Temporal, $1.25B LangChain, Google AX open source) — **timing is “post-commoditization layer”**, not “first durable engine.”
- **Use of capital:** GTM + managed control plane + second substrate adapter (e.g. DBOS/Postgres path), **not** rebuilding Restate.
- **Kill criteria:** If buyers standardize on AX journal format + tooling, or Langfuse adds execution-grade fork with portability, wedge compresses — monitor quarterly.

**Related:** [`docs/RISKS.md`](RISKS.md) · [`docs/DEMO-NARRATIVE.md`](DEMO-NARRATIVE.md) · Phase 0 [`validation-report.md`](phase0/validation-report.md) · Managed (docs only): [`architecture/control-plane.md`](architecture/control-plane.md) · M6 SaaS: [`architecture/m6-saas.md`](architecture/m6-saas.md)
