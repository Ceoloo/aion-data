import {
  buildMission001Catalog,
  buildMission002Catalog,
  buildMission009Catalog,
  type ServiceDefinition,
  type ServiceId,
  type ServiceKey,
} from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { ServiceRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import { rowToService, serviceToColumns } from '../mappers/service-mapper.js';

/**
 * Durable Service Catalog repository — LOCAL to aion-data.
 *
 * Core owns ServiceDefinition; Data persists and seeds Mission 001 v0.
 * Runtime resolves `serviceKey` here before submitting governed commands.
 */
export class PostgresServiceRepository {
  constructor(private readonly db: Queryable) {}

  async get(id: ServiceId): Promise<ServiceDefinition | undefined> {
    try {
      const { rows } = await this.db.query<ServiceRow>(
        'SELECT * FROM services WHERE service_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToService(row) : undefined;
    } catch (err) {
      throw wrap('get service', err, { serviceId: id });
    }
  }

  async getByKey(serviceKey: ServiceKey | string): Promise<ServiceDefinition | undefined> {
    try {
      const { rows } = await this.db.query<ServiceRow>(
        'SELECT * FROM services WHERE service_key = $1',
        [serviceKey],
      );
      const row = rows[0];
      return row ? rowToService(row) : undefined;
    } catch (err) {
      throw wrap('get service by key', err, { serviceKey });
    }
  }

  async list(status: 'active' | 'deprecated' | 'all' = 'active'): Promise<ServiceDefinition[]> {
    try {
      const { rows } =
        status === 'all'
          ? await this.db.query<ServiceRow>(
              'SELECT * FROM services ORDER BY name, version',
            )
          : await this.db.query<ServiceRow>(
              'SELECT * FROM services WHERE status = $1 ORDER BY name, version',
              [status],
            );
      return rows.map(rowToService);
    } catch (err) {
      throw wrap('list services', err, { status });
    }
  }

  async save(svc: ServiceDefinition): Promise<void> {
    const c = serviceToColumns(svc);
    try {
      await this.db.query(
        `INSERT INTO services (
           service_id, service_key, name, version, capability, owner,
           description, input_schema_ref, output_schema_ref,
           required_permissions, agent_compatibility, tools,
           risk_level, approval_required, cost_hint_units, sla_hint,
           eval_refs, consumers, workflow_id, status, metadata
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10::jsonb, $11::jsonb, $12::jsonb,
           $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19, $20, $21::jsonb
         )
         ON CONFLICT (service_key) DO UPDATE SET
           name = EXCLUDED.name,
           version = EXCLUDED.version,
           capability = EXCLUDED.capability,
           owner = EXCLUDED.owner,
           description = EXCLUDED.description,
           input_schema_ref = EXCLUDED.input_schema_ref,
           output_schema_ref = EXCLUDED.output_schema_ref,
           required_permissions = EXCLUDED.required_permissions,
           agent_compatibility = EXCLUDED.agent_compatibility,
           tools = EXCLUDED.tools,
           risk_level = EXCLUDED.risk_level,
           approval_required = EXCLUDED.approval_required,
           cost_hint_units = EXCLUDED.cost_hint_units,
           sla_hint = EXCLUDED.sla_hint,
           eval_refs = EXCLUDED.eval_refs,
           consumers = EXCLUDED.consumers,
           workflow_id = EXCLUDED.workflow_id,
           status = EXCLUDED.status,
           metadata = EXCLUDED.metadata,
           updated_at = now()`,
        [
          c.service_id, c.service_key, c.name, c.version, c.capability, c.owner,
          c.description, c.input_schema_ref, c.output_schema_ref,
          c.required_permissions, c.agent_compatibility, c.tools,
          c.risk_level, c.approval_required, c.cost_hint_units, c.sla_hint,
          c.eval_refs, c.consumers, c.workflow_id, c.status, c.metadata,
        ],
      );
    } catch (err) {
      throw wrap('save service', err, { serviceKey: svc.serviceKey });
    }
  }

  /**
   * Idempotent Mission 001 seed: inserts missing keys, leaves existing rows.
   * Returns how many new services were written.
   */
  async seedMission001(): Promise<{ inserted: number; total: number }> {
    const catalog = buildMission001Catalog();
    let inserted = 0;
    for (const svc of catalog) {
      const existing = await this.getByKey(svc.serviceKey);
      if (!existing) {
        await this.save(svc);
        inserted += 1;
      }
    }
    return { inserted, total: catalog.length };
  }

  /**
   * Idempotent Mission 002 seed: inserts missing Media/G-Star catalog keys.
   */
  async seedMission002(): Promise<{ inserted: number; total: number }> {
    const catalog = buildMission002Catalog();
    let inserted = 0;
    for (const svc of catalog) {
      const existing = await this.getByKey(svc.serviceKey);
      if (!existing) {
        await this.save(svc);
        inserted += 1;
      }
    }
    return { inserted, total: catalog.length };
  }

  /**
   * Idempotent Mission 009 seed: CRM / GHL client-plane catalog keys.
   */
  async seedMission009(): Promise<{ inserted: number; total: number }> {
    const catalog = buildMission009Catalog();
    let inserted = 0;
    for (const svc of catalog) {
      const existing = await this.getByKey(svc.serviceKey);
      if (!existing) {
        await this.save(svc);
        inserted += 1;
      }
    }
    return { inserted, total: catalog.length };
  }
}

function wrap(
  op: string,
  err: unknown,
  details: Record<string, unknown>,
): DataError {
  return toPersistenceError(op, err, details);
}
