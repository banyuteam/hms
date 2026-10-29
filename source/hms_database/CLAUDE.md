# database — Instructions

Schemas, migrations and seed data for the **new** services' databases. This folder never
contains changes to the Khanza database. Read the root `CLAUDE.md` and this folder's `PRD.md`
first.

## Scope

- `source/hms_database/<service-name>/migrations/` — ordered, forward-only migrations per service.
- `source/hms_database/<service-name>/seed/` — synthetic seed data for local development only.
- `source/hms_database/catalogue/` — ICD-10 (WHO 2010) and ICD-9-CM catalogue tables, loaded from
  `docs/references/code-systems/`; shared read-only by the services that need them.
- `docs/references/khanza-schema/` holds the read-only Khanza schema snapshot used as a
  reference; it is not managed here.

## Rules

- Engine: **PostgreSQL 18** (product owner, 2026-10-29), proposed as ADR-0004 — not accepted yet. The migration tool is
  still undecided — ask before choosing.
- Migrations are immutable once merged; fix forward with a new migration. Each migration
  states whether it is safe to run online and how to roll back.
- Every table: primary key, `created_at`/`updated_at` (UTC), and for services that publish
  events an `outbox` table.
- Mark PHI columns in schema comments; encrypt high-sensitivity columns (NIK, BPJS number)
  at rest where the PRD requires.
- Keep mapping notes when a table mirrors a Khanza table (source table/column → new column),
  in `source/hms_database/<service-name>/MAPPING.md`.
- Never put real patient data in seeds or dumps.
