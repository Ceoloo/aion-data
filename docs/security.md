# AION Data — Security Model

AION Data follows AION's posture of **least privilege everywhere**
(aion-docs/architecture/security-model.md). Concrete infrastructure — the managed
secret store, network isolation, IAM — is owned by `aion-infra` (Phase 3). This
document defines what AION Data implements now and the boundaries it assumes.

## Principle: Data persists; Core governs

The database is **not** an authorization boundary for control-plane policy.
Permission evaluation, risk classification, human-gate authority, and
no-self-approval are AION **Core** policy and are never reimplemented in SQL,
triggers, or stored procedures. Database constraints only enforce **integrity**
(valid enums, coherent decision states, referential integrity), so the store can
never represent a state Core would consider impossible. See
[architecture.md](architecture.md).

## Database roles (least privilege)

Phase 2 defines the role model; provisioning the roles is an `aion-infra`
responsibility. Two application-facing roles, separated by privilege:

| Role | Privilege | Used by |
|---|---|---|
| **Application role** (e.g. `aion_app`) | `SELECT/INSERT/UPDATE` (DML) on the canonical tables; **no DDL** | the running control plane (via `DATABASE_URL`) |
| **Migration/admin role** (e.g. `aion_migrator`) | DDL (create/alter tables, indexes, constraints) + DML on `schema_migrations` | migrations only (via `MIGRATION_DATABASE_URL`) |

The application connection should never hold DDL rights: schema change is a
governed, migration-only path (aion-docs/engineering/data-contracts.md —
migrations are owned by aion-data and run through change management). No shared or
ambient "god" connection.

Recommended `aion-infra` grant sketch (illustrative, not run here):

```sql
-- migrator owns the schema and can change it
GRANT ALL ON SCHEMA public TO aion_migrator;
-- app can only read/write data, never alter shape
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO aion_app;
-- events/telemetry are append-only for the app: no DELETE, no UPDATE
REVOKE UPDATE, DELETE ON events, telemetry_records FROM aion_app;
```

Append-only enforcement at the DB grant level (no `UPDATE`/`DELETE` on `events`
and `telemetry_records` for the app role) complements the application-level
append-only adapters.

## Read/write boundaries

- `events` and `telemetry_records` are **append-only** in code (`emit`/`record`
  only; no update or delete methods). Corrections are new compensating events,
  never edits to history.
- `runs` and `approvals` are mutable operational state; `approvals` cannot enter a
  contradictory decided/undecided state (coherence CHECK), and `runs` support
  optimistic-concurrency version checks.
- `missions`, `actors`, `outcomes` are mutable with audited `updated_at`.

## Secrets

- **No secrets in this repository — ever.** `.env.example` contains placeholders
  only; `.env` is git-ignored.
- Connection strings are **injected**, not read at import time: `createDataLayer`
  takes a `connectionString`. Only operational entrypoints (`scripts/`, tests)
  read env, at the edge.
- Production secrets live in the `aion-infra` managed secret store, supplied per
  environment. Credentials are never shared across environments
  (aion-docs/architecture/environments.md).

## Environment separation

Canonical, sensitive data lives only in production; lower tiers use synthetic or
masked data, with separate credentials per tier. The test suite requires
`TEST_DATABASE_URL` to point at an isolated, disposable database, and
`reset-test-db` refuses to run unless the target database name contains `test` —
a guard against ever pointing destructive tooling at real data.

## Row-Level Security — deferred, with reason

Phase 2 **does not enable RLS by default**, deliberately:

> Scaffold migration `0010_tenant_rls.sql` (ADR-005) defines tenant
> policies but does **not** FORCE them until Runtime sets
> `aion.tenant_id` on request-scoped connections.


- There is **no public/anonymous client** and **no validated multi-tenant
  requirement** in Phase 2. AION Data is reached only by the control plane via a
  trusted, least-privileged service role.
- Authorization for *who may perform an action* is a Core policy concern; RLS is
  not a substitute for it. Enabling elaborate tenant policies now would model a
  boundary AION has not yet validated (aion-docs/engineering/principles.md #1 —
  Mission Before Infrastructure).

The design keeps RLS a clean future addition: canonical tables already carry the
ownership columns (`owner`, `actor_id`, `mission_id`) that a future tenant policy
would key on. When a real multi-tenant or direct-client requirement appears, RLS
is introduced via an ADR, kept minimal and meaningful, and **tested** — and it
still will not replace Core's application-level authorization.

If a future phase adopts Supabase-specific RLS, those policies are to be isolated
in their own clearly-labelled migration and documented here, so the portable
PostgreSQL core stays portable.

## Audit & PII

- Every governed action is traceable through the durable event and telemetry
  spine (shared `run_id`/`correlation_id`), satisfying the audit-trail expectation
  of the security model.
- **PII handling**: payloads/metadata should carry *references*, not sensitive raw
  data (aion-docs/observability-standards.md: reference, don't copy). No column is
  a home for secrets or credentials. The [data classification table](schema.md#data-classification-documentation-level)
  marks which categories may contain sensitive values so future controls can key
  on it.

## Summary

- Least privilege: separate app vs. migrator roles; app has no DDL and no
  update/delete on the append-only logs.
- No secrets in the repo; injectable per-environment connection strings.
- Integrity in the DB; authorization in Core.
- RLS deferred deliberately, with the ownership columns already in place for a
  future, tested, ADR-backed introduction.
