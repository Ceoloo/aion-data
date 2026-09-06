/**
 * AION Data — public API.
 *
 * The canonical durable truth layer for the AION control plane. It implements
 * AION Core's persistence PORTS with PostgreSQL adapters so the Phase 1 Core
 * lifecycle survives process restarts, while Core stays database-agnostic:
 *
 *   AION Core (ports/contracts)  →  AION Data (adapters)  →  PostgreSQL
 *
 * Core governs behavior; Data persists truth. Consumers import from this entry
 * point only — internal module paths are not part of the contract.
 */

// ── Data layer factory + repository set ─────────────────────────────────────
export {
  createDataLayer,
  buildRepositories,
  type DataLayer,
  type DataRepositories,
} from './data-layer.js';

// ── Configuration + DB primitives (injectable; no global connection) ────────
export { type DataLayerConfig, configFromEnv } from './db/config.js';
export { createPool, type Queryable } from './db/client.js';
export { withTransaction } from './db/transaction.js';

// ── Durable Core-port adapters ──────────────────────────────────────────────
export { PostgresMissionRepository } from './repositories/postgres-mission-repository.js';
export { PostgresWorkflowRepository } from './repositories/postgres-workflow-repository.js';
export {
  PostgresRunRepository,
  type VersionedRun,
} from './repositories/postgres-run-repository.js';
export { PostgresApprovalStore } from './repositories/postgres-approval-store.js';
export { PostgresEventSink } from './repositories/postgres-event-sink.js';
export { PostgresTelemetrySink } from './repositories/postgres-telemetry-sink.js';

// ── aion-data-local repositories (no Core port) ─────────────────────────────
export { PostgresActorRepository } from './repositories/postgres-actor-repository.js';
export { PostgresExecutionRepository } from './repositories/postgres-execution-repository.js';
export { PostgresServiceRepository } from './repositories/postgres-service-repository.js';
export { PostgresOutcomeRepository } from './outcomes/outcome-repository.js';
export {
  type OutcomeRecord,
  type CreateOutcomeInput,
  type UpdateOutcomeInput,
} from './outcomes/outcome.js';
export { PostgresEconomicsRepository } from './repositories/postgres-economics-repository.js';
export { PostgresEvaluationRepository } from './repositories/postgres-evaluation-repository.js';
export { PostgresAutonomyGrantRepository } from './repositories/postgres-autonomy-grant-repository.js';

// ── Migrations ──────────────────────────────────────────────────────────────
export {
  runMigrations,
  readMigrations,
  defaultMigrationsDir,
  type Migration,
  type MigrationResult,
} from './migrations/runner.js';

// ── Mappers (persistence boundary; validated row ⇄ contract) ────────────────
export { rowToMission, missionToColumns } from './mappers/mission-mapper.js';
export { rowToWorkflow, workflowToColumns } from './mappers/workflow-mapper.js';
export { rowToRun, runToColumns } from './mappers/run-mapper.js';
export { rowToApprovalRequest, approvalToColumns } from './mappers/approval-mapper.js';
export { rowToEvent, eventToColumns } from './mappers/event-mapper.js';
export { rowToTelemetryRecord, telemetryToColumns } from './mappers/telemetry-mapper.js';
export { rowToActor, actorToColumns } from './mappers/actor-mapper.js';
export {
  rowToExecution,
  executionToColumns,
} from './mappers/execution-mapper.js';
export { rowToService, serviceToColumns } from './mappers/service-mapper.js';
export {
  rowToOutcomeRecord,
  outcomeToColumns,
  toOutcomeReference,
} from './mappers/outcome-mapper.js';
export {
  rowToEvaluation,
  evaluationToColumns,
} from './mappers/evaluation-mapper.js';
export {
  rowToAutonomyGrant,
  autonomyGrantToColumns,
} from './mappers/autonomy-grant-mapper.js';

// ── Errors ──────────────────────────────────────────────────────────────────
export {
  DataError,
  ConfigError,
  MigrationError,
  MappingError,
  PersistenceError,
  ConcurrencyError,
  NotFoundError,
  isDataError,
  DATA_ERROR_CODES,
  type DataErrorCode,
} from './errors/index.js';
