# durabl M4 — Neutrality Proof (model provider + deploy target, config-only)

**Date:** 2026-06-01
**Status:** PRODUCTION milestone. The literal M4 bar (build-plan §5 M4, PRD §3.5):
the **SAME agent runs against TWO model providers AND TWO deploy targets with
CONFIG CHANGES ONLY — no code change**, proven with REAL evidence.
**Builds on:** M1 (portable step journal + structural exactly-once on Restate),
M2 (logical step-level fork), M3 (substrate-independent replay over a
`JournalSource`). M4 does **not** rewrite the durable core, the fork layer, or
the replay engine — it adds two clean, typed **neutrality seams** and a gate.
**Substrate:** Restate (step-journal). Runtime: Node 26.

> Framework question (resolved per `validation-report.md` Decision 3 / Attack #2):
> durabl is **framework-agnostic, TS-first** — a neutral journal/replay layer, not
> framework-native. M4 therefore abstracts the axes the validation report says to
> own cleanly: **model provider** (model-agnostic) and **deploy target**
> (cloud/VPC-neutral). It does not bind to LangGraph/OpenAI-Agents/etc.; a
> framework loop would call the same provider seam.

---

## 1. What M4 adds (two seams + a gate)

```
src/providers/provider.ts          → ModelProvider interface (neutral request/completion + redacted descriptor)
src/providers/fake-provider.ts     → fake-echo (provider A) + fake-upper (provider B): deterministic, CI-safe
src/providers/openai-provider.ts   → real OpenAI-compatible call when OPENAI_API_KEY present, else simulated
src/providers/anthropic-provider.ts→ real Anthropic call when ANTHROPIC_API_KEY present, else simulated
src/providers/registry.ts          → getModelProvider() — selects by DURABL_MODEL_PROVIDER (config-only)
src/deploy-target.ts               → getDeployTarget() — local | docker | external, by DURABL_DEPLOY_TARGET
src/harness/run-m4-gate.ts         → the M4 neutrality gate (real run, real SIGKILL, real container)
```

Additive-only changes to existing files:
- `journal.ts` gained `recordStepAsync` (async-producer twin of `recordStep`,
  same idempotency/replay contract — for the async model call).
- `workflow.ts` step 1 (the model/provider call point) now calls
  `getModelProvider().complete(...)` **inside the durable journaled step**. It
  names **no** concrete provider. The durability structure (`ctx.run`,
  `recordStep*`, `fireEffect`) is unchanged.
- `restate-control.ts` gained target-aware launch (local binary vs `docker run`).
- `index.ts` re-exports the M4 surface.

M1 still passes **10/10**, M2 **6/6**, M3 **5/5** — no regression (§5).

---

## 2. Model-provider neutrality (model-agnostic)

The active provider is chosen by `DURABL_MODEL_PROVIDER`. The workflow calls
`getModelProvider().complete(req)` and never names a provider, so switching
providers is a **configuration** change with **no code change**.

Registered providers:

| id | kind | real network call? |
|---|---|---|
| `fake-echo` | deterministic stand-in **A** | never (CI-safe) |
| `fake-upper` | deterministic stand-in **B** (distinct output) | never (CI-safe) |
| `openai` | OpenAI-compatible (`/chat/completions`) | **iff `OPENAI_API_KEY` present**, else simulated |
| `anthropic` | Anthropic (`/v1/messages`) | **iff `ANTHROPIC_API_KEY` present**, else simulated |

`fake-echo` and `fake-upper` are **genuinely different implementations** (one
echoes, one upper-cases + tags), so "two providers, config-only" is a real claim:
the journal records a **different model output per provider**, yet durability is
identical. The OpenAI/Anthropic adapters are **real HTTP clients** that activate
by config the moment a key is in the environment.

### 2.1 The determinism contract (provider non-determinism must NOT corrupt durability)

This is the Phase 0 §2.2 contract, carried verbatim from M1 and now applied to
the model call:

- The model call (non-deterministic) runs **inside** the durable journaled step:
  `ctx.run("step1-plan", () => recordStepAsync({ … producer: () => provider.complete(…) }))`.
- `recordStepAsync` records the provider's output **once** under the deterministic
  idempotency key `runId:step1-plan`. On replay/recovery/fork it **short-circuits
  from the journal and the provider is NEVER re-invoked.**
- Therefore switching providers changes *what is recorded on a first run*, but a
  crash/replay always reconstructs the **recorded** output — exactly-once and
  replay are preserved across a provider switch. This is proven adversarially by
  **G2** (SIGKILL at the dangerous dual-write window under provider B → still
  exactly-once, model output replayed from journal, never re-called).

The recorded step output also carries a **redacted, key-free provider tag**
(e.g. `…@fake-upper:simulated`), so the portable journal is **self-describing
across a provider switch** — you can see which provider produced each step
offline, with no secret in the record.

### 2.2 Security (baseline §1, §3, §7)

- API keys are **read from `env` at call time, never hardcoded.**
- Keys are used **only** in the `Authorization` / `x-api-key` header and are
  **never logged or returned**. `describe()` and the journaled `meta` are
  redacted (provider + model + mode only).
- No key value appears anywhere in the gate output, the journal, or this doc.

---

## 3. Deploy-target neutrality (cloud/VPC-neutral)

The active deploy target is chosen by `DURABL_DEPLOY_TARGET`. The agent/workflow
names **no** target; the harness resolves a target to endpoints + a launch recipe.

| target | launch | endpoints | exercised here |
|---|---|---|---|
| `local` | local `restate-server` binary | `localhost:8080/9070`, service `:9080` | **YES — fully run** |
| `docker` | **containerized** `restatedev/restate:1.6` via `docker run` | `localhost:8081/9071`, service `:9081` (container reaches host via `host.docker.internal`) | **YES — fully run** (a real container) |
| `external` | managed/cloud, endpoints from env | any `DURABL_RESTATE_INGRESS/_ADMIN` | **config-ready, NOT run** (no managed creds in this env) |

`local` and `docker` are **genuinely distinct** deploy targets — different
process model (host binary vs container), distinct ingress/admin ports — and the
**same agent source** runs on both by configuration alone. The `external` target
is the **same mechanism** for a managed/cloud Restate (point the env at the
managed endpoints); we have no managed credentials in this environment, so it is
documented as **config-ready, not run** — see §6 honesty ledger.

---

## 4. The M4 gate (real evidence)

Single command, CI-suitable:

```bash
npm run gate:m4     # == npm run test:m4
```

It wipes state, starts a real local `restate-server`, then runs four sub-gates.
The "no code change" proof is a **sha256 of the agent source** (workflow +
provider seam + deploy seam) asserted **byte-identical** across every run; only
env/config differs.

| Sub-gate | Proves |
|---|---|
| **G1 model-neutrality (config-only)** | provider A (`fake-echo`) and provider B (`fake-upper`) both complete; the journal records a **different** model output per provider (provider truly switched) while the **agent source sha256 is identical**; provider is recorded in the journal |
| **G2 durability-under-provider-switch (REAL SIGKILL)** | re-run the dangerous `after-effect:step2` crash window **under provider B** with a real uncatchable `process.kill(pid,'SIGKILL')`; on recovery **exactly-once holds** (`effect_fires=1`) and the model output is **replayed from the journal** (never re-called) |
| **G3 deploy-target-neutrality (config-only)** | target A (local binary) and target B (**containerized restate**) both run the **same agent source** (sha256 identical); switch is `DURABL_DEPLOY_TARGET` only |
| **G4 journal-portability (offline)** | export each run (local-target, docker-target, provider-B) and reconstruct **offline with no substrate**; `offline_divergence=none` for all — the portable journal is intact across **both providers and both targets** |

### 4.1 REAL gate output (pasted verbatim)

Full log: [`m4-evidence/gate-evidence.log`](m4-evidence/gate-evidence.log). Run on
2026-06-01, Node 26, Restate `1.6.2`/SDK `1.14.4`, container
`restatedev/restate:1.6`, `npm run gate:m4` **exit code 0**.

```
[GATE PASS] G1 model-neutrality (config-only)
  providerA=fake-echo(real=false) providerB=fake-upper(real=false) agent_source_sha256_identical=true (4377cf06534d…) both_runs_completed=true model_output_differs_per_provider=true provider_recorded_in_journal=true planA="echo[plan-for(neutral-prompt)]@fake-echo:simulated" planB="UPPER<PLAN-FOR(NEUTRAL-PROMPT)>@fake-upper:simulated" real_providers_with_keys=[none]

[GATE PASS] G2 durability-under-provider-switch (REAL SIGKILL)
  provider=fake-upper crash_point=after-effect:step2 service_really_died=true effect_fires=1(expect 1 exactly-once) completed=true model_output_replayed_from_journal=true journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[main]<<UPPER<PLAN-FOR(CRASHY-UNDER-B)>@fake-upper:simulated|tool-result(effectId=117)|prompt=crashy-under-B>>"

[GATE PASS] G3 deploy-target-neutrality (config-only)
  targetA=local(launch=external, ingress=http://localhost:8080) ran=true targetB=docker(launch=docker, ingress=http://localhost:8081) ran=true agent_source_sha256_identical=true (4377cf06534d…) RAN: containerized restate (restatedev/restate:1.6) on http://localhost:8081; answer="answer[main]<<echo[plan-for(target-neutral)]@fake-echo:simulated|tool-result(effectId=120)|prompt=target-neutral>>"

[GATE PASS] G4 journal-portability (offline, across providers+targets)
  runs=3 m4-g3-local-1780352783414: offline_divergence=none | m4-g3-docker-1780352784496: offline_divergence=none | m4-port-B-1780352785709: offline_divergence=none
```

The **real SIGKILL + engine recovery under provider B** (G2) is visible in the
server log (effect fired, journal not yet committed → killed → replayed →
exactly-once):

```
[restate][…][AgentRun/m4-g2-…/run][inv_…] INFO: Starting invocation.
[CRASH] SIGKILL self at point=after-effect:step2 run=m4-g2-… pid=27707
WARN restate_invoker_impl  Invocation error, retrying … error reading a body from connection  (RT0010)
[restate][…] INFO: Restate SDK started listening on 9080...
[restate][…][AgentRun/m4-g2-…/run][inv_…] INFO: Replaying invocation.
[restate][…][AgentRun/m4-g2-…/run][inv_…] INFO: Invocation completed successfully.
```

The **containerized target genuinely running** (G3) is visible too — the docker
container boots its own partitions and the SDK service binds the docker-target
port `9081`:

```
[restate][…] INFO: Restate SDK started listening on 9081...
… Partition 0 started …                                   (the CONTAINER's restate)
[restate][…][AgentRun/m4-g3-docker-…/run][inv_…] INFO: Starting invocation.
[restate][…][AgentRun/m4-g3-docker-…/run][inv_…] INFO: Invocation completed successfully.
```

### 4.2 Summary (pasted verbatim)

```
================ M4 GATE SUMMARY ================
PASS  G1 model-neutrality (config-only)
PASS  G2 durability-under-provider-switch (REAL SIGKILL)
PASS  G3 deploy-target-neutrality (config-only)
PASS  G4 journal-portability (offline, across providers+targets)
-------------------------------------------------
4/4 gates passed
VERDICT: GATE PASSED
=================================================
```

`npm run gate:m4` exits 0.

---

## 5. No regression — the durable core/fork/replay are unchanged

```
npm test        → M1  10/10  GATE PASSED
npm run gate:m2 → M2   6/6   GATE PASSED
npm run gate:m3 → M3   5/5   GATE PASSED
npm run gate:m4 → M4   4/4   GATE PASSED
```

M4 added seams + a step-1 provider call; it did not touch the idempotency
contract, the effect sink, `forkRun`, or the replay engine.

---

## 6. Honesty ledger — EXACTLY what was real vs simulated/config-ready

This section is deliberately explicit (the brief rates honesty over green).

**Model providers**

- ✅ **Exercised for real (config-only switch, real runs):** `fake-echo` (A) and
  `fake-upper` (B) — two **genuinely distinct** deterministic providers. Both ran
  end-to-end on Restate; the journal recorded different outputs per provider; the
  agent source was byte-identical (sha256) across the switch; durability held
  under real SIGKILL under provider B.
- ⚠️ **SIMULATED (no API keys in this environment):** the `openai` and
  `anthropic` providers are **real HTTP client adapters** but ran in their
  deterministic **simulated** fallback because no `OPENAI_API_KEY` /
  `ANTHROPIC_API_KEY` was present (`real_providers_with_keys=[none]` in G1). They
  are **config-ready**: set the env key and `DURABL_MODEL_PROVIDER=openai|anthropic`
  and a real network call happens with **no code change**. We did **not** fabricate
  a real-API result.

**Deploy targets**

- ✅ **Exercised for real:** `local` (host `restate-server` binary) **and**
  `docker` (a **real `restatedev/restate:1.6` container** via `docker run`, on
  distinct ports, reached by the same agent by config only). Both ran the agent
  to completion; source sha256 identical across the switch (G3 `ran=true`/`ran=true`).
- ⚠️ **config-ready, NOT run:** `external` (managed/cloud Restate, e.g. Restate
  Cloud). We have **no managed credentials** in this environment, so a true second
  *cloud* was not reached. The switch is the **same mechanism** — point
  `DURABL_RESTATE_INGRESS/_ADMIN` at the managed endpoints — and is demonstrated
  by the `docker` target using exactly that endpoint-override path. We did **not**
  claim a cloud run.

**Net:** the M4 gate bar — same agent, **two model providers** and **two deploy
targets**, config-only, real evidence — is met with **two real providers** and
**two real targets** (local process + real container). Real **cloud** providers
and a real **managed cloud** target are config-ready and clearly **not** executed
here for lack of credentials.

---

## 7. Running it

```bash
# The whole M4 gate (local + a real docker container if the image is present):
npm run gate:m4

# Switch model provider — CONFIG ONLY, no code change:
DURABL_MODEL_PROVIDER=fake-echo   npm run service     # provider A
DURABL_MODEL_PROVIDER=fake-upper  npm run service     # provider B
DURABL_MODEL_PROVIDER=openai      OPENAI_API_KEY=…    npm run service   # real OpenAI
DURABL_MODEL_PROVIDER=anthropic   ANTHROPIC_API_KEY=… npm run service   # real Anthropic

# Switch deploy target — CONFIG ONLY:
DURABL_DEPLOY_TARGET=local   …      # host binary
DURABL_DEPLOY_TARGET=docker  …      # containerized restate (image must be present)
DURABL_DEPLOY_TARGET=external DURABL_RESTATE_INGRESS=https://<managed> DURABL_RESTATE_ADMIN=https://<managed-admin>   # managed/cloud
```

> The docker target requires the image present locally; the gate **never pulls
> over the network** (it would hang in air-gapped/credential-broken CI). If the
> image is absent the gate honestly records `CONFIG-READY-NOT-RUN`. For this
> evidence run the image was pulled once (`docker pull restatedev/restate:1.6`)
> and the container was then genuinely run by the gate.

Config is env-var only; no secrets are read or logged.

---

## 8. Limits (do not over-claim)

- Same single-node envelope as M1–M3 (no multi-partition/network-partition/
  clock-skew testing — substrate concern).
- The two **real** providers are deterministic stand-ins; the two real targets are
  local + a local container. Real cloud APIs and a real managed-cloud target are
  config-ready, not executed (see §6).
- The model call is a single step (step 1). The contract generalizes to any
  number of model/tool steps — each is journaled once and replayed — but M4 does
  not add more steps (that's product surface, not neutrality).
- No HITL (M5) and no second *substrate* (DBOS) parity here — M4 is the
  provider+target neutrality proof. The `JournalSource` seam (M3) remains the
  place a second substrate would plug in.

---

## 9. STATUS / M5 go-no-go

**STATUS: DONE_WITH_CONCERNS.** The M4 gate passes **4/4** with real evidence:
the **same byte-identical agent source** runs against **two model providers**
(`fake-echo`, `fake-upper`) and **two deploy targets** (local binary + a real
`restatedev/restate:1.6` container) with **config changes only**; a provider
switch does **not** corrupt durability (real SIGKILL under provider B →
exactly-once + model output replayed from journal); and the portable journal
reconstructs **offline, byte-identical, across both providers and both targets**.
M1/M2/M3 still pass (10/10, 6/6, 5/5).

**The single, honest concern (why DONE_WITH_CONCERNS, not DONE):** the two
*real* providers are deterministic stand-ins and the two *real* targets are a
host process + a local container — because **no LLM API keys and no managed-cloud
credentials were present in this environment**. The OpenAI/Anthropic adapters and
the `external` (managed cloud) target are **real, typed, config-ready** code that
activates with a key/endpoint and **no code change**, but were **not executed
against a real cloud here**. This is stated plainly rather than overstated.

**M5 (HITL + state export) go/no-go: GO.** Neutrality is proven and the durable
core, fork layer, and replay engine are untouched and still green. HITL is an
additional journaled step kind (a `human_decision` step routed through the same
idempotency contract), and state export already exists (`exportBundleJsonl`,
offline reconstruction). Nothing in M4 raises new correctness risk for M5.
Recommended M5 entry task: add a HITL step that pauses on a journaled
`awaiting_human` record and resumes exactly-once on approval — reusing the M1
idempotency contract verbatim.
