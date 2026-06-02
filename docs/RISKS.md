# durabl — Top risks before fundable

**Date:** 2026-06-01 · **Context:** Post–Phase 0 re-scope; M0–M5 gates green per [`docs/build-status.md`](build-status.md)

Each risk is ranked by **investor diligence severity** (likelihood × impact if unmitigated).

---

## 1. Google AX commoditized the original wedge

| | |
|---|---|
| **Risk** | Apache-2.0 **Agent Executor (AX)** ships durability, single-writer consistency, and **`ax fork`** (May 2026 press). Buyers ask: “Why not AX?” |
| **Likelihood** | High — AX is free, self-hostable, and narratively dominant |
| **Impact** | Fatal to “we own durable execution” pitch; compresses pricing power on any engine story |
| **Mitigation** | Never sell the engine. Position on **portable journal format + offline replay + neutral TS DX** (see [`docs/FUNDING.md`](FUNDING.md)). Integrate/export *from* AX/Temporal rather than compete head-on. |
| **Kill signal** | Design partners standardize on AX journal + tooling with no portability pain |

---

## 2. Observability market is crowded and funded

| | |
|---|---|
| **Risk** | LangSmith ($1.25B, **2025-10-20**), Braintrust, Langfuse, AgentOps, Latitude, Galileo, Phoenix — “replay debugging” is a **category**, not a gap |
| **Likelihood** | High |
| **Impact** | CAC explodes; durabl seen as “another trace UI” |
| **Mitigation** | Own **execution journal portability + fork without re-fire + offline substrate-free replay** — corner Langfuse only partially covers. Lead demo with **export bundle + killed Restate** (M3), not generic traces. |
| **Kill signal** | Langfuse/Braintrust ship execution-grade fork + portable journal with same offline proof |

---

## 3. Solo-buildability vs correctness (engine temptation)

| | |
|---|---|
| **Risk** | Founder rebuilds the durable core; distributed correctness (exactly-once, partition behavior) exceeds solo capacity |
| **Likelihood** | Medium (discipline-dependent) |
| **Impact** | Years of infra work; subtle production bugs; investor pass |
| **Mitigation** | Phase 0 Decision 4: **engine = not solo-buildable**. Restate owns correctness; durabl owns journal + read surface. Gates document scope boundary. |
| **Kill signal** | Custom scheduler/worker code appears without gate coverage |

---

## 4. Real LLM neutrality not proven in production

| | |
|---|---|
| **Risk** | M4 gates use **fake-echo / fake-upper** by default; OpenAI/Anthropic adapters are **config-ready** (real HTTP only when keys present) |
| **Likelihood** | Medium |
| **Impact** | “Model-agnostic” dismissed as slideware |
| **Mitigation** | Design-partner runs with real keys + documented journal short-circuit (provider never re-called on replay). Publish redacted journal samples showing provider descriptor per step. |
| **Kill signal** | First production incident from provider re-invocation on replay |

---

## 5. Substrate concentration (Restate-only shipping path)

| | |
|---|---|
| **Risk** | All evidence is Restate `1.6.2` / SDK `1.14.4`. Buyers on Temporal/DBOS/AX ask for their substrate |
| **Likelihood** | Medium–high |
| **Impact** | TAM capped; “portable journal” reads as “Restate plugin” |
| **Mitigation** | Journal schema + `JournalSource` are substrate-agnostic; roadmap **adapters** (DBOS/Postgres for ops-simple shops). Spike already validated logical fork **without engine modification** (M0). |
| **Kill signal** | Zero demand for export format outside Restate early adopters |

---

## 6. Wedge compresses to “thin layer” revenue

| | |
|---|---|
| **Risk** | OSS journal + CLI is valuable but **hard to monetize**; managed offering arrives late |
| **Likelihood** | Medium |
| **Impact** | Fundraise story weak on ARR path |
| **Mitigation** | GTM: OSS for adoption, **managed** for retention/compliance (RBAC, retention, hosted replay). Design-partner paid pilots before GA. |
| **Kill signal** | Users export JSONL and never touch paid tier |

---

## 7. Temporal / incumbents bundle observability + execution

| | |
|---|---|
| **Risk** | Temporal ($5B, **2026-02-17**) and clouds add agent observability atop existing durability |
| **Likelihood** | Medium |
| **Impact** | durabl squeezed between AX (free engine) and Temporal (enterprise trust) |
| **Mitigation** | **Neutral journal export** narrative — works across engines; sell sovereignty and audit, not orchestration replacement. |
| **Kill signal** | Temporal ships portable agent journal export + fork UX matching M2/M3 |

---

## 8. Demo ≠ production operability

| | |
|---|---|
| **Risk** | Adversarial gates are single-host, no multi-partition / clock-skew / fleet ops |
| **Likelihood** | High (by design today) |
| **Impact** | Production due diligence fails on scale and SRE story |
| **Mitigation** | Explicit envelope in [`docs/build-status.md`](build-status.md): substrate owns partition concerns. Roadmap: HA Restate deployment guide + multi-tenant journal isolation. |
| **Kill signal** | First customer needs multi-region active-active on day one |

---

## 9. HITL / compliance story — UI shipped; production hardening remains

| | |
|---|---|
| **Risk** | HITL pause/resume is gated (CLI + **web UI HTTP API** on main, `feat/hitl-web-ui` merged) but **not yet proven** in regulated production (RBAC, SSO, immutable audit export workflows) |
| **Likelihood** | Medium |
| **Impact** | Regulated buyers want enterprise approver UX, retention, and signed audit trails beyond local replay |
| **Mitigation** | CLI + export bundle + live `POST /api/hitl/input` (see [`docs/hitl-web-ui.md`](hitl-web-ui.md), `npm run gate:hitl-ui`). Sell export-first compliance; roadmap managed layer for RBAC/retention. |
| **Kill signal** | Security review blocks even gated web approval flows or requires features not on the near-term roadmap |

---

## 10. Category timing — “post-AX” confusion

| | |
|---|---|
| **Risk** | Market narrative shifts to “Google solved it”; fundraising in the shadow of AX announcement |
| **Likelihood** | Medium |
| **Impact** | Investors wait; customers pause RFPs |
| **Mitigation** | Lead with **validation report intellectual honesty** — NO-GO on engine, GO on layer. Frame durabl as **insurance against vendor lock-in** (Google, AWS, Azure, LangChain). |
| **Kill signal** | Inbound dries up except “compare us to AX” with no differentiation answer |

---

## Summary matrix

| # | Risk | Severity | Mitigation status |
|---|---|---|---|
| 1 | Google AX | Critical | Narrative pivoted (Phase 0) |
| 2 | Observability crowding | High | Differentiation defined; must execute GTM |
| 3 | Solo engine rebuild | High | Gates + docs forbid scope creep |
| 4 | LLM neutrality in prod | Medium | Evidence partial — needs design partners |
| 5 | Restate-only | Medium | Schema portable; adapters not shipped |
| 6 | Thin-layer monetization | Medium | Managed TBD |
| 7 | Temporal bundling | Medium | Position as neutral export |
| 8 | Single-host gates | Medium | Documented; acceptable for seed |
| 9 | HITL prod/compliance UX | Low–medium | UI + export shipped; enterprise hardening TBD |
| 10 | Post-AX timing | Medium | Honest positioning as feature |

**Before declaring “fundable”:** close risk **#4** (one production provider switch + redacted journal), **#6** (3 design partners or LOIs), and rehearse **#1/#2** answers with [`docs/DEMO-NARRATIVE.md`](DEMO-NARRATIVE.md).
