# Google Agent Executor (AX) — integration posture

**Status:** positioning + parity map (docs only). **No Google APIs, SDKs, or live AX
calls** — durabl does not import or invoke AX at runtime.

**Primary evidence:** [`docs/phase0/validation-report.md`](../phase0/validation-report.md)
(Phase 0 validation gate, 2026-06-01).

**Audience:** investors, design partners, and engineers asking “why not Google AX?”

---

## 1. What AX is (public facts, not durabl claims)

[Google Agent Executor / AX](https://github.com/google/ax) is described in Phase 0 as an
Apache-2.0, self-hostable runtime with:

| Capability | AX (public narrative) | validation-report |
| --- | --- | --- |
| Durable execution | Event log + snapshotting | §1.2, §2.2 |
| Session consistency | Single-writer | §1.2 |
| Trajectory branching | `ax fork` | §0, §2.2, STATUS |
| Connection recovery | Product narrative | §1.2 |
| Storage | Pluggable; SQLite default | §2.2 |

External links recorded in Phase 0 only (not fetched by durabl tooling): [Google Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime), [`github.com/google/ax`](https://github.com/google/ax).

---

## 2. Fork / replay parity — what AX already ships

Phase 0 treats **engine-level** durability + fork + journal replay as a **parity
baseline** for the market, not as durabl differentiators.

### 2.1 Fork

- **AX:** native **`ax fork`** — branch from a point in the execution log (validation-report §0, §2.3).
- **durabl:** does **not** claim a competing Go distributed runtime or day-one parity with `ax fork` as a built-in primitive. Re-scoped fork is **logical step-level branching** over a structured journal on a proven step-journal substrate (validation-report §4 Attack #1/#3, Decision 1).

### 2.2 Replay

- **AX:** same industry pattern as DBOS, Temporal, Restate, Cloudflare — **step-journal replay** (record non-deterministic outputs once; replay control flow from journal) (validation-report §2.1).
- **durabl:** does **not** claim a novel replay *engine*. Target is **replay-debugging / time-travel DX** over a **portable, neutral** journal (validation-report §4 Attack #7, STATUS).

### 2.3 Parity verdict

At the **engine layer**, AX already covers most of the original brief’s moat (~80%
commoditized per Attack #5). durabl documentation must **not** imply feature parity
with AX as a runtime.

---

## 3. durabl neutrality — what we claim instead

| Theme | durabl | AX / hyperscaler engines |
| --- | --- | --- |
| **Neutrality** | Journal + replay surface not tied to one vendor runtime or cloud | AX log/`fork` are AX-native; AWS/MS paths are cloud-locked (§1.2, §2.2) |
| **Portability** | Export bundle; offline replay with substrate stopped (M3 in `docs/build-status.md`) | Self-hostable AX still centers AX format and tooling |
| **Wedge** | Self-hosted replay + logical fork over **your** journal | AX *is* the executor; trace SaaS lacks the same portable execution-journal story (§1.3, Attack #7) |
| **Build scope** | Thin layer on Restate/DBOS (Decisions 2–4) | Full runtime — not solo-reimplementable (Decision 4) |

**Explicit non-claims**

- No competing distributed durable executor.
- No **feature parity** marketing vs `ax fork` on day one.
- No dependency on Google API access; integration means **honest positioning** and future **journal interchange** (spec-only until demanded).

See also [`docs/FUNDING.md`](../FUNDING.md) (AX position-taker) and [`docs/RISKS.md`](../RISKS.md) (risk #1).

---

## 4. Integration stance (no Google API)

| Direction | Intent | Google API? |
| --- | --- | --- |
| Positioning | Answer “why not AX?” with neutrality + portable journal + offline replay proof | No |
| Future import/export | Conceptual mapping from AX (or other) journals into durabl’s portable bundle | TBD |
| Default runtime | Restate/DBOS reference paths — not AX embedding | No |

**Phase 0 STATUS (validation-report):** **NO-GO** on owning an agent-native durable
execution engine; **conditional GO** on replay-debugging over a neutral, self-hostable
journal. This file exists to keep that boundary explicit.

---

## 5. Phase 0 quick index

| Question | Section |
| --- | --- |
| Did AX close the engine wedge? | §0, §1.2, Attack #4, STATUS |
| Fork vs snapshot vs logical branch? | §4 Attack #1, #3 |
| What remains open? | §1.2 slivers, §2.3, Attack #5, #7 |
| Solo-buildable scope? | Decision 4, Attack #6 |
