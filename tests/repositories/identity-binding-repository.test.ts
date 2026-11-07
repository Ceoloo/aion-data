import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeHuman } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

describe('Sentinel identity bindings (real Postgres)', () => {
  let dl: DataLayer;

  beforeAll(async () => {
    dl = createTestDataLayer();
    await ensureMigrated(dl);
  });
  beforeEach(async () => { await truncateAll(dl); });
  afterAll(async () => { await dl.close(); });

  const issuer = 'https://auth.example.test/realms/aion';
  const subject = '01234567-abcd-abcd-abcd-0123456789ab';
  const clientId = 'aion-console';

  async function insert(active = true, expires: string | null = null) {
    const actor = makeHuman('Sentinel Test Operator');
    await dl.actors.save(actor);
    await dl.pool.query(
      `INSERT INTO aion_auth.principal_bindings (
         issuer, subject, client_id, principal_id, actor_id, kind,
         tenant_ids, roles, status, expires_at, provisioned_by, changed_by
       ) VALUES ($1,$2,$3,$4,$5,'operator',$6::text[],$7::text[],$8,$9,$10,$10)`,
      [issuer, subject, clientId, 'principal-test-1', actor.actorId,
        ['tenant-a'], ['invoke', 'approve'], active ? 'active' : 'disabled',
        expires, 'security-owner'],
    );
    return actor;
  }

  it('finds active, unexpired mapping by exact issuer/sub/client', async () => {
    const actor = await insert();
    expect(await dl.identityBindings.getActive({ issuer, subject, clientId })).toEqual({
      issuer, subject, clientId, principalId: 'principal-test-1',
      actorId: actor.actorId, kind: 'operator', tenantIds: ['tenant-a'],
      roles: ['invoke', 'approve'], status: 'active',
    });
  });

  it('fails closed for another issuer, subject or client', async () => {
    await insert();
    for (const lookup of [
      { issuer: 'https://other.example/realms/aion', subject, clientId },
      { issuer, subject: 'different-subject', clientId },
      { issuer, subject, clientId: 'other-client' },
    ]) {
      expect(await dl.identityBindings.getActive(lookup)).toBeUndefined();
    }
  });

  it('disabled, revoked and expired identity bindings disappear', async () => {
    await insert(false);
    const input = { issuer, subject, clientId };
    expect(await dl.identityBindings.getActive(input)).toBeUndefined();
    await dl.pool.query(`UPDATE aion_auth.principal_bindings SET status = 'active',
      expires_at = now() - interval '1 second' WHERE subject = $1`, [subject]);
    expect(await dl.identityBindings.getActive(input)).toBeUndefined();
    await dl.pool.query(`UPDATE aion_auth.principal_bindings SET status = 'revoked',
      expires_at = NULL WHERE subject = $1`, [subject]);
    expect(await dl.identityBindings.getActive(input)).toBeUndefined();
  });

  it('rejects invalid roles and non-operator approval at SQL boundary', async () => {
    await insert();
    await expect(dl.pool.query(`UPDATE aion_auth.principal_bindings
      SET roles = ARRAY['register'] WHERE subject = $1`, [subject])).rejects.toThrow();
    await expect(dl.pool.query(`UPDATE aion_auth.principal_bindings
      SET kind = 'agent-worker' WHERE subject = $1`, [subject])).rejects.toThrow();
  });

  it('foreign key blocks bindings for nonexistent Actor; no implicit registration', async () => {
    await expect(dl.pool.query(
      `INSERT INTO aion_auth.principal_bindings
        (issuer, subject, client_id, principal_id, actor_id, kind, tenant_ids,
         roles, status, provisioned_by, changed_by)
       VALUES ($1,$2,$3,'principal-test-1','missing-actor','operator',
         ARRAY['tenant-a'], ARRAY['invoke'], 'active','owner','owner')`,
      [issuer, subject, clientId],
    )).rejects.toThrow();
  });
});
