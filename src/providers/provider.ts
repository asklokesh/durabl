// ─────────────────────────────────────────────────────────────────────────────
// MODEL PROVIDER SEAM (M4 — model-provider neutrality, PRD §3.5).
//
// The reference agent must run against TWO model providers with CONFIG CHANGES
// ONLY — no code change (the M4 gate). This module is that seam: a small, typed
// interface every provider implements, plus a registry that selects the active
// provider from the environment (DURABL_MODEL_PROVIDER). The workflow calls
// `getModelProvider().complete(...)` and never names a concrete provider.
//
// DETERMINISM CONTRACT (Phase 0 §2.2, carried from M1): a model call is
// non-deterministic, so its RESULT is what must be durable, not the call. The
// workflow performs the model call INSIDE a journaled step (recordStep ->
// ctx.run), so the provider's output is recorded ONCE into the portable journal
// and REPLAYED from the journal thereafter. Switching providers therefore cannot
// corrupt exactly-once or replay: on recovery/replay the already-recorded model
// output short-circuits and the provider is never re-invoked. This is proven by
// the M4 gate (crash boundary under provider B → exactly-once + replay hold).
//
// SECURITY: API keys are read from env at call time, NEVER hardcoded, NEVER
// logged. `describe()` returns a redacted, key-free descriptor safe to journal
// and print. See security baseline §1, §7.
// ─────────────────────────────────────────────────────────────────────────────

/** A single, neutral model request. Provider-agnostic by construction. */
export interface ModelRequest {
  /** Stable system instruction (kept deterministic by the caller). */
  readonly system: string;
  /** The user prompt for this step. */
  readonly prompt: string;
  /** Optional decode controls; providers map these to their own params. */
  readonly maxTokens?: number;
}

/**
 * A neutral model completion. `text` is what gets recorded into the journal as
 * the step output (the determinism anchor). `meta` is redacted, key-free, and
 * also journal-safe — it records WHICH provider/model produced the output so the
 * journal is self-describing across a provider switch.
 */
export interface ModelCompletion {
  readonly text: string;
  readonly meta: ModelCallMeta;
}

/** Redacted, key-free descriptor of a completed model call — safe to journal. */
export interface ModelCallMeta {
  readonly provider: string;
  readonly model: string;
  /** "real" = a real network call happened; "simulated" = deterministic stand-in. */
  readonly mode: "real" | "simulated";
}

/** A redacted, key-free provider descriptor — safe to print/journal. */
export interface ProviderDescriptor {
  readonly provider: string;
  readonly model: string;
  /** Whether this provider WOULD make a real network call (a key is present). */
  readonly real: boolean;
  /** Human note for evidence (e.g. "no ANTHROPIC_API_KEY in env → simulated"). */
  readonly note: string;
}

/**
 * The provider seam. A provider turns a neutral {@link ModelRequest} into a
 * neutral {@link ModelCompletion}. Implementations may call a real API (when a
 * key is present in env) or be a deterministic stand-in. The workflow depends on
 * this interface ONLY — never on a concrete provider — so the active provider is
 * a configuration choice, not a code choice.
 */
export interface ModelProvider {
  /** Stable provider id, e.g. "fake-echo", "openai", "anthropic". */
  readonly id: string;
  /** Redacted descriptor (no secrets) for evidence/logging. */
  describe(): ProviderDescriptor;
  /**
   * Produce a completion. MUST be deterministic in `simulated` mode (so the
   * journal/replay contract holds in CI without keys). In `real` mode the
   * RESULT is recorded into the journal by the caller, which is what preserves
   * determinism across replay despite the API's non-determinism.
   */
  complete(req: ModelRequest): Promise<ModelCompletion>;
}
