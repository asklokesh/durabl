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
  exportJsonlWithEffects,
  exportBundleJsonl,
  type RecordResult,
} from "./journal.js";

// M3 — observability / replay / time-travel (read surface).
export {
  liveJournalSource,
  importJournalSource,
  parseExport,
  type JournalSource,
  type ImportedJournal,
} from "./journal-source.js";

export {
  reconstruct,
  stateAt,
  divergencePoints,
  assertReplayMatches,
  compareSources,
  type ReplayedRun,
  type ReplayStep,
  type ReplayEffect,
  type StateAsOf,
  type DivergencePoint,
  type ReplayDivergence,
} from "./replay.js";

export {
  lineageFrom,
  listForksFrom,
  forkTreeFrom,
  diffTrajectoriesFrom,
  rootRuns,
} from "./inspect-source.js";

export { startServer, type ServerOptions } from "./server.js";

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

export {
  isOtelEnabled,
  withStepSpan,
  withStepSpanAsync,
  type StepSpanAttributes,
} from "./otel.js";

// M5 — human-in-the-loop (HITL) pause/resume + journal-derived pause state.
export {
  hitlAgentRun,
  HITL_PROMISE,
  HITL_STEP,
  type HitlAgentRunService,
} from "./hitl-workflow.js";
export {
  hitlState,
  pausedRuns,
  type HitlState,
} from "./journal.js";
export {
  type HitlWorkflowInput,
  type HitlWorkflowOutput,
  type HitlInput,
} from "./step-model.js";

// M4 — neutrality seams (model provider + deploy target), config-driven.
export {
  type ModelProvider,
  type ModelRequest,
  type ModelCompletion,
  type ModelCallMeta,
  type ProviderDescriptor,
} from "./providers/provider.js";
export {
  getModelProvider,
  configuredProviderId,
  PROVIDER_IDS,
  DEFAULT_PROVIDER_ID,
} from "./providers/registry.js";
export {
  ProviderError,
  redactSecrets,
  type ProviderErrorCode,
} from "./providers/provider-errors.js";
export {
  defaultProviderHttpPolicy,
  fetchWithProviderPolicy,
  type ProviderHttpPolicy,
} from "./providers/provider-http.js";
export {
  dbosJournalSource,
  dbosJournalSourceFromExport,
  dbosJournalSourceFromPath,
  dbosJournalSourceStub,
  dbosJournalSourceAvailable,
  dbosExportJournalSourceAvailable,
  dbosJournalOrigin,
  readDbosJournalSourceConfigFromEnv,
  resolveJournalSourceHint,
  type DbosJournalSourceConfig,
} from "./journal-source-dbos-stub.js";
export {
  getDeployTarget,
  configuredDeployTargetId,
  DEFAULT_DEPLOY_TARGET,
  type DeployTarget,
  type LaunchKind,
} from "./deploy-target.js";
export { recordStepAsync } from "./journal.js";
export {
  JOURNAL_DB_VERSION,
  migrateJournal,
  currentJournalDbVersion,
  type MigrateJournalResult,
} from "./journal-migrate.js";

