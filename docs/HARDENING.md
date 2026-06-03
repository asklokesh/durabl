# durabl — Hardening (live providers + HTTP policy)

**Date:** 2026-06-01 · **Evidence:** `npm run gate:live` (skips when no API keys)

---

## Live provider gate

`npm run gate:live` exercises the **real** OpenAI-, Anthropic-, and OpenRouter-compatible paths when keys are present:

| Env var | Provider id | Behavior without key |
|---|---|---|
| `OPENAI_API_KEY` | `openai` | Deterministic `mode:"simulated"` (M4 default) |
| `ANTHROPIC_API_KEY` | `anthropic` | Deterministic `mode:"simulated"` |
| `OPENROUTER_API_KEY` | `openrouter` | Deterministic `mode:"simulated"` |

**Skip contract (CI-safe):** if **no** provider key is set, the gate prints a clear `SKIP` message and **exits 0**. Missing keys never fail CI.

Per provider with a key, the gate asserts:

1. `describe().real === true` and one journaled `recordStepAsync` call returns `mode:"real"`.
2. Replay short-circuit — second `recordStepAsync` at the same `(runId, seq)` sets `replayed=true` and does not invoke the producer.
3. `exportJsonl` → `importJournalSource` → `compareSources` reports **no divergence**.

---

## HTTP policy (real calls only)

When a key is present, providers use `fetchWithProviderPolicy` (`src/providers/provider-http.ts`):

| Knob | Env | Default |
|---|---|---|
| Per-attempt timeout | `DURABL_PROVIDER_TIMEOUT_MS` | `30000` |
| Max attempts (incl. first) | `DURABL_PROVIDER_MAX_ATTEMPTS` | `3` |
| Retry backoff base | `DURABL_PROVIDER_RETRY_BACKOFF_MS` | `500` |

Retries apply only to **429** and **5xx** responses. Errors are thrown as `ProviderError` with **redacted** messages (no key material).

---

## Security baseline

- Keys read from env at call time only; never logged or returned in `describe()` / journal meta.
- Authorization / `x-api-key` headers are the only key usage sites (`# SECURITY-REVIEW` in provider modules).
- Simulated mode is always labelled `mode:"simulated"` in completion meta.

### Replay UI API key (optional)

| Env | Effect |
|---|---|
| *(unset)* | No API auth on mutating `/api/*` |
| `DURABL_API_KEY` | Non-empty shared secret required for `POST` / `PUT` / `PATCH` / `DELETE` on `/api/*`; generic 401 `{ "error": "unauthorized" }` |

No default key is shipped. See `src/api-auth.ts`.

---

## Second substrate stub

`src/journal-source-dbos-stub.ts` — **DBOS** `JournalSource` file-export adapter + throwing stub (Postgres not implemented). See [`docs/SECOND-SUBSTRATE.md`](SECOND-SUBSTRATE.md) and [`docs/integrations/dbos.md`](integrations/dbos.md). CI: `npm run gate:dbos`, `npm run gate:dbos-skip` (includes Postgres NOT RUN banner).

---

## Related

- M4 neutrality gate: `npm run gate:m4`
- Test matrix: [`docs/TEST-MATRIX.md`](TEST-MATRIX.md)
- Build status: [`docs/build-status.md`](build-status.md)
