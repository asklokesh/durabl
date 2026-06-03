<!-- /autoplan restore point: /Users/lokesh/.gstack/projects/durabl/main-autoplan-restore-20260603-010916.md -->

# durabl forward work — autoplan review

**Captured:** 2026-06-03 · **Branch:** `main` · **Commit:** `2633742` (newer than doc baseline `39173a5`; includes HITL ingress fix + OpenRouter on ancestry)

**Scope:** Post-ship forward candidates (no code changes in this review). **Mode:** SELECTIVE EXPANSION (CEO). **Voices:** Claude primary; Codex CLI present (`0.132.0`) — auth not exercised in this session → `[subagent-only]` tags on dual-voice tables.

**UI scope:** YES (replay web UI, operator surfaces). **DX scope:** YES (CLI, npm pack, integrations hub, developer tool).

---

## 1. Executive summary

durabl on `main` is **ship-ready** for the M0–M5 product contract: serial `npm run gate:all` passes with evidence at `docs/evidence/gate-all-20260603-010109.log` (`ALL GATES PASSED`, exit 0). The journal, fork, offline replay, HITL restart, replay UI, backend HTTP surface, and packaging/docs final-wave are merged.

**OpenRouter** landed (`5927c30`, default model `39173a5`) as a fifth provider alongside fake/openai/anthropic — config-ready for real HTTP when `OPENROUTER_API_KEY` is set; gates still skip live LLM without keys.

**Forward work** should treat the core milestone line as **closed** and invest in: production hardening (secrets, CI live optional, deploy runbooks), **release channel clarity** (GitHub tarball vs npmjs), operator docs, optional `gate:live` with real keys, and gbrain sync for agent search — not DBOS product, Python SDK, or managed control plane (explicitly NOT-PLANNED).

---

## 2. What's DONE

| Area | Status | Evidence |
|------|--------|----------|
| **M0–M5** | ✅ Gated | `npm test`, `gate:m2`–`m5`, `docs/COMPLETION.md` |
| **gate:all** | ✅ PASS | `gate-all-20260603-010109.log` |
| **final-wave** | ✅ on main | ADRs, OpenAPI, CI, fixtures, security, release docs |
| **UX/UI** | ✅ | Replay UI: fork tree, diff, HITL, theme, hash routes, a11y, e2e (`docs/UI.md`) |
| **backend merges** | ✅ | Health, auth, rate limit, WS, OTEL hooks (`docs/BACKEND.md`) |
| **harden / hitl-ui** | ✅ | `gate:harden`, `gate:hitl-ui` |
| **OpenRouter** | ✅ merged | `src/providers/openrouter-provider.ts`, `.env.example`, tests |
| **integrations docs** | ✅ | Hub + MCP stub, K8s, gh-action (`docs/integrations/`) |

**Recent tip:** `2633742` — HITL empty ingress tolerance for G5 gate stability.

---

## 3. NOT-PLANNED (from `docs/COMPLETION.md`)

| Item | Status | Notes |
|------|--------|-------|
| **Python SDK** | NOT-PLANNED | `docs/PYTHON-SDK.md` stub only; TS ships first |
| **DBOS substrate** | NOT-PLANNED | `journal-source-dbos-stub.ts` + `gate:dbos-skip` only |
| **Managed control plane** | NOT-PLANNED | Narrative in `FUNDING.md` only |
| **Live LLM keys** | Optional / CONFIG-READY | `gate:live` SKIP exit 0 without keys; not required for ship |
| **Offline HITL submit** | NOT-PLANNED (by design) | `POST /api/hitl/input` → 503 offline |
| **Reimplementing durable engine** | NOT-PLANNED | Restate step-journal only |

---

## 4. Proposed next work candidates

Priority order after review (P1 = do first if user approves forward phase):

| P | Candidate | Rationale | Effort (human / CC) |
|---|-----------|-----------|---------------------|
| **P1** | **Production hardening** | Bind `127.0.0.1` default is correct for local dev; operators need TLS termination, `DURABL_API_KEY` rotation doc, CORS matrix, rate-limit tuning, WS opt-in runbook | 2–3 d / ~45 min |
| **P1** | **Release channel decision** | `docs/RELEASING.md` ships **GitHub tarball only**; README/quickstart imply npm install from registry — align story before any `npm publish` | 0.5 d / ~15 min |
| **P2** | **H3 with real keys** | Run `npm run gate:live` in a keyed environment; document OpenRouter in live matrix; optional CI job with secrets (fork PRs only) | 0.5 d / ~20 min |
| **P2** | **Operator docs** | Single "production operator" page: compose/k8s, env table, backup/export, harness lock, gate:all cadence | 1 d / ~25 min |
| **P3** | **npm publish** | Only after API semver + registry policy chosen; `verify-npm-pack.sh` already exists | 1 d / ~30 min |
| **P3** | **Remote / git push hygiene** | Ensure `origin` tracks public repo; tag discipline `v*` per RELEASING | 1 h / ~5 min |
| **P3** | **gbrain sync** | Index durabl for agent search (`/sync-gbrain`); low risk, high DX for future sessions | 15 min / ~10 min |

**Explicitly defer:** DBOS implementation, Python package, hosted SaaS control plane, CRIU/process fork.

---

## 5. Open questions / premises to challenge

### Premises (require human confirmation — NOT auto-decided)

| ID | Premise | Challenge if wrong |
|----|---------|-------------------|
| **P-A** | M0–M5 + final-wave define the **v0.1.0 ship boundary**; forward work is hardening/publish, not M6 feature scope | Re-opens scope creep (DBOS, Python, integrations as product) |
| **P-B** | **Wedge** stays "neutral portable journal on Restate," not a competing agent runtime | Marketing/overbuild confuses buyers |
| **P-C** | **NOT-PLANNED** list remains frozen unless explicit new milestone | Dilutes verified gate story |
| **P-D** | OpenRouter default (`openai/gpt-oss-120b:free`) is for **demo ergonomics**, not production default | Cost/reliability surprises for operators |

### Open strategic questions

1. Is the next public moment **GitHub release tarball** or **npmjs `durabl`**? Docs currently disagree.
2. Should CI run `gate:all` on every PR (slow, ~minutes) or only on `main`/release tags?
3. Is OpenRouter part of the **neutrality proof** (M4 story) or optional convenience?
4. Any customer requiring **offline HITL submit** — would force architectural change (reject per current design)?

---

## Phase 1 — CEO review (SELECTIVE EXPANSION)

### Step 0A — Premise challenge

| Premise | Verdict | Notes |
|---------|---------|-------|
| Engine wedge closed; durabl owns journal/replay/fork/HITL | **Accept** | Phase 0 + gates |
| Self-hostable, exportable history is the moat | **Accept** | M3 offline kill, M5 restart |
| v0.1 ship without npm registry | **Challenge** | RELEASING vs forward "npm publish" candidate |
| OpenRouter = demo not strategic | **Accept with monitor** | Free-tier model may change upstream |

### Step 0B — Existing code leverage

| Forward need | Existing asset |
|--------------|----------------|
| Pack/release | `scripts/verify-release.sh`, `verify-npm-pack.sh`, `.github/workflows/release.yml` |
| Live providers | `gate:live`, `gate:harden` H3, OpenRouter provider |
| Operator UX | `docs/QUICKSTART.md`, `deploy/k8s/`, `docs/integrations/github-actions.md` |
| Security | `http-security.ts`, `api-auth`, rate limits |

### Step 0C — Dream state

```
CURRENT (main)          THIS PLAN (forward)           12-MONTH IDEAL
─────────────────────────────────────────────────────────────────────
Gated OSS journal   →   Hardened ops + clear      →   Default "bring your
+ replay UI             release channel               history" layer for
+ tarball CI            + optional npm                agent frameworks;
                        + keyed live smoke            second substrate
                                                    only if customer $$$
```

### Step 0C-bis — Alternatives

| Approach | Effort | Risk | Pros | Cons |
|----------|--------|------|------|------|
| **A. Harden + tarball only** | Low | Low | Matches RELEASING today | npm users wait |
| **B. npm publish @0.1.0** | Med | Med | `npx durabl` story | Semver/API support burden |
| **C. Hosted preview** | High | High | Revenue path | NOT-PLANNED; scope explosion |

**Auto-decision:** **A** as P1, **B** as explicit gate after release-channel doc (P3).

### Step 0D — SELECTIVE EXPANSION decisions

| Expansion | Decision | Principle |
|-----------|----------|-----------|
| npm publish in same sprint as hardening | **Defer** | P3; blast radius |
| CI `gate:live` with secrets | **Cherry-pick** | P2; <1d CC |
| gbrain sync | **Approve** | P3; no product risk |
| DBOS / Python | **Reject** | P4 NOT-PLANNED |

### Step 0E — Temporal

| Horizon | Outcome |
|---------|---------|
| Hour 1 | Release-channel ADR or RELEASING/README alignment |
| Day 1–3 | Operator doc + hardening checklist |
| Week 2 | Optional npm publish + tagged release |

### Step 0F — Mode

**SELECTIVE EXPANSION** confirmed.

### CEO dual voices — consensus table `[subagent-only]`

```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   Accept  N/A    N/A
  2. Right problem to solve?           Yes     N/A    N/A
  3. Scope calibration correct?      Yes     N/A    N/A
  4. Alternatives sufficiently explored? Yes   N/A    N/A
  5. Competitive/market risks covered? Partial N/A  N/A
  6. 6-month trajectory sound?         Yes     N/A    N/A
═══════════════════════════════════════════════════════════════
```

**Claude subagent (CEO):** Forward phase is correct; biggest risk is **positioning drift** (tarball vs npm) and **over-promising** OpenRouter free tier in production docs.

### NOT in scope (CEO)

- DBOS product integration
- Python SDK implementation
- Managed hosted control plane
- New milestone M6 "multi-tenant SaaS"
- Offline HITL write path

### What already exists

Full M0–M5 gate suite, replay UI, backend API, OpenRouter provider, integration stubs, release workflow.

### Error & Rescue Registry (CEO)

| Failure mode | Detection | Rescue |
|--------------|-----------|--------|
| Doc says npm but only tarball | User confusion | Align RELEASING + README |
| Free OpenRouter model revoked | Provider errors | Document fallback providers |
| gate:all flake on shared lock | CI red | Document lock + `clean-data` |

### Failure Modes Registry (CEO)

| Mode | Severity | Mitigation |
|------|----------|------------|
| Scope creep into DBOS/Python | High | Hold NOT-PLANNED |
| Premature npm publish | Medium | Semver + support policy first |
| Under-documented prod deploy | Medium | Operator doc P2 |

### Dream state delta

This plan closes the **credibility gap** (docs ↔ release mechanism) and **ops gap** (bind-local → production patterns); does not change core journal semantics.

### CEO completion summary

| Metric | Value |
|--------|-------|
| Mode | SELECTIVE EXPANSION |
| Expansions approved | gbrain sync, live gate smoke, operator docs |
| Deferred | npm publish co-shipped with hardening |
| Rejected | DBOS, Python, hosted CP |
| Taste surfaced | Release channel, CI gate:all frequency |

**Phase 1 complete.** Passing to Phase 2 (Design).

---

## Phase 2 — Design review (UI scope: YES)

### Design scope (Step 0)

Completeness vs DESIGN.md: **7/10** — functional replay UI; no formal DESIGN.md in repo (patterns in `web/app.css`, `docs/UI.md`).

### Design litmus scorecard `[subagent-only]`

| Dimension | Score | What would make it 10 |
|-----------|-------|------------------------|
| Hierarchy | 8 | Run list scannability at 100+ runs |
| States | 7 | Skeleton loaders on slow replay fetch |
| Journey | 8 | Clearer offline vs live banner copy |
| Specificity | 8 | Plan already references concrete APIs |
| Accessibility | 7 | e2e exists; audit focus order on HITL form |
| Responsive | 8 | Verified breakpoints in UI.md |
| Polish | 7 | Connection pill + toasts landed |

### Passes 1–7 (summary)

- **Structural:** HITL form needs visible disabled state offline (not just 503 toast) — **auto-fix** in forward UI polish (P2).
- **Aesthetic:** Theme toggle adequate — no change required.
- **TASTE:** Side-by-side vs inline diff default — keep user `localStorage` preference (no change).

### Design dual voices `[subagent-only]`

**Claude subagent:** Missing loading skeleton on `selectRun`; offline HITL should disable submit at UI layer before POST.

**Phase 2 complete.** Passing to Phase 3 (Eng).

---

## Phase 3 — Eng review

### Step 0 — Scope challenge

Examined: `src/server.ts`, `src/providers/openrouter-provider.ts`, harness gates, `docs/RELEASING.md`, recent `2633742` HITL fix.

**Finding:** Core architecture sound for forward phase — changes are **operational and release-process**, not journal schema changes.

### Architecture (ASCII)

```
                    ┌─────────────┐
  Operator ────────►│ server.ts   │──► JournalSource (SQLite / import)
                    │  /api/*     │
                    └──────┬──────┘
                           │ live only
                           ▼
                    ┌─────────────┐
                    │ Restate     │
                    │ ingress     │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ workflow /  │
                    │ hitl-wf     │──► journal.ts + effect-sink
                    └─────────────┘
```

Forward work touches **server bind/TLS proxy**, **CI secrets**, **release scripts** — not workflow graph.

### Test diagram (forward work)

| Forward item | Test type | Exists? | Gap |
|--------------|-----------|---------|-----|
| OpenRouter real HTTP | Integration | Partial (`openrouter-provider.test.ts` simulated) | Add keyed smoke in gate:live |
| npm pack contents | Script | `verify-npm-pack.sh` | Run before publish |
| Release workflow | CI | `release.yml` | No gate:all on tag — document |
| HITL empty ingress | Harness | `2633742` | Covered |

### Test plan artifact

Written: `~/.gstack/projects/durabl/lokesh-main-test-plan-20260603-autoplan.md` (forward-phase checklist).

### Eng dual voices consensus `[subagent-only]`

| Dimension | Claude | Consensus |
|-----------|--------|-----------|
| Architecture sound? | Yes | CONFIRMED |
| Test coverage sufficient? | For ship yes; forward needs live smoke | CONFIRMED |
| Performance risks? | gate:all serial lock — doc only | CONFIRMED |
| Security threats? | API key + localhost bind — document prod | CONFIRMED |
| Error paths? | HITL 502/503 documented | CONFIRMED |
| Deployment risk? | Tarball vs npm confusion | DISAGREE → taste |

### Failure modes (eng)

| Gap | Severity | Action |
|-----|----------|--------|
| No automated gate:all in CI | Medium | Label release checklist |
| OpenRouter not in gate:live matrix doc | Low | Update TEST-MATRIX |

### Eng completion summary

Forward phase is **low architectural risk**; enforce **release-channel doc** before npm publish; run **keyed gate:live** once before marketing "multi-provider."

**Phase 3 complete.** Passing to Phase 3.5 (DX).

---

## Phase 3.5 — DX review (DX POLISH)

### DX scope

Product type: **Developer tool** (CLI + library + local UI). Persona: **platform engineer** wiring agent durability.

### Developer journey (9-stage)

| Stage | Current | Target |
|-------|---------|--------|
| Discover | README | Same |
| Install | npm install / tarball | Clear single path |
| Configure | `.env.example` rich | Operator table |
| First run | `quickstart.sh` | <5 min ✅ |
| Debug | CLI hints, gates | gate:all doc prominent |
| Integrate | integrations hub | MCP stub labeled stub |
| Operate | scattered | **operator doc** |
| Upgrade | semver tags | npm if published |
| Escape hatch | env overrides | Document all DURABL_* |

### TTHW

**Current:** ~5–8 min (install + quickstart + ui). **Target:** 5 min with one install path documented.

### DX scorecard

| Dimension | Score |
|-----------|-------|
| Getting started | 8 |
| API/CLI naming | 8 |
| Error messages | 7 |
| Docs | 7 |
| Upgrade path | 6 |
| Dev environment | 8 |
| Escape hatches | 8 |
| Consistency | 7 |
| **Overall** | **7.4/10** |

### DX dual voices `[subagent-only]`

**Claude subagent:** Split install story (tarball vs npm) hurts TTHW; consolidate README + RELEASING.

### DX implementation checklist (forward)

- [ ] One "Install" section: primary = tarball OR npm (pick one)
- [ ] `docs/OPERATIONS.md` (new): prod deploy, keys, gates, backup
- [ ] OpenRouter in INTEGRATIONS provider table with "simulated without key"
- [ ] gbrain sync for agent discoverability

**Phase 3.5 complete.** Passing to Phase 4 (Final Gate).

---

## Cross-phase themes

1. **Release channel ambiguity** — CEO + Eng + DX (high confidence).
2. **Live provider proof optional** — Eng + DX (document keyed run).
3. **Operator documentation gap** — CEO + DX.

---

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Mode SELECTIVE EXPANSION | Mechanical | P1 | Forward work is polish not rebuild | SCOPE EXPANSION |
| 2 | CEO | Defer npm co-ship with hardening | Mechanical | P3 | Reduce blast radius | Ship npm day 1 |
| 3 | CEO | Reject DBOS/Python/hosted CP | Mechanical | P4 | NOT-PLANNED frozen | Implement DBOS |
| 4 | CEO | Approve gbrain sync | Mechanical | P2 | Low risk DX win | Skip indexing |
| 5 | CEO | Alt A tarball-first | Mechanical | P5 | Matches RELEASING | npm-first |
| 6 | Design | Auto-fix offline HITL disabled UI | Mechanical | P1 | Prevent 503 confusion | Leave as-is |
| 7 | Design | Keep diff localStorage preference | Taste | P5 | User choice | Force inline |
| 8 | Eng | No journal schema changes | Mechanical | P5 | Forward is ops | M6 schema |
| 9 | Eng | Document gate:all not in release CI | Mechanical | P1 | Honest release story | Add gate:all to tag CI |
| 10 | Eng | Keyed gate:live before marketing | Mechanical | P1 | Prove OpenRouter path | Skip live proof |
| 11 | DX | DX POLISH mode | Mechanical | P1 | Tooling maturity pass | DX TRIAGE only |
| 12 | DX | Target TTHW 5 min | Mechanical | P1 | Competitive bar | 15 min acceptable |
| 13 | DX | Create OPERATIONS.md | Mechanical | P2 | Fills operator gap | Scatter in README only |
| 14 | CEO | P1 hardening + release doc | Mechanical | P2 | Completeness | Skip hardening |
| 15 | CEO | OpenRouter as demo default | Taste | P6 | Free tier ergonomics | Production default OpenAI |

**Auto-decided count:** 13 mechanical + 2 taste (listed separately at gate).

---

## GSTACK REVIEW REPORT

### Plan Summary

durabl **v0.1 is complete** on main (gates PASS, OpenRouter merged). Forward work should **harden operations**, **resolve tarball vs npm story**, optionally prove **live providers with real keys**, and add **operator docs** — without reopening NOT-PLANNED substrates.

### Decisions Made

**15** audit rows (**13** auto-decided mechanical, **2** taste, **0** user challenges requiring direction change, **4** premises awaiting confirmation).

### User Challenges

_None_ — no dual-model agreement that the user's forward candidate list is directionally wrong. **Note:** Candidate "npm publish" conflicts with **current** `RELEASING.md` policy; treated as **planned change** requiring explicit approval, not a challenge to reject publish outright.

### Taste decisions

1. **Release channel:** GitHub tarball-first (recommended) vs npm publish in same sprint.
2. **OpenRouter:** Demo default vs document production provider switching only.

### Premises — confirm before implementation

- **P-A:** M0–M5 + final-wave = v0.1 ship boundary  
- **P-B:** Wedge = neutral journal on Restate  
- **P-C:** NOT-PLANNED list stays frozen  
- **P-D:** OpenRouter free model is demo-only  

### Review scores

- **CEO:** SELECTIVE EXPANSION; defer npm; approve ops/docs/gbrain  
- **CEO Voices:** `[subagent-only]` — 5/6 N/A  
- **Design:** 7–8/10; minor offline HITL UI polish  
- **Design Voices:** skipped Codex — subagent notes only  
- **Eng:** Low risk; test plan on disk; align release CI docs  
- **Eng Voices:** `[subagent-only]`  
- **DX:** 7.4/10; fix install story split  
- **DX Voices:** `[subagent-only]`  

### Deferred to TODOS.md

- DBOS product, Python SDK, managed control plane, offline HITL write, M6 SaaS

### Implementation Tasks (aggregated)

_No per-phase tasks-*.jsonl emitted in this session (review-only). Manual checklist in Phase 3 test plan artifact._

---

## Final Approval Gate (for user)

**Recommended next step after approval:** Run **P1 release-channel alignment** (edit `README.md` + `RELEASING.md` to single install path), then **`bash scripts/verify-release.sh` + tag `v0.1.0`** when premises P-A–P-D confirmed. Do **not** implement code until gate option **A** or **B** below.

### AskUserQuestion — D1 Premises `<gstack-qid:autoplan-premises-confirm>`

Confirm premises P-A through P-D before any forward implementation.

- **A) Confirm all four premises** (recommended)  
- **B) Revise premises** (specify which)  
- **C) Reject forward phase** (stay on maintenance only)

### AskUserQuestion — D2 Final approval `<gstack-qid:autoplan-final-gate>`

- **A) Approve as-is** — proceed P1 hardening + release doc alignment  
- **B) Approve with overrides** — specify taste picks (tarball vs npm, OpenRouter doc)  
- **C) Interrogate** — ask about specific audit rows  
- **D) Revise plan** — edit this file and re-run affected phases  
- **E) Reject** — no forward work

---

**STATUS:** `DONE_WITH_CONCERNS` — full pipeline executed Claude-only; premises + final gate require user in parent session.
