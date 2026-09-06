import { Actor } from '@aion/core';
import type { ActorRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, numberOrUndefined, stringArray } from './_shared.js';

/**
 * Actor ⇄ row mapping.
 *
 * Actor is a discriminated union (human/agent/service/system); only agents carry
 * the governance + identity-registry fields, so those are attached only when the
 * row is an agent. Reads validate against the Core Actor contract. The DB audit
 * columns (created_at/updated_at) are not part of the Core Actor contract and
 * are dropped on the way out.
 */
export function rowToActor(row: ActorRow): Actor {
  const base = {
    actorId: row.actor_id,
    actorType: row.actor_type,
    name: row.name,
    permissions: stringArray(row.permissions),
    allowedTools: stringArray(row.allowed_tools),
    forbiddenCapabilities: stringArray(row.forbidden_capabilities),
    maxRiskLevel: row.max_risk_level,
    metadata: metadataObject(row.metadata),
  };

  const candidate =
    row.actor_type === 'agent'
      ? {
          ...base,
          agentId: row.agent_id,
          purpose: row.purpose,
          owner: row.owner,
          defaultRiskLevel: row.default_risk_level,
          escalationConditions: stringArray(row.escalation_conditions),
          ...(row.cost_budget !== null
            ? { costBudget: numberOrUndefined(row.cost_budget) }
            : {}),
          ...(row.agent_uri ? { agentUri: row.agent_uri } : {}),
          ...(row.domain ? { domain: row.domain } : {}),
          ...(row.role ? { role: row.role } : {}),
          ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
          ...(row.autonomy_level ? { autonomyLevel: row.autonomy_level } : {}),
          allowedData: stringArray(row.allowed_data),
          ...(row.input_contract ? { inputContract: row.input_contract } : {}),
          ...(row.output_contract ? { outputContract: row.output_contract } : {}),
          evaluationCriteria: stringArray(row.evaluation_criteria),
          observabilityRequirements: stringArray(row.observability_requirements),
        }
      : base;

  const parsed = Actor.safeParse(candidate);
  if (!parsed.success) {
    throw new MappingError('persisted actor failed Core contract validation', {
      actorId: row.actor_id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Column values for INSERT/UPSERT, covering all actor kinds. */
export function actorToColumns(actor: Actor): {
  actor_id: string;
  actor_type: string;
  name: string;
  permissions: string;
  allowed_tools: string;
  forbidden_capabilities: string;
  max_risk_level: string;
  agent_id: string | null;
  purpose: string | null;
  owner: string | null;
  default_risk_level: string | null;
  escalation_conditions: string;
  cost_budget: number | null;
  agent_uri: string | null;
  domain: string | null;
  role: string | null;
  tenant_id: string | null;
  autonomy_level: string | null;
  allowed_data: string;
  input_contract: string | null;
  output_contract: string | null;
  evaluation_criteria: string;
  observability_requirements: string;
  metadata: string;
} {
  const isAgent = actor.actorType === 'agent';
  return {
    actor_id: actor.actorId,
    actor_type: actor.actorType,
    name: actor.name,
    permissions: JSON.stringify(actor.permissions),
    allowed_tools: JSON.stringify(actor.allowedTools),
    forbidden_capabilities: JSON.stringify(actor.forbiddenCapabilities),
    max_risk_level: actor.maxRiskLevel,
    agent_id: isAgent ? actor.agentId : null,
    purpose: isAgent ? actor.purpose : null,
    owner: isAgent ? actor.owner : null,
    default_risk_level: isAgent ? actor.defaultRiskLevel : null,
    escalation_conditions: isAgent ? JSON.stringify(actor.escalationConditions) : '[]',
    cost_budget: isAgent ? actor.costBudget ?? null : null,
    agent_uri: isAgent ? actor.agentUri ?? null : null,
    domain: isAgent ? actor.domain ?? null : null,
    role: isAgent ? actor.role ?? null : null,
    tenant_id: isAgent ? actor.tenantId ?? null : null,
    autonomy_level: isAgent ? actor.autonomyLevel ?? null : null,
    allowed_data: isAgent ? JSON.stringify(actor.allowedData) : '[]',
    input_contract: isAgent ? actor.inputContract ?? null : null,
    output_contract: isAgent ? actor.outputContract ?? null : null,
    evaluation_criteria: isAgent ? JSON.stringify(actor.evaluationCriteria) : '[]',
    observability_requirements: isAgent
      ? JSON.stringify(actor.observabilityRequirements)
      : '[]',
    metadata: JSON.stringify(actor.metadata),
  };
}
