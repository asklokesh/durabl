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
  childRuns,
  allRunIds,
  exportJsonl,
  type RecordResult,
} from "./journal.js";

// M2 — trajectory branching: fork API + read-only inspection surface.
export {
  validateForkPlan,
  seedFork,
  forkAndRun,
  ForkError,
  type ForkDecision,
  type ForkPlan,
  type ForkResult,
  type SubstrateInvoke,
} from "./fork.js";

export {
  inspectRun,
  lineage,
  listForks,
  forkTree,
  diffTrajectories,
  type RunInspection,
  type EffectView,
  type LineageNode,
  type ForkTreeNode,
  type StepDiff,
  type StepDiffStatus,
  type TrajectoryDiff,
} from "./inspect.js";

export {
  fireEffect,
  effectsFor,
  countEffects,
  type FireResult,
  type EffectRow,
} from "./effect-sink.js";

export { agentRun, type AgentRunService } from "./workflow.js";
export { config } from "./config.js";
