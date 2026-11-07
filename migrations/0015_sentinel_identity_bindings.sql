-- 0015_sentinel_identity_bindings.sql
-- Sentinel Identity v0.2: durable, operator-provisioned Keycloak identity bindings.
-- Pre-auth lookup is keyed by exact trusted issuer + subject + client id.
-- NO Runtime/agent identity self-registration, NO secrets, NO token data.
-- Schema intentionally separate from tenant-scoped business tables: the
-- authentication boundary has no trusted tenant until identity is established.
-- App role is READ ONLY. Writes require the migration/admin provisioner.
CREATE SCHEMA IF NOT EXISTS aion_auth;
REVOKE ALL ON SCHEMA aion_auth FROM PUBLIC;

CREATE TABLE aion_auth.principal_bindings (
  issuer         text NOT NULL CHECK (issuer ~ '^https://[^[:space:]]+/realms/[A-Za-z0-9_-]+$'),
  subject        text NOT NULL CHECK (length(subject) BETWEEN 1 AND 128),
  client_id      text NOT NULL CHECK (client_id ~ '^[A-Za-z0-9._:/-]{1,128}$'),
  principal_id   text NOT NULL CHECK (principal_id ~ '^[A-Za-z0-9._:/-]{1,128}$'),
  actor_id       text NOT NULL REFERENCES public.actors(actor_id) ON DELETE RESTRICT,
  kind           text NOT NULL CHECK (kind IN ('operator', 'service', 'agent-worker')),
  tenant_ids     text[] NOT NULL CHECK (cardinality(tenant_ids) BETWEEN 1 AND 100 AND
                                        array_position(tenant_ids, NULL) IS NULL),
  roles          text[] NOT NULL CHECK (cardinality(roles) BETWEEN 1 AND 2 AND
                                        roles <@ ARRAY['invoke','approve']::text[] AND
                                        array_position(roles, NULL) IS NULL),
  status         text NOT NULL DEFAULT 'disabled' CHECK (status IN ('active', 'disabled', 'revoked')),
  expires_at     timestamptz,
  version        integer NOT NULL DEFAULT 1 CHECK (version > 0),
  provisioned_by text NOT NULL CHECK (length(provisioned_by) > 0),
  changed_by     text NOT NULL CHECK (length(changed_by) > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject, client_id),
  CONSTRAINT principal_bindings_roles CHECK (kind = 'operator' OR NOT ('approve' = ANY(roles)))
);

CREATE INDEX principal_bindings_actor_idx ON aion_auth.principal_bindings (actor_id);
CREATE INDEX principal_bindings_status_idx ON aion_auth.principal_bindings (status)
  WHERE status <> 'active';

REVOKE ALL ON TABLE aion_auth.principal_bindings FROM PUBLIC;

-- When the app role exists, grant *only* SELECT. This table is an
-- authentication trust root; generic DML grants must never include it.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aion_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA aion_auth TO aion_app';
    EXECUTE 'REVOKE ALL ON TABLE aion_auth.principal_bindings FROM aion_app';
    EXECUTE 'GRANT SELECT ON TABLE aion_auth.principal_bindings TO aion_app';
  END IF;
END;
$do$;

COMMENT ON TABLE aion_auth.principal_bindings IS
  'Operator-provisioned external identity to AION Runtime Principal binding; app SELECT only.';
