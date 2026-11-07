# AION Forge v0.2 — Data-owned security audit ledger (DRAFT)

## Intent

Migration 0016 adds the canonical public.forge_audit_events table. It must be applied only through the authorized AION Data migrator, first against disposable PostgreSQL 16 staging. It is NOT a Forge product-owned database or an alternate authorization service.

The PostgresForgeAuditRepository accepts a strict allowlist of event fields with immutable event UUIDs and a SHA256 fingerprint. A second identical event UUID is acknowledged only if the stored fingerprint matches; conflicting/reused IDs are denied. The return value {eventId,committed:true} is sent only after both INSERT and exact readback succeed. No bearer credentials, prompt contents, terminal history or arbitrary payloads are stored.

## Security

- Tenant row-level security enabled and FORCED; write and read require matching aion.tenant_id set by trusted Runtime request context.
- The non-owner aion_app role receives SELECT + INSERT only, never UPDATE/DELETE. Direct DB clients must not use migration/superuser credentials.
- Principal, Actor, tenant and requestId MUST be derived/bound by Runtime's verified identity + canonical Actor; Data schema and RLS are defense in depth, not a substitute for Runtime authorization.
- Actor FK prevents dangling actor IDs; event_id uniqueness + fingerprint prevents conflicting retries.
- Data audit readback is not proof of externally tamper-evident/WORM storage. DBA / privileged access still needs logs, backups and independent evidence export.
- Database pool tenant context, RLS, schema grants and event acknowledgments must be proven with a non-owner role in isolated staging.
- No public API for arbitrary audit writes. A Runtime-owned service adapter is a separate review/deployment task.

## Dependencies / gates

- Sentinel Keycloak draft and AION Data 0015 identity bindings must be independently reviewed and staging verified.
- Forge PR #5 requires this ledger's reviewed Data package, Runtime-owned event transport and signed principal checks.
- Catalog capability forge.session.launch remains unregistered; this migration does not activate terminals.
- Do not touch the live GE-001/AIO-111 production gates; no production environment rollout without a maintainer and operator-approved deployment and rollback plan.

## Verification

Run existing AION Data CI (typecheck, lint, Postgres tests, build). The new repository suite uses a non-owner database role to test tenant isolation, replay, conflict, denied UPDATE/DELETE and Actor FK. Inspect deployment role grant on staging separately.
