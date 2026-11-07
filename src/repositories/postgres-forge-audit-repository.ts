import { createHash } from 'node:crypto';
import type { Queryable } from '../db/client.js';
import { toPersistenceError } from '../errors/index.js';

const identifier = (x: unknown): x is string =>
  typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const uuid = (x: unknown): x is string =>
  typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const types = new Set(['forge.session.requested','forge.session.runtime_result',
  'forge.session.runtime_error','forge.session.unknown_response']);
const statuses = new Set(['awaiting_approval','denied','failed','completed']);
const allowedKeys = new Set(['eventId','schemaVersion','recordedAt','type','requestId',
  'tenantId','principalId','actorId','workspaceId','template','status','runId','executionId']);

export interface ForgeAuditRecord {
  eventId: string;
  schemaVersion: 'forge.audit.v1';
  recordedAt: string;
  type: string;
  requestId: string;
  tenantId: string;
  principalId: string;
  actorId: string;
  workspaceId: string;
  template: 'implementer' | 'reviewer';
  status?: string;
  runId?: string;
  executionId?: string;
}
export interface ForgeAuditAck { eventId: string; committed: true; }
interface FingerprintRow { fingerprint_sha256: string; }

/**
 * Runtime-side, Data-owned append-only security evidence. THIS IS NOT A PUBLIC
 * TENANT-SUPPLIED WRITE API. Runtime must derive principal, actor and tenant
 * from authenticated request context and scope the DB connection to that tenant.
 */
export class PostgresForgeAuditRepository {
  constructor(private readonly db: Queryable) {}

  async append(record: ForgeAuditRecord): Promise<ForgeAuditAck> {
    if (!record || typeof record !== 'object' || Object.keys(record).some(k => !allowedKeys.has(k)) ||
        !uuid(record.eventId) || record.schemaVersion !== 'forge.audit.v1' ||
        !types.has(record.type) || !/^forge-[A-Za-z0-9-]{8,100}$/.test(record.requestId) ||
        ![record.tenantId,record.principalId,record.actorId,record.workspaceId].every(identifier) ||
        !['implementer','reviewer'].includes(record.template) ||
        (record.status !== undefined && !statuses.has(record.status)) ||
        (record.runId !== undefined && !identifier(record.runId)) ||
        (record.executionId !== undefined && !identifier(record.executionId))) {
      throw new TypeError('invalid Forge security evidence');
    }
    // Server timestamps are authoritative; client recordedAt is NOT used for storage.
    const canonical = JSON.stringify(Object.fromEntries(
      Object.entries({type:record.type,requestId:record.requestId,
        tenantId:record.tenantId,principalId:record.principalId,actorId:record.actorId,
        workspaceId:record.workspaceId,template:record.template,
        ...(record.status === undefined ? {} : {status:record.status}),
        ...(record.runId === undefined ? {} : {runId:record.runId}),
        ...(record.executionId === undefined ? {} : {executionId:record.executionId})})
        .sort(([a],[b])=>a.localeCompare(b))
    ));
    const fingerprint = createHash('sha256').update(canonical).digest('hex');
    try {
      await this.db.query(
        "INSERT INTO public.forge_audit_events (event_id, schema_version, tenant_id, principal_id, actor_id, request_id, event_type, workspace_id, template, status, run_id, execution_id, fingerprint_sha256) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (event_id) DO NOTHING",
        [record.eventId, record.schemaVersion, record.tenantId, record.principalId,
          record.actorId, record.requestId, record.type, record.workspaceId,
          record.template,record.status ?? null,record.runId ?? null,record.executionId ?? null,fingerprint]
      );
      const {rows} = await this.db.query<FingerprintRow>(
        'SELECT fingerprint_sha256 FROM public.forge_audit_events WHERE event_id = $1::uuid AND tenant_id = $2',
        [record.eventId,record.tenantId]
      );
      if (rows.length !== 1 || rows[0]?.fingerprint_sha256 !== fingerprint)
        throw new Error('audit event conflict or tenant mismatch');
      return Object.freeze({eventId:record.eventId, committed:true});
    } catch (err) {
      throw toPersistenceError('append Forge security evidence',err,{resource:'forge_audit_events'});
    }
  }
}
