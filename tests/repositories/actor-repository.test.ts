import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRootAuthority,
  capability,
  registryCompleteness,
  toAgentRegistryRecord,
} from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeHuman } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

// Actor round-trip for both a plain (human) actor and a governed agent.
describe('PostgresActorRepository', () => {
  let dl: DataLayer;

  beforeAll(async () => {
    dl = createTestDataLayer();
    await ensureMigrated(dl);
  });
  afterAll(async () => {
    await dl.close();
  });
  beforeEach(async () => {
    await truncateAll(dl);
  });

  it('round-trips a human actor without agent governance fields', async () => {
    const human = makeHuman('Dana');
    await dl.actors.save(human);
    const got = await dl.actors.get(human.actorId);
    expect(got).toEqual(human);
    expect(got!.actorType).toBe('human');
  });

  it('round-trips a governed agent with all governance fields', async () => {
    const agent = makeAgent({ permissions: ['deployment.execute', 'research.web'], maxRiskLevel: 'R2' });
    await dl.actors.save(agent);
    const got = await dl.actors.get(agent.actorId);

    expect(got).toEqual(agent);
    if (!got || got.actorType !== 'agent') throw new Error('expected agent');
    expect(got.agentId).toBe(agent.agentId);
    expect(got.purpose).toBe(agent.purpose);
    expect(got.owner).toBe(agent.owner);
    expect(got.defaultRiskLevel).toBe('R1');
    expect(got.maxRiskLevel).toBe('R2');
    expect(got.permissions).toEqual(agent.permissions);
    expect(got.escalationConditions).toEqual(agent.escalationConditions);
    expect(got.costBudget).toBe(100);
    expect(got.agentUri).toBe(agent.agentUri);
    expect(got.domain).toBe('platform');
    expect(got.role).toBe('worker');
    expect(got.tenantId).toBe('aion-test');
    expect(got.autonomyLevel).toBe('L1');
    expect(got.allowedData).toEqual(['test.fixture']);
    expect(got.evaluationCriteria).toEqual(['test.roundtrip']);
    expect(got.observabilityRequirements).toEqual(['telemetry.cost']);
  });

  it('upserts and lists actors', async () => {
    const human = makeHuman('Eve');
    await dl.actors.save(human);
    await dl.actors.save({ ...human, name: 'Eve Renamed' });
    const list = await dl.actors.list();
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe('Eve Renamed');
  });

  it('round-trips AIO-44 Agent Identity Registry fields (SIS-AG-02)', async () => {
    const now = '2026-10-06T12:00:00.000Z';
    const authority = createRootAuthority({
      subject: { kind: 'human', ref: 'platform-team' },
      tenantId: 'aion-test',
      grantReason: 'fixture grant for registry round-trip',
      capabilities: [capability('deployment.execute')],
      dataScopes: ['test.fixture'],
      createdAt: now,
    });
    const agent = {
      ...makeAgent({ permissions: ['deployment.execute'] }),
      actionTier: 'execute' as const,
      delegatedAuthority: authority,
      policyVersion: 'sis-v1.0/test',
      executionEvidence: 'executions?actor_id={actor_id}',
      revocationState: 'active' as const,
      environment: 'staging' as const,
      credentialMethod: 'vaulted-short-lived',
      approvalRequirements: ['R3 human gate'],
      lastActivity: now,
    };
    expect(registryCompleteness(agent).ok).toBe(true);

    await dl.actors.save(agent);
    const got = await dl.actors.get(agent.actorId);
    expect(got).toEqual(agent);
    if (!got || got.actorType !== 'agent') throw new Error('expected agent');
    expect(got.actionTier).toBe('execute');
    expect(got.policyVersion).toBe('sis-v1.0/test');
    expect(got.executionEvidence).toBe('executions?actor_id={actor_id}');
    expect(got.revocationState).toBe('active');
    expect(got.environment).toBe('staging');
    expect(got.credentialMethod).toBe('vaulted-short-lived');
    expect(got.approvalRequirements).toEqual(['R3 human gate']);
    expect(got.lastActivity).toBe(now);
    expect(got.delegatedAuthority?.authorityId).toBe(authority.authorityId);
    expect(toAgentRegistryRecord(got).permission_tier).toBe('execute');
  });
});
