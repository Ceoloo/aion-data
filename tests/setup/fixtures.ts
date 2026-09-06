import {
  Command,
  Run,
  AionEvent,
  TelemetryRecord,
  ApprovalRequest,
  capability,
  createHumanActor,
  createAgentActor,
  createMission,
  newRequestId,
  newRunId,
  newCommandId,
  newCorrelationId,
  newEventId,
  newApprovalId,
} from '@aion/core';
import type {
  Actor,
  AgentActor,
  HumanActor,
  Mission,
  RunId,
  RequestId,
  CommandId,
  CorrelationId,
} from '@aion/core';

/**
 * Contract fixtures for tests. Everything is built through the Core schemas /
 * factories so every fixture is a genuinely valid Core contract object — the
 * tests exercise persistence, not fixture correctness.
 */

const NOW = '2026-02-01T00:00:00.000Z';

export function makeHuman(name = 'Approver Human'): HumanActor {
  return createHumanActor({ name, permissions: [], allowedTools: [] });
}

export function makeAgent(
  overrides: {
    permissions?: string[];
    maxRiskLevel?: 'R0' | 'R1' | 'R2' | 'R3';
    domain?: string;
    role?: string;
    tenantId?: string;
  } = {},
): AgentActor {
  return createAgentActor({
    name: 'WorkerAgent',
    purpose: 'Perform governed work for tests.',
    owner: 'platform-team',
    domain: overrides.domain ?? 'platform',
    role: overrides.role ?? 'worker',
    tenantId: overrides.tenantId ?? 'aion-test',
    permissions: (overrides.permissions ?? ['deployment.execute']).map((c) => capability(c)),
    defaultRiskLevel: 'R1',
    maxRiskLevel: overrides.maxRiskLevel ?? 'R3',
    autonomyLevel: 'L1',
    escalationConditions: ['anything unexpected'],
    allowedData: ['test.fixture'],
    evaluationCriteria: ['test.roundtrip'],
    observabilityRequirements: ['telemetry.cost'],
    costBudget: 100,
  });
}

export function makeMissionFixture(overrides: Partial<{ name: string; riskLevel: 'R0' | 'R1' | 'R2' | 'R3' }> = {}): Mission {
  return createMission({
    name: overrides.name ?? 'Durability Mission',
    owner: 'platform-team',
    objective: 'Prove the control plane is durable.',
    successCriteria: ['runs resume after restart'],
    riskLevel: overrides.riskLevel ?? 'R1',
  });
}

export interface RunFixtureOptions {
  actorId: string;
  missionId?: string;
  state?: Run['state'];
  riskLevel?: 'R0' | 'R1' | 'R2' | 'R3';
  requestId?: RequestId;
  commandId?: CommandId;
  correlationId?: CorrelationId;
}

export function makeRun(opts: RunFixtureOptions): Run {
  return Run.parse({
    runId: newRunId(),
    requestId: opts.requestId ?? newRequestId(),
    ...(opts.missionId ? { missionId: opts.missionId } : {}),
    commandId: opts.commandId ?? newCommandId(),
    actorId: opts.actorId,
    state: opts.state ?? 'created',
    ...(opts.riskLevel ? { riskLevel: opts.riskLevel } : {}),
    correlationId: opts.correlationId ?? newCorrelationId(),
    createdAt: NOW,
    updatedAt: NOW,
  });
}

export function makeCommand(
  actor: Actor,
  overrides: { capability?: string; missionId?: string; requestId?: RequestId } = {},
): Command {
  return Command.parse({
    commandId: newCommandId(),
    requestId: overrides.requestId ?? newRequestId(),
    ...(overrides.missionId ? { missionId: overrides.missionId } : {}),
    name: 'DeployService',
    actor,
    capability: capability(overrides.capability ?? 'deployment.execute'),
    payload: { target: 'prod', build: 42 },
    createdAt: NOW,
    metadata: {},
  });
}

export function makeApproval(run: Run, command: Command): ApprovalRequest {
  return ApprovalRequest.parse({
    approvalId: newApprovalId(),
    runId: run.runId,
    requestId: run.requestId,
    ...(run.missionId ? { missionId: run.missionId } : {}),
    command,
    riskLevel: 'R3',
    reason: 'high-risk action (R3) requires human approval',
    status: 'pending',
    requestedAt: NOW,
  });
}

export function makeEvent(
  overrides: Partial<{
    eventType: AionEvent['eventType'];
    runId: RunId;
    missionId: string;
    correlationId: CorrelationId;
    causationId: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown>;
    timestamp: string;
  }> = {},
): AionEvent {
  return AionEvent.parse({
    eventId: newEventId(),
    eventType: overrides.eventType ?? 'command.received',
    timestamp: overrides.timestamp ?? NOW,
    ...(overrides.runId ? { runId: overrides.runId } : {}),
    ...(overrides.missionId ? { missionId: overrides.missionId } : {}),
    ...(overrides.correlationId ? { correlationId: overrides.correlationId } : {}),
    ...(overrides.causationId ? { causationId: overrides.causationId } : {}),
    payload: overrides.payload ?? { hello: 'world' },
    metadata: overrides.metadata ?? {},
  });
}

export function makeTelemetry(
  overrides: Partial<{
    operation: string;
    status: TelemetryRecord['status'];
    runId: RunId;
    missionId: string;
    durationMs: number;
    cost: number;
    tokenUsage: number;
    riskLevel: 'R0' | 'R1' | 'R2' | 'R3';
    model: string;
    timestamp: string;
  }> = {},
): TelemetryRecord {
  return TelemetryRecord.parse({
    timestamp: overrides.timestamp ?? NOW,
    operation: overrides.operation ?? 'execution',
    status: overrides.status ?? 'ok',
    ...(overrides.runId ? { runId: overrides.runId } : {}),
    ...(overrides.missionId ? { missionId: overrides.missionId } : {}),
    ...(overrides.durationMs !== undefined ? { durationMs: overrides.durationMs } : {}),
    ...(overrides.cost !== undefined ? { cost: overrides.cost } : {}),
    ...(overrides.tokenUsage !== undefined ? { tokenUsage: overrides.tokenUsage } : {}),
    ...(overrides.riskLevel ? { riskLevel: overrides.riskLevel } : {}),
    ...(overrides.model ? { model: overrides.model } : {}),
    metadata: {},
  });
}
