# durabl — One pager

**Date:** 2026-06-01 · **Sources only:** [`FUNDING.md`](FUNDING.md) · [`phase0/validation-report.md`](phase0/validation-report.md)

---

## Pitch

**durabl** is a neutral, self-hostable **agent execution journal** with **replay / time-travel**, **logical trajectory fork**, and **durable human-in-the-loop** — a thin layer on a proven step-journal substrate (Restate), **not** another durable execution engine.

---

## Phase 0 verdict

| Question | Answer |
|---|---|
| Build/own an agent-native durable execution engine? | **NO-GO** — engine layer ~**80% commoditized** (validation report §4 Attack #5) |
| Portable journal + replay/fork + neutral DX? | **Conditional GO** — re-scoped wedge (validation report STATUS) |
| Gate status | **DONE_WITH_CONCERNS** |

**Why engine is closed:** Google **Agent Executor (AX)** (Apache-2.0, May 2026) ships event-sourced durability, single-writer consistency, and **`ax fork`**. **Temporal** raised **$300M Series D at $5B** (announced **2026-02-17**), repositioned for agentic AI. **LangChain / LangSmith** raised **$125M Series B at $1.25B** (announced **2025-10-20**). Restate, DBOS, Cloudflare, Microsoft, and AWS ship agent durability. Industry standard is **step-journal**, not process snapshot (validation Decisions 1–2).

**What we sell:** portable schema-versioned journal (SQLite + JSONL export); offline replay with substrate killed (M3); logical fork at step *N* without re-firing side effects (M2); model/deploy neutrality via env only (M4); HITL across real process restart (M5). **We do not sell:** owning the engine, CRIU/process snapshot fork, or cloud-specific durability primitives.

---

## Proof (investor checklist)

Real `restate-server`, real SIGKILL on crash paths — see [`build-status.md`](build-status.md).

| Milestone | Gate |
|---|---|
| M1 Exactly-once across crash | **10/10** |
| M2 Logical fork + lineage + diff | **6/6** |
| M3 Offline replay, substrate killed | **5/5** |
| M4 Provider + deploy switch (config-only) | **4/4** |
| M5 HITL pause/resume + export | **4/4** |

---

## ICP & GTM (compressed)

**Primary:** platform/infra engineers at **regulated or data-sovereign** shops running **multi-step LLM agents in production** — audit-grade history in their VPC, time-travel debug, counterfactual fork without re-firing paid/sensitive effects.

**Not ICP (yet):** teams standardizing on Google AX end-to-end; LangSmith-only trace users; single-cloud Bedrock/CF shops with no portability need.

**Motion:** Apache-2.0 OSS core (journal, Restate reference, CLI/UI, gates) → future **managed** (ingest, RBAC, compliance) → design-partner services. Beachhead line: *your agent’s truth is a portable journal in your infra; replay and fork are offline-capable and substrate-optional for reads.*

---

## Where we win / lose (honest)

| Win on paper | Lose on paper |
|---|---|
| Portable **execution journal** (not just traces) | Raw engine vs **AX** |
| Offline replay after export | Trace UX vs **LangSmith / Braintrust** |
| Logical fork without re-fire | Ops simplicity vs fully managed SaaS |
| HITL durable across process death | TS ergonomics vs **Inngest / Trigger** if buyer only wants easy durable steps |

**Ceiling (FUNDING):** differentiation is **layer + format + DX**, not a new distributed runtime — requires sharp ICP and distribution.

---

## Top risks (no sugarcoating)

1. **AX commoditized the original wedge** — free self-hostable durability + `ax fork`; “why not AX?” is the default diligence question. *Mitigation:* never sell the engine; portable journal + offline replay + neutral TS DX. *Kill signal:* buyers standardize on AX journal + tooling with no portability pain.

2. **Observability is crowded and funded** — LangSmith, Braintrust, Langfuse, AgentOps, etc. treat replay/time-travel as a category. *Mitigation:* execution journal portability + fork without re-fire + offline substrate-free replay (M3 demo). *Kill signal:* Langfuse/Braintrust ship execution-grade fork + portable journal with same offline proof.

3. **Engine temptation / solo correctness** — rebuilding the durable core is **not solo-buildable** without a distsys co-founder (validation Decision 4). *Mitigation:* Restate owns correctness; durabl owns journal + read surface.

4. **Substrate concentration** — shipping evidence is Restate-only; Temporal/DBOS/AX buyers need adapters. *Kill signal:* zero demand for export format outside Restate early adopters.

5. **Thin-layer monetization** — OSS journal + CLI may not convert without managed tier and design-partner pilots. *Kill signal:* users export JSONL and never touch paid tier.

6. **Round timing risk** — category validated ($5B Temporal, $1.25B LangChain, Google AX OSS); story is **post-commoditization layer**, not first durable engine. Capital goes to GTM + managed control plane + second substrate adapter, **not** rebuilding Restate.

---

## Ask framing

- **Use of capital:** GTM, managed control plane, second substrate adapter (e.g. DBOS/Postgres path) — **not** engine rebuild.
- **Monitor quarterly:** AX journal format + tooling adoption; Langfuse-class execution fork + portability.

**Deep dives:** [`FUNDING.md`](FUNDING.md) · [`phase0/validation-report.md`](phase0/validation-report.md) · [`RISKS.md`](RISKS.md) · [`DEMO-NARRATIVE.md`](DEMO-NARRATIVE.md)
