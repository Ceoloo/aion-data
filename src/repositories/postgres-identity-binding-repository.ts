import type { Queryable } from '../db/client.js';
import { toPersistenceError } from '../errors/index.js';

/**
 * Pre-auth mapping source for Sentinel/Runtime: aion_auth is readable by the
 * trusted runtime service only, outside tenant-RLS context. Caller cannot
 * select arbitrary permissions from the token or request.
 */
export interface ActiveIdentityBinding {
  issuer: string;
  subject: string;
  clientId: string;
  principalId: string;
  actorId: string;
  kind: 'operator' | 'service' | 'agent-worker';
  tenantIds: string[];
  roles: Array<'invoke' | 'approve'>;
  status: 'active';
}

interface IdentityBindingRow {
  issuer: string;
  subject: string;
  client_id: string;
  principal_id: string;
  actor_id: string;
  kind: string;
  tenant_ids: string[];
  roles: string[];
  status: string;
}

const safeId = (s: string) =>
  /^[A-Za-z0-9._:/-]{1,128}$/.test(s);

export class PostgresIdentityBindingRepository {
  constructor(private readonly db: Queryable) {}

  /** No writes, no onboarding, no in-memory fallback. Returns only active
   * and unexpired bindings from the canonical identity registry. */
  async getActive({
    issuer,
    subject,
    clientId,
  }: {
    issuer: string;
    subject: string;
    clientId: string;
  }): Promise<ActiveIdentityBinding | undefined> {
    if (!issuer.startsWith('https://') || !safeId(subject) || !safeId(clientId)) {
      return undefined;
    }
    try {
      const { rows } = await this.db.query<IdentityBindingRow>(
        `SELECT issuer, subject, client_id, principal_id, actor_id, kind,
                tenant_ids, roles, status
           FROM aion_auth.principal_bindings
          WHERE issuer = $1 AND subject = $2 AND client_id = $3
            AND status = 'active'
            AND (expires_at IS NULL OR expires_at > now())`,
        [issuer, subject, clientId],
      );
      const row = rows[0];
      if (!row || row.issuer !== issuer || row.subject !== subject ||
          row.client_id !== clientId || row.status !== 'active') return undefined;
      if (!safeId(row.principal_id) || !safeId(row.actor_id) ||
          !['operator', 'service', 'agent-worker'].includes(row.kind) ||
          !Array.isArray(row.tenant_ids) || row.tenant_ids.length === 0 ||
          !row.tenant_ids.every(safeId) ||
          new Set(row.tenant_ids).size !== row.tenant_ids.length ||
          !Array.isArray(row.roles) || row.roles.length === 0 ||
          !row.roles.every((v) => v === 'invoke' || v === 'approve') ||
          new Set(row.roles).size !== row.roles.length ||
          (row.kind !== 'operator' && row.roles.includes('approve'))) {
        return undefined;
      }
      return {
        issuer: row.issuer,
        subject: row.subject,
        clientId: row.client_id,
        principalId: row.principal_id,
        actorId: row.actor_id,
        kind: row.kind as ActiveIdentityBinding['kind'],
        tenantIds: [...row.tenant_ids],
        roles: [...row.roles] as ActiveIdentityBinding['roles'],
        status: 'active',
      };
    } catch (cause) {
      throw toPersistenceError('lookup active identity binding', cause, {
        // Do not log issuer/sub/client in DB failure details.
        resource: 'aion_auth.principal_bindings',
      });
    }
  }
}
