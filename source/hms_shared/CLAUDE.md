# shared — Instructions

Contracts shared across subprojects. No runtime code that services import except generated
types from these contracts.

## Layout

- `events/` — event schemas: raw Khanza change events and domain events
  (`<domain>.<entity>.<event>.v<N>`), with a common envelope: event id, type, version,
  occurred_at (UTC), source (table + poll cursor, or service), correlation id, payload.
- `api/` — OpenAPI specs per service (`<service>.yaml`).
- `codes/` — references to code systems and master data (ICD-10, ICD-9-CM, care classes,
  payer types). The catalogue data itself is owned by `source/hms_database/` (PostgreSQL 18, pending ADR-0004) and
  consumed by `source/hms_services/ai-claim-assistant/`.

## Rules

- A contract change lands before or with its implementation, never after.
- Additive changes only within a version; breaking changes create `.v<N+1>` and both versions
  run in parallel until consumers migrate.
- Mark PHI fields in schemas (e.g. `x-phi: true`) so consumers and the warehouse can mask them.
- Examples in schemas use synthetic data only.
