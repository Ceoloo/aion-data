# Sentinel Identity bindings — migration 0015 (PROPOSED)

- **Owner:** AION Data (canonical schema and read-only repository)
- **Consumer:** AION Runtime auth boundary, using Sentinel Keycloak verifier
- **State:** Draft only. Do NOT migrate production until operator and
  infrastructure maintainers approve staging and rollback evidence.

### Why a separate schema?

The token is not authenticated when this registry is queried. No request
tenant can be trusted yet; a tenant RLS policy depending on a caller-supplied
tenant would be a bypass or would deny every valid login. Instead,
`aion_auth.principal_bindings` resides outside tenant data and is readable
**only by the trusted Runtime service DB principal** (restricted SELECT).
No public GraphQL/PostgREST/client access or direct agent access is allowed.
The table's owner/admin migration role is the only write authority.

Mapping key: exact `issuer + subject + client_id` (unique primary key).
It records the vetted Runtime principal ID, durable actor ID, kind, roles
(`invoke`/`approve` only), tenant_ids, active/disabled/revoked state,
expiration, revision, operator provenance. No token, password, client secret,
refresh token, or cryptographic signing key is persisted.

### Privilege and schema-review gate

Migration 0015 grants only SELECT + schema USAGE to `aion_app` **if that
role exists at migration time**. An environment creating app roles later
must grant read explicitly during Infra provisioning. Security review MUST
confirm no broad `GRANT INSERT/UPDATE/DELETE ... ON ALL TABLES` includes
`aion_auth` and that public/default roles have no privileges. Do not use
schema owner, superuser or migration URL in Runtime.

Admin account provisioning must be an out-of-band, reviewed and logged
procedure, never a Runtime or Sentinel public API. Starting state defaults
to `disabled`; activation requires explicit admin update. Tighten runtime
grants, disable mappings or revoke actors to contain compromised identities.

### Migration and rollout

1. Review SQL, staging DB role ACLs and privilege tests; run an isolated
   ephemeral Postgres migration with the existing pipeline.
2. Deploy the new Data library with additive migration through the **separate
   migrator**. Do NOT alter applied migration checksums; follow forward-only
   correction if rollback is needed.
3. Provision disabled fake bindings against real durable, test-only Actors.
4. Enable opt-in Keycloak mode on staging Runtime only after a Keycloak realm,
   audience mapper, signer rotation, admin MFA and tenant proof tests.
5. Validate caller isolation and revocation; remove staging grants on failure.
   Runtime defaults to its previous API-key auth when Keycloak mode is unset.

### Contract

`dataLayer.identityBindings.getActive({issuer,subject,clientId})` is a
**read-only** AION Data method. It queries current status/expiry and returns
a bounded typed record. Runtime must re-query binding and Actor per request,
and must continue its existing policy and approval checks at the gateway.

Security audit: Cloudflare-derived AION Sentinel baseline, current SHA,
independent verifier and explicit unresolved issues; zero acceptance inferred.
