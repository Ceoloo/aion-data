import type pg from 'pg';
import type { MigrationResult } from './migrations/runner.js';
import { runMigrations } from './migrations/runner.js';
import type { DataLayerConfig } from './db/config.js';
import type { Queryable } from './db/client.js';
import { createPool } from './db/client.js';
import { withTransaction } from './db/transaction.js';
import { PostgresMissionRepository } from './repositories/postgres-mission-repository.js';
import { PostgresWorkflowRepository } from './repositories/postgres-workflow-repository.js';
import { PostgresRunRepository } from './repositories/postgres-run-repository.js';
import { PostgresApprovalStore } from './repositories/postgres-approval-store.js';
import { PostgresEventSink } from './repositories/postgres-event-sink.js';
import { PostgresTelemetrySink } from './repositories/postgres-telemetry-sink.js';
import { PostgresActorRepository } from './repositories/postgres-actor-repository.js';
import { PostgresExecutionRepository } from './repositories/postgres-execution-repository.js';
import { PostgresServiceRepository } from './repositories/postgres-service-repository.js';
import { PostgresOutcomeRepository } from './outcomes/outcome-repository.js';
import { PostgresEconomicsRepository } from './repositories/postgres-economics-repository.js';
import { PostgresEvaluationRepository } from './repositories/postgres-evaluation-repository.js';
import { PostgresAutonomyGrantRepository } from './repositories/postgres-autonomy-grant-repository.js';

/**
 * The set of durable repositories/adapters, bound to a single {@link Queryable}
 * (the pool, or one transaction client). The first ports satisfy AION Core's
 * persistence contracts exactly; `actors`, `executions`, `services`,
 * `outcomes`, and `economics` are aion-data-local repositories (Core defines no
 * port for them except workflows, which Mission 004 promotes to a Core port).
 */
export interface DataRepositories {
  missions: PostgresMissionRepository;
  workflows: PostgresWorkflowRepository;
  runs: PostgresRunRepository;
  approvals: PostgresApprovalStore;
  events: PostgresEventSink;
  telemetry: PostgresTelemetrySink;
  actors: PostgresActorRepository;
  executions: PostgresExecutionRepository;
  services: PostgresServiceRepository;
  outcomes: PostgresOutcomeRepository;
  /** Mission 005 — SQL-derived economics rollups (no second ledger). */
  economics: PostgresEconomicsRepository;
  /** Mission 007 — durable evaluations + scorecard aggregation. */
  evaluations: PostgresEvaluationRepository;
  /** Mission 008 — scoped earned AutonomyGrant store. */
  autonomyGrants: PostgresAutonomyGrantRepository;
}

/** Builds the repository set over any query surface (pool or tx client). */
export function buildRepositories(db: Queryable): DataRepositories {
  return {
    missions: new PostgresMissionRepository(db),
    workflows: new PostgresWorkflowRepository(db),
    runs: new PostgresRunRepository(db),
    approvals: new PostgresApprovalStore(db),
    events: new PostgresEventSink(db),
    telemetry: new PostgresTelemetrySink(db),
    actors: new PostgresActorRepository(db),
    executions: new PostgresExecutionRepository(db),
    services: new PostgresServiceRepository(db),
    outcomes: new PostgresOutcomeRepository(db),
    economics: new PostgresEconomicsRepository(db),
    evaluations: new PostgresEvaluationRepository(db),
    autonomyGrants: new PostgresAutonomyGrantRepository(db),
  };
}

/**
 * The AION Data layer: the durable repository set plus lifecycle operations.
 *
 * Everything the control plane persists reaches Postgres through these
 * repositories, which implement Core's ports — so Core stays database-agnostic
 * and this object is what a Core Orchestrator is wired to.
 */
export interface DataLayer extends DataRepositories {
  /** The underlying pool, for advanced/inspection use. */
  readonly pool: pg.Pool;
  /** Applies all pending migrations (idempotent). */
  migrate(): Promise<MigrationResult[]>;
  /**
   * Runs `fn` with a repository set bound to a single transaction — the atomic
   * multi-write boundary (docs/phase-2.md §Transactions). All writes commit
   * together or roll back together.
   */
  transaction<T>(fn: (repos: DataRepositories) => Promise<T>): Promise<T>;
  /** Closes the pool. Idempotent-safe to call once at shutdown. */
  close(): Promise<void>;
}

/**
 * Creates the AION Data layer from injectable configuration.
 *
 * No hidden global connection and no import-time environment coupling
 * (aion-docs/architecture/environments.md): the caller owns the connection
 * string, so tests point at an isolated database and each environment supplies
 * its own least-privileged credentials.
 */
export function createDataLayer(config: DataLayerConfig): DataLayer {
  const pool = createPool(config);
  const repos = buildRepositories(pool);

  return {
    ...repos,
    pool,
    migrate: () => runMigrations(pool),
    transaction: (fn) => withTransaction(pool, (tx) => fn(buildRepositories(tx))),
    close: () => pool.end(),
  };
}
