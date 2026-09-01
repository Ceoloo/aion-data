import {
  Orchestrator,
  PolicyEngine,
  ExecutionRegistry,
  ApprovalGate,
  EventEmitter,
  Telemetry,
  systemClock,
} from '@aion/core';
import type {
  ExecutionAdapter,
  PolicyEngineConfig,
  Clock,
} from '@aion/core';
import type { DataLayer } from '../../src/index.js';

export interface PostgresControlPlane {
  orchestrator: Orchestrator;
  policyEngine: PolicyEngine;
  registry: ExecutionRegistry;
  approvalGate: ApprovalGate;
}

export interface ControlPlaneOptions {
  policy?: PolicyEngineConfig;
  adapters?: ExecutionAdapter[];
  clock?: Clock;
}

/**
 * Wires a REAL AION Core Orchestrator to aion-data's durable PostgreSQL
 * adapters. This is the whole point of Phase 2: the same Core kernel that runs
 * on in-memory adapters runs unchanged on Postgres, proving Core stays
 * database-agnostic. Rebuilding this over a freshly-created DataLayer simulates a
 * process restart — the durable store is the only thing that survives.
 */
export function buildPostgresControlPlane(
  dl: DataLayer,
  options: ControlPlaneOptions = {},
): PostgresControlPlane {
  const clock = options.clock ?? systemClock;

  const events = new EventEmitter(dl.events, clock);
  const telemetry = new Telemetry(dl.telemetry, clock);
  const policyEngine = new PolicyEngine(options.policy ?? {}, { clock });
  const approvalGate = new ApprovalGate(dl.approvals, clock);

  const registry = new ExecutionRegistry();
  for (const adapter of options.adapters ?? []) {
    registry.register(adapter);
  }

  const orchestrator = new Orchestrator({
    policyEngine,
    registry,
    approvalGate,
    runRepository: dl.runs,
    events,
    telemetry,
    clock,
  });

  return { orchestrator, policyEngine, registry, approvalGate };
}
