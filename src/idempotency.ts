// ─────────────────────────────────────────────────────────────────────────────
// IDEMPOTENCY LAYER — the core correctness contract of durabl (M0 §3).
//
// The M0 spike proved that a step-journal engine guarantees only AT-LEAST-ONCE
// step execution across crashes. A crash landing between "side effect fires" and
// "step result is committed" causes a re-fire on replay. End-to-end exactly-once
// therefore requires the side effect to be IDEMPOTENT under a DETERMINISTIC key.
//
// durabl makes this STRUCTURAL, not optional:
//   - The only way to obtain an IdempotencyKey is to derive it from a step's
//     identity (runId + stepName). It is a branded type that cannot be forged
//     from an arbitrary string by accident.
//   - The effect sink REQUIRES an IdempotencyKey (it is in the type signature),
//     so a side effect cannot be fired without one.
//
// Determinism requirement: the key must be a pure function of stable step
// identity, so the SAME logical step computes the SAME key on every replay —
// that is what lets the sink dedup a re-fire to exactly one logical effect.
// ─────────────────────────────────────────────────────────────────────────────

declare const IDEM_BRAND: unique symbol;

/**
 * A deterministic, per-step idempotency key. Branded so it can only originate
 * from {@link deriveIdempotencyKey}; you cannot pass a raw string where an
 * IdempotencyKey is required, which is what makes the contract structural.
 */
export type IdempotencyKey = string & { readonly [IDEM_BRAND]: true };

/** Characters allowed in an identity component. Keeps keys log-safe and stable. */
const SAFE = /^[A-Za-z0-9._:-]+$/;

/**
 * Derive the canonical idempotency key for a step. Deterministic: identical
 * inputs always yield an identical key, across processes and across replays.
 *
 * Format: `<runId>:<stepName>` — the exact contract M0 validated. The runId is
 * the durable workflow identity (stable across crash/replay); the stepName is
 * the stable logical name of the step within the run.
 *
 * @throws if either component is empty or contains characters that would make
 *   the derived key non-deterministic or unsafe to store/log.
 */
export function deriveIdempotencyKey(runId: string, stepName: string): IdempotencyKey {
  if (!runId || !stepName) {
    throw new Error("idempotency key requires non-empty runId and stepName");
  }
  if (!SAFE.test(runId) || !SAFE.test(stepName)) {
    throw new Error(
      `idempotency identity components must match ${SAFE} ` +
        `(got runId=${JSON.stringify(runId)}, stepName=${JSON.stringify(stepName)})`,
    );
  }
  return `${runId}:${stepName}` as IdempotencyKey;
}

/** Narrow a stored string back to an IdempotencyKey when re-reading the journal. */
export function asIdempotencyKey(raw: string): IdempotencyKey {
  if (!raw.includes(":")) {
    throw new Error(`not a valid idempotency key: ${JSON.stringify(raw)}`);
  }
  return raw as IdempotencyKey;
}
