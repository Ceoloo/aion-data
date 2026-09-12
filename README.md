# aion-data

**The canonical durable truth layer for the AION control plane.**

AION Data is Phase 2 of the AION architecture
([aion-docs/roadmap/build-order.md](https://github.com/Ceoloo/aion-docs/blob/main/roadmap/build-order.md)).
It makes the Phase 1 [AION Core](https://github.com/Ceoloo/aion-core) control-plane
lifecycle **durable**: missions, runs, approvals, events, telemetry, and
outcomes now survive a process restart, and a gated run can be resumed after the
process that created it is gone.

It does this by implementing AION Core's persistence **ports** with PostgreSQL
adapters, so Core keeps depending on interfaces — never on a database.

```
AION CORE  ──ports/contracts──▶  AION DATA  ──▶  PostgreSQL
(governs behavior)               (persists truth)
```

## What AION Data owns

- the **canonical relational schema** for persisted control-plane state;
- **migrations** (versioned, reviewable, deterministic; currently `0001`–`0009`);
- **durable repositories/adapters** implementing Core's ports;
- **event persistence** (append-only facts);
- **telemetry persistence** (the observability spine);
- **outcome records** (the seed of the future learning loop);
- **durability + revision** for opaque product checkpoints (`revenue_sessions`);
- **data governance**: constraints, indexes, lineage, database access patterns.

See [aion-docs/repositories/aion-data.md](https://github.com/Ceoloo/aion-docs/blob/main/repositories/aion-data.md).

## What AION Data does NOT own

- **orchestration / policy / behavior** — that is AION Core. Data persists truth;
  it never decides. No policy evaluation, no workflow logic, and no control-plane
  behavior lives in SQL, triggers, or stored procedures.
- **infrastructure / provisioning / environments** — that is `aion-infra`
  (Phase 3). The `docker-compose.yml` here is developer convenience only.
- **product/business entity schemas** — no CRM, sales, content, or portal tables.
  Product code (e.g. Revenue Copilot) owns the **opaque payload shape** inside
  `revenue_sessions`; Data only owns durability, exclusivity, and revision.
- **direct product imports** — products consume this layer via **Runtime HTTP**,
  not by importing `@aion/data` into product packages.

## Relationship to AION Core

Core defines five persistence ports and ships in-memory adapters for Phase 1.
AION Data provides the durable implementations:

| AION Core port | AION Data adapter |
|---|---|
| `MissionRepository` | `PostgresMissionRepository` |
| `RunRepository` | `PostgresRunRepository` |
| `ApprovalStore` | `PostgresApprovalStore` |
| `EventSink` | `PostgresEventSink` |
| `TelemetrySink` | `PostgresTelemetrySink` |

Additional repositories are **local to aion-data** (or promoted after Core
gained a matching port): actors, executions, services, workflows, outcomes,
economics, evaluations, autonomy grants, external side effects, and revenue
sessions. Full inventory: [docs/schema.md](docs/schema.md).

Core is consumed as the **real** package (`@aion/core`), not a copy — vendored
and built by `scripts/setup-core.mjs` and linked via a `file:` dependency, so the
canonical contracts are never forked. See
[docs/architecture.md](docs/architecture.md).

## Canonical data model

Migrations `0001`–`0009` define the current durable inventory (plus internal
`schema_migrations`):

| Area | Tables |
|---|---|
| Core control-plane | `actors`, `missions`, `runs`, `approvals`, `events`, `telemetry_records`, `outcomes` |
| Execution platform | `executions` |
| Catalog / plans | `services`, `workflows` |
| Evidence / governance | `evaluation_results`, `autonomy_grants`, `external_side_effects` |
| Product checkpoints | `revenue_sessions` (opaque jsonb; no `tenant_id` yet — known limitation) |

Full column-by-column reference: [docs/schema.md](docs/schema.md).

Lineage is traceable end-to-end:

```
Mission → Run → Command/Request → Approval → Events → Telemetry → Outcome
                ↘ Execution (optional tenant scope)
```

## Local development

Prerequisites: Node.js ≥ 20 and a PostgreSQL 16 instance (Docker is the easy path).

```bash
# 1. Install dependencies (bootstraps + builds AION Core, then installs).
npm install

# 2. Start a local Postgres (developer convenience only).
docker compose up -d

# 3. Configure the environment.
cp .env.example .env
#   then edit .env — for the compose DB the defaults work:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aion_data
#   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aion_data_test

# 4. Apply migrations.
npm run migrate

# 5. Run the test suite (integration tests need TEST_DATABASE_URL).
createdb -h localhost -U postgres aion_data_test   # or: psql -c 'create database aion_data_test'
npm test
```

`npm install` runs `scripts/setup-core.mjs` (a `preinstall` hook) to vendor and
build the pinned AION Core commit into `vendor/aion-core`. Set
`AION_SKIP_CORE_SETUP=1` to skip it when Core is already provisioned.

## Scripts

| Script | Purpose |
|---|---|
| `npm run setup:core` | Vendor + build the pinned AION Core into `vendor/`. |
| `npm run migrate` | Apply pending migrations (uses `MIGRATION_DATABASE_URL` if set, else `DATABASE_URL`). |
| `npm run reset-test-db` | Drop/recreate the test schema and re-migrate (guarded to `*test*` DBs). |
| `npm test` | Run the integration test suite against `TEST_DATABASE_URL`. |
| `npm run lint` / `typecheck` / `build` | Static checks and the library build. |
| `npm run check` | lint + typecheck + test + build. |

## Testing

Integration tests run against a **real** PostgreSQL database (Phase 2 mandates
this — see [docs/phase-2.md](docs/phase-2.md)). Point `TEST_DATABASE_URL` at an
isolated, disposable database; the suite migrates it and truncates between tests.
CI provisions an ephemeral Postgres service and runs the whole pipeline. No test
ever touches a managed/production service.

The suite proves every Phase 2 exit criterion, including the three required
durability scenarios: process-restart approval-resume, denied action, and failed
execution.

## Security

Least-privilege by design: separate application vs. migration/admin roles,
injectable per-environment connection strings, and **no secrets in the
repository** (`.env.example` holds placeholders only). Row-Level Security is
deliberately deferred (Phase 2 has no public client) with the decision recorded.
See [docs/security.md](docs/security.md).

## Phase 2 scope & status

Phase 2 exit criteria are met: the Core lifecycle operates against durable
Postgres adapters and resumes the same run after a restart. Additive migrations
`0002`–`0009` extend the foundation (executions, services, workflows, evals,
grants, side effects, revenue sessions) without changing that ownership model.
Learning tables (lessons, recommendations), analytics warehouses, and normalized
product schemas remain **out of scope**. Full scope, deferrals, and exit
criteria: [docs/phase-2.md](docs/phase-2.md).

## Documentation

- [docs/architecture.md](docs/architecture.md) — ports → adapters → Postgres, and the ownership boundary.
- [docs/schema.md](docs/schema.md) — every canonical table, its identifiers, relationships, and constraints.
- [docs/security.md](docs/security.md) — roles, access model, secrets, and the RLS decision.
- [docs/phase-2.md](docs/phase-2.md) — scope, deliberate deferrals, limitations, architecture issues, and exit criteria.
- [migrations/README.md](migrations/README.md) — migration naming, ordering, and safety rules.
