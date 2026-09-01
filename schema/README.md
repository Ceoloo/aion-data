# schema/

The **authoritative** definition of the AION Data schema is the versioned SQL in
[`../migrations/`](../migrations/) — that is what actually runs and what reviewers
audit. There is no separate ORM model or generated schema to drift from it.

This directory is reserved for **derived, human-facing schema artifacts** when a
future phase justifies them, e.g.:

- a generated ERD / dependency diagram,
- a dumped `pg_dump --schema-only` snapshot for quick reference,
- generated TypeScript row types (should a codegen step be adopted).

None of these are built in Phase 2 (Mission Before Infrastructure — no artifact
without a need). For the current, hand-maintained reference of every table,
identifier, relationship, and constraint, see
[`../docs/schema.md`](../docs/schema.md).
