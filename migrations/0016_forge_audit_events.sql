-- Forge v0.2 — canonical append-only security evidence owned by AION Data.
-- FOR REVIEW / DISPOSABLE STAGING ONLY. Never bypass authorized migration flow.
CREATE TABLE public.forge_audit_events (
  event_id uuid PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'forge.audit.v1'),
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  principal_id text NOT NULL CHECK (principal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  actor_id text NOT NULL REFERENCES public.actors(actor_id) ON DELETE RESTRICT,
  request_id text NOT NULL CHECK (request_id ~ '^forge-[A-Za-z0-9-]{8,100}$'),
  event_type text NOT NULL CHECK (event_type IN (
    'forge.session.requested', 'forge.session.runtime_result',
    'forge.session.runtime_error', 'forge.session.unknown_response'
  )),
  workspace_id text NOT NULL CHECK (workspace_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  template text NOT NULL CHECK (template IN ('implementer', 'reviewer')),
  status text CHECK (status IN ('awaiting_approval', 'denied', 'failed', 'completed')),
  run_id text,
  execution_id text,
  fingerprint_sha256 text NOT NULL CHECK (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX forge_audit_events_tenant_request_idx
  ON public.forge_audit_events (tenant_id, request_id, created_at);

-- No implicit tenant access. AION Runtime MUST set aion.tenant_id
-- from the verified principal before using the Data repository.
ALTER TABLE public.forge_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY forge_audit_events_tenant_policy ON public.forge_audit_events
  USING (tenant_id = aion_request_tenant_id())
  WITH CHECK (tenant_id = aion_request_tenant_id());

REVOKE ALL ON TABLE public.forge_audit_events FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aion_app') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.forge_audit_events FROM aion_app';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.forge_audit_events TO aion_app';
  END IF;
END;
$do$;

COMMENT ON TABLE public.forge_audit_events IS
  'Forge audit evidence. Runtime-authenticated, tenant-scoped, append-only records; no payloads or credentials.';
