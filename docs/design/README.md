# AION Data — Design Specs

Forward-looking **persistence** designs for canonical/derived data that is
contracted but not yet materialized as a migration. Each spec turns an accepted
aion-docs decision into concrete DDL and port implementations, following the
[schema conventions](../schema.md) and [migration policy](../../migrations/README.md)
— **without** applying a migration ahead of the mission that needs it
([Mission Before Infrastructure](https://github.com/Ceoloo/aion-docs/blob/main/engineering/principles.md)).

Migration `0001_initial_core_state.sql` is applied and immutable; nothing here
edits it. When one of these specs is needed, it becomes the **next** numbered,
additive migration.

| Spec | Drives | Priority | Status |
|---|---|---|---|
| [economics-and-idempotency.md](economics-and-idempotency.md) | [ADR-003](https://github.com/Ceoloo/aion-docs/blob/main/adr/ADR-003-execution-gateway-and-evidence.md) (receipts/idempotency), [ADR-004](https://github.com/Ceoloo/aion-docs/blob/main/adr/ADR-004-agent-economics-layer.md) (economics) | P0 / Phase-5 | Design |

## Ground rules

- **Append-only history is sacred.** New evidence tables (`execution_receipts`)
  are append-only like `events`/`telemetry_records`; no routine update/delete.
- **Cost authoritative, value measured, ROI derived.** Economics keeps trust
  levels explicit; ROI is a view over inputs, never a stored "truth".
- **References, not secrets or raw payloads.** Arguments are stored only as a
  hash; sensitive records are pointed at, not copied.
- **Additive-by-default; ADR-gated when significant.** Consistent with
  [data-contracts](https://github.com/Ceoloo/aion-docs/blob/main/engineering/data-contracts.md).
