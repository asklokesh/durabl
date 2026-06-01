// Public API surface of the durabl M1 foundation. The journal + idempotency
// contract are the durable assets M2 (replay/time-travel) and M3 (logical fork)
// build on. Substrate (Restate) detail is intentionally NOT re-exported here.

export {
  deriveIdempotencyKey,
  asIdempotencyKey,
  type IdempotencyKey,
} from "./idempotency.js";

export {
  JOURNAL_SCHEMA_VERSION,
  type JournalEntry,
  type RunMeta,
  type StepKind,
  type WorkflowInput,
  type WorkflowOutput,
} from "./step-model.js";

export {
  recordStep,
  getEntry,
  trajectory,
  runMeta,
  ensureRunMeta,
  forkRun,
  exportJsonl,
  type RecordResult,
} from "./journal.js";

export {
  fireEffect,
  effectsFor,
  countEffects,
  type FireResult,
  type EffectRow,
} from "./effect-sink.js";

export { agentRun, type AgentRunService } from "./workflow.js";
export { config } from "./config.js";
