# Migrations

Canonical schema changes for AION Data. Migrations are **owned by aion-data** and
are the only sanctioned way the schema changes
(aion-docs/engineering/data-contracts.md).

## Naming

- `NNNN_short_description.sql`, e.g. `0001_initial_core_state.sql`.
- `NNNN` is a zero-padded, strictly increasing integer prefix. It defines apply
  order. `short_description` is snake_case and describes the change.
- One logical change per migration.

## Ordering & application

- Migrations apply in ascending `NNNN` order (`readMigrations` sorts numerically).
- The runner (`src/migrations/runner.ts`, invoked by `npm run migrate`) applies
  each pending migration **once, inside its own transaction**, and records it in
  `schema_migrations` with a sha256 checksum of the file.
- Applying is **idempotent**: already-applied migrations are verified and skipped.
- Duplicate `NNNN` prefixes are rejected.

## Immutability (drift protection)

An already-applied migration file is **immutable**. If its content changes, its
checksum no longer matches the recorded one and the runner fails with a
`MigrationError` instead of silently re-applying or ignoring the change. To alter
the schema, add a **new** migration — never edit an applied one.

## Forward-only rollback philosophy

Phase 2 is forward-only: there are no down-migrations. A mistake is corrected by a
new, additive migration that moves the schema forward, not by reversing history.
This mirrors the append-only, history-preserving stance of the data layer and
avoids destructive rollbacks against durable state.

- **Additive by default.** New optional columns / new tables are safe.
- **Breaking changes are versioned and migrated**, with a data-migration path in
  the same or a following migration, and an ADR when architecturally significant
  (aion-docs/engineering/data-contracts.md).

## Destructive-migration policy

- Destructive DDL (dropping a column/table, narrowing a type, tightening a
  constraint that existing rows may violate) is **high-risk** and must:
  1. be justified by a mission/requirement and, when significant, an ADR;
  2. preserve historical execution records — never a broad cascading delete that
     destroys `events`, `telemetry_records`, `runs`, or `outcomes` history;
  3. be split so data is migrated/backfilled before the old shape is removed.
- `events` and `telemetry_records` are append-only; migrations must not add
  routine update/delete paths to them.

## Production safety expectations

- Migrations run under the **migration/admin role**, separate from the
  least-privileged application role (see [../docs/security.md](../docs/security.md)).
- Prefer changes that are safe under load (e.g. add nullable column, backfill,
  then constrain). Avoid long table rewrites without a plan.
- Migrations reach production through change management
  (aion-docs/governance/change-management.md) and are reviewed like code — the SQL
  is intentionally plain and readable so a reviewer can audit exactly what runs.

## Running

```bash
npm run migrate            # apply pending migrations (MIGRATION_DATABASE_URL or DATABASE_URL)
npm run reset-test-db      # drop+recreate the test schema and re-migrate (test DBs only)
```
