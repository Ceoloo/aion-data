import { ServiceDefinition } from '@aion/core';
import type { ServiceRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject, numberOrUndefined, stringArray } from './_shared.js';

/**
 * Service Catalog ⇄ row mapping.
 *
 * Persists Core's ServiceDefinition. Arrays live in jsonb; identity and status
 * are relational so catalog lookups stay cheap.
 */
export function rowToService(row: ServiceRow): ServiceDefinition {
  const candidate = {
    serviceId: row.service_id,
    serviceKey: row.service_key,
    name: row.name,
    version: row.version,
    capability: row.capability,
    owner: row.owner,
    ...(row.description ? { description: row.description } : {}),
    ...(row.input_schema_ref ? { inputSchemaRef: row.input_schema_ref } : {}),
    ...(row.output_schema_ref ? { outputSchemaRef: row.output_schema_ref } : {}),
    requiredPermissions: stringArray(row.required_permissions),
    agentCompatibility: stringArray(row.agent_compatibility),
    tools: stringArray(row.tools),
    riskLevel: row.risk_level,
    approvalRequired: row.approval_required,
    ...(row.cost_hint_units !== null
      ? { costHintUnits: numberOrUndefined(row.cost_hint_units) }
      : {}),
    ...(row.sla_hint ? { slaHint: row.sla_hint } : {}),
    evalRefs: stringArray(row.eval_refs),
    consumers: stringArray(row.consumers),
    ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
    status: row.status,
    metadata: metadataObject(row.metadata),
  };

  const parsed = ServiceDefinition.safeParse(candidate);
  if (!parsed.success) {
    throw new MappingError('persisted service failed Core contract validation', {
      serviceId: row.service_id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function serviceToColumns(svc: ServiceDefinition): {
  service_id: string;
  service_key: string;
  name: string;
  version: number;
  capability: string;
  owner: string;
  description: string | null;
  input_schema_ref: string | null;
  output_schema_ref: string | null;
  required_permissions: string;
  agent_compatibility: string;
  tools: string;
  risk_level: string;
  approval_required: boolean;
  cost_hint_units: number | null;
  sla_hint: string | null;
  eval_refs: string;
  consumers: string;
  workflow_id: string | null;
  status: string;
  metadata: string;
} {
  return {
    service_id: svc.serviceId,
    service_key: svc.serviceKey,
    name: svc.name,
    version: svc.version,
    capability: svc.capability,
    owner: svc.owner,
    description: svc.description ?? null,
    input_schema_ref: svc.inputSchemaRef ?? null,
    output_schema_ref: svc.outputSchemaRef ?? null,
    required_permissions: JSON.stringify(svc.requiredPermissions),
    agent_compatibility: JSON.stringify(svc.agentCompatibility),
    tools: JSON.stringify(svc.tools),
    risk_level: svc.riskLevel,
    approval_required: svc.approvalRequired,
    cost_hint_units: svc.costHintUnits ?? null,
    sla_hint: svc.slaHint ?? null,
    eval_refs: JSON.stringify(svc.evalRefs),
    consumers: JSON.stringify(svc.consumers),
    workflow_id: svc.workflowId ?? null,
    status: svc.status,
    metadata: JSON.stringify(svc.metadata),
  };
}
