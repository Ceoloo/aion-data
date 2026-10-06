import { describe, expect, it } from 'vitest';
import {
  ACTOR_TYPES,
  ACTION_TIERS,
  AGENT_REGISTRY_ENVIRONMENTS,
  AGENT_REVOCATION_STATES,
  APPROVAL_STATUSES,
  AUTONOMY_ENVIRONMENTS,
  AUTONOMY_GRANT_STATUSES,
  AUTONOMY_LEVELS,
  COMMERCIAL_STATUSES,
  DELIVERY_STATUSES,
  EXECUTION_OBJECT_STATUSES,
  EXTERNAL_SIDE_EFFECT_STATUSES,
  MISSION_STATUSES,
  OPERATION_STATUSES,
  OUTCOME_STATUSES,
  RISK_LEVELS,
  RUN_STATES,
  SERVICE_STATUSES,
} from '@aion/core';

/**
 * SQL CHECK members mirrored from migrations 0001–0014.
 *
 * If Core adds/removes an enum member, this test fails until the matching
 * migration (and docs/schema.md) is updated. Do not "fix" by editing only
 * one side — that is how product forks happen.
 */
const SQL_CHECK = {
  actorTypes: ['human', 'agent', 'service', 'system'],
  riskLevels: ['R0', 'R1', 'R2', 'R3'],
  missionStatuses: ['draft', 'active', 'paused', 'completed', 'cancelled'],
  runStates: [
    'created',
    'evaluating',
    'awaiting_approval',
    'approved',
    'executing',
    'completed',
    'failed',
    'denied',
    'cancelled',
  ],
  approvalStatuses: ['pending', 'granted', 'rejected'],
  operationStatuses: ['ok', 'denied', 'pending', 'failed'],
  outcomeStatuses: ['pending', 'realized', 'failed', 'unknown'],
  executionObjectStatuses: [
    'created',
    'evaluating',
    'awaiting_approval',
    'approved',
    'executing',
    'succeeded',
    'failed',
    'denied',
    'cancelled',
  ],
  autonomyLevels: ['L0', 'L1', 'L2', 'L3', 'L4'],
  actionTiers: ['observe', 'assist', 'execute'],
  agentRevocationStates: ['active', 'suspended', 'revoked'],
  agentRegistryEnvironments: ['development', 'staging', 'production'],
  serviceStatuses: ['active', 'inactive', 'deprecated'],
  autonomyEnvironments: ['staging', 'production'],
  autonomyGrantStatuses: ['active', 'revoked', 'expired', 'superseded'],
  externalSideEffectStatuses: ['pending', 'succeeded', 'failed', 'replayed'],
  commercialStatuses: ['prospect', 'signed', 'paid', 'on_hold', 'declined', 'churned'],
  deliveryStatuses: [
    'draft',
    'intake_complete',
    'recommendation_ready',
    'blueprint_draft',
    'blueprint_approved',
    'provisioning',
    'activation_ready',
    'active',
    'accepted',
    'live',
    'on_hold',
    'declined',
  ],
} as const;

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('Core enum ↔ SQL CHECK drift', () => {
  it('actors.actor_type', () => {
    expect(sorted(ACTOR_TYPES)).toEqual(sorted(SQL_CHECK.actorTypes));
  });

  it('risk levels (missions/runs/approvals/executions/services)', () => {
    expect(sorted(RISK_LEVELS)).toEqual(sorted(SQL_CHECK.riskLevels));
  });

  it('missions.status', () => {
    expect(sorted(MISSION_STATUSES)).toEqual(sorted(SQL_CHECK.missionStatuses));
  });

  it('runs.state', () => {
    expect(sorted(RUN_STATES)).toEqual(sorted(SQL_CHECK.runStates));
  });

  it('approvals.status', () => {
    expect(sorted(APPROVAL_STATUSES)).toEqual(sorted(SQL_CHECK.approvalStatuses));
  });

  it('telemetry_records.status (operation)', () => {
    expect(sorted(OPERATION_STATUSES)).toEqual(sorted(SQL_CHECK.operationStatuses));
  });

  it('outcomes.status', () => {
    expect(sorted(OUTCOME_STATUSES)).toEqual(sorted(SQL_CHECK.outcomeStatuses));
  });

  it('executions.status', () => {
    expect(sorted(EXECUTION_OBJECT_STATUSES)).toEqual(
      sorted(SQL_CHECK.executionObjectStatuses),
    );
  });

  it('executions.autonomy_level', () => {
    expect(sorted(AUTONOMY_LEVELS)).toEqual(sorted(SQL_CHECK.autonomyLevels));
  });

  it('actors.action_tier / revocation_state / environment (AIO-44)', () => {
    expect(sorted(ACTION_TIERS)).toEqual(sorted(SQL_CHECK.actionTiers));
    expect(sorted(AGENT_REVOCATION_STATES)).toEqual(
      sorted(SQL_CHECK.agentRevocationStates),
    );
    expect(sorted(AGENT_REGISTRY_ENVIRONMENTS)).toEqual(
      sorted(SQL_CHECK.agentRegistryEnvironments),
    );
  });

  it('services.status', () => {
    expect(sorted(SERVICE_STATUSES)).toEqual(sorted(SQL_CHECK.serviceStatuses));
  });

  it('autonomy_grants.environment / status', () => {
    expect(sorted(AUTONOMY_ENVIRONMENTS)).toEqual(
      sorted(SQL_CHECK.autonomyEnvironments),
    );
    expect(sorted(AUTONOMY_GRANT_STATUSES)).toEqual(
      sorted(SQL_CHECK.autonomyGrantStatuses),
    );
  });

  it('external_side_effects.status', () => {
    expect(sorted(EXTERNAL_SIDE_EFFECT_STATUSES)).toEqual(
      sorted(SQL_CHECK.externalSideEffectStatuses),
    );
  });

  it('implementation_cases.commercial_status / delivery_status', () => {
    expect(sorted(COMMERCIAL_STATUSES)).toEqual(sorted(SQL_CHECK.commercialStatuses));
    expect(sorted(DELIVERY_STATUSES)).toEqual(sorted(SQL_CHECK.deliveryStatuses));
  });
});
