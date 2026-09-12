-- 0010_tenant_rls.sql
-- Gap 3 follow-on: tenant Row Level Security scaffold.
--
-- Status: SCAFFOLD — not enabled by default in app role sessions until Runtime
-- sets `aion.tenant_id` on the connection (see ADR-005). Policies are created
-- so environments can opt in after GUC wiring lands.
--
-- Design:
--   * Policies key on current_setting('aion.tenant_id', true)
--   * Empty/missing setting ⇒ no rows visible (fail closed)
--   * Does NOT replace Core PolicyEngine authorization
--   * Migrator role bypasses RLS; aion_app subject to it once FORCE is applied

BEGIN;

-- Helper: read request tenant (NULL if unset).
CREATE OR REPLACE FUNCTION aion_request_tenant_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('aion.tenant_id', true), '');
$$;

-- Executions
ALTER TABLE IF EXISTS executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS executions_tenant_isolation ON executions;
CREATE POLICY executions_tenant_isolation ON executions
  USING (tenant_id IS NOT DISTINCT FROM aion_request_tenant_id())
  WITH CHECK (tenant_id IS NOT DISTINCT FROM aion_request_tenant_id());

-- Approvals
ALTER TABLE IF EXISTS approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approvals_tenant_isolation ON approvals;
CREATE POLICY approvals_tenant_isolation ON approvals
  USING (tenant_id IS NOT DISTINCT FROM aion_request_tenant_id())
  WITH CHECK (tenant_id IS NOT DISTINCT FROM aion_request_tenant_id());

-- Autonomy grants
ALTER TABLE IF EXISTS autonomy_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autonomy_grants_tenant_isolation ON autonomy_grants;
CREATE POLICY autonomy_grants_tenant_isolation ON autonomy_grants
  USING (tenant_id IS NOT DISTINCT FROM aion_request_tenant_id())
  WITH CHECK (tenant_id IS NOT DISTINCT FROM aion_request_tenant_id());

-- NOTE: Do not FORCE ROW LEVEL SECURITY until Runtime sets aion.tenant_id on
-- every request-scoped connection. Uncomment when wiring is proven:
-- ALTER TABLE executions FORCE ROW LEVEL SECURITY;
-- ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
-- ALTER TABLE autonomy_grants FORCE ROW LEVEL SECURITY;

COMMIT;
