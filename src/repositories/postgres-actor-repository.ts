import type { Actor, ActorId } from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { ActorRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import { actorToColumns, rowToActor } from '../mappers/actor-mapper.js';

/**
 * Durable actor repository — LOCAL to aion-data.
 *
 * AION Core defines no ActorRepository port (Commands carry the full Actor
 * inline), but governance and traceability require canonical, attributable
 * identities to exist durably: runs and approval decisions carry foreign keys to
 * `actors` so no run or decision can reference an unregistered identity
 * (aion-docs/architecture/security-model.md: "No ambient authority"). This
 * repository owns registering those identities. It is intentionally minimal and
 * is NOT forced back into Core.
 */
export class PostgresActorRepository {
  constructor(private readonly db: Queryable) {}

  async get(id: ActorId): Promise<Actor | undefined> {
    try {
      const { rows } = await this.db.query<ActorRow>(
        'SELECT * FROM actors WHERE actor_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToActor(row) : undefined;
    } catch (err) {
      throw wrap('get actor', err, { actorId: id });
    }
  }

  async save(actor: Actor): Promise<void> {
    const c = actorToColumns(actor);
    try {
      await this.db.query(
        `INSERT INTO actors (
           actor_id, actor_type, name, permissions, allowed_tools,
           forbidden_capabilities, max_risk_level, agent_id, purpose, owner,
           default_risk_level, escalation_conditions, cost_budget,
           agent_uri, domain, role, tenant_id, autonomy_level, allowed_data,
           input_contract, output_contract, evaluation_criteria,
           observability_requirements, metadata
         ) VALUES (
           $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11,
           $12::jsonb, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21,
           $22::jsonb, $23::jsonb, $24::jsonb
         )
         ON CONFLICT (actor_id) DO UPDATE SET
           actor_type = EXCLUDED.actor_type,
           name = EXCLUDED.name,
           permissions = EXCLUDED.permissions,
           allowed_tools = EXCLUDED.allowed_tools,
           forbidden_capabilities = EXCLUDED.forbidden_capabilities,
           max_risk_level = EXCLUDED.max_risk_level,
           agent_id = EXCLUDED.agent_id,
           purpose = EXCLUDED.purpose,
           owner = EXCLUDED.owner,
           default_risk_level = EXCLUDED.default_risk_level,
           escalation_conditions = EXCLUDED.escalation_conditions,
           cost_budget = EXCLUDED.cost_budget,
           agent_uri = EXCLUDED.agent_uri,
           domain = EXCLUDED.domain,
           role = EXCLUDED.role,
           tenant_id = EXCLUDED.tenant_id,
           autonomy_level = EXCLUDED.autonomy_level,
           allowed_data = EXCLUDED.allowed_data,
           input_contract = EXCLUDED.input_contract,
           output_contract = EXCLUDED.output_contract,
           evaluation_criteria = EXCLUDED.evaluation_criteria,
           observability_requirements = EXCLUDED.observability_requirements,
           metadata = EXCLUDED.metadata,
           updated_at = now()`,
        [
          c.actor_id, c.actor_type, c.name, c.permissions, c.allowed_tools,
          c.forbidden_capabilities, c.max_risk_level, c.agent_id, c.purpose,
          c.owner, c.default_risk_level, c.escalation_conditions, c.cost_budget,
          c.agent_uri, c.domain, c.role, c.tenant_id, c.autonomy_level,
          c.allowed_data, c.input_contract, c.output_contract,
          c.evaluation_criteria, c.observability_requirements, c.metadata,
        ],
      );
    } catch (err) {
      throw wrap('save actor', err, { actorId: actor.actorId });
    }
  }

  async list(): Promise<Actor[]> {
    try {
      const { rows } = await this.db.query<ActorRow>(
        'SELECT * FROM actors ORDER BY created_at, actor_id',
      );
      return rows.map(rowToActor);
    } catch (err) {
      throw wrap('list actors', err, {});
    }
  }
}

function wrap(op: string, err: unknown, details: Record<string, unknown>): DataError {
  return toPersistenceError(op, err, details);
}
