# hms_database — Project Instructions

## Mission
Own HMS data architecture and persistence contracts: structures, constraints, canonical definitions, migrations, integrity and governance.

## Baseline
- PostgreSQL 18 for new application data; verify feature/extension compatibility.
- Legacy MySQL is external and read-only. Never modify it.
- Use explicit version-controlled migrations.
- Do not invent legacy field semantics without evidence or domain-owner confirmation.

## Owns
- Canonical Domain Model (CDM), clinical/patient/encounter/billing schemas.
- Clinical Read Model (CRM) projection schemas.
- Legacy schema inventory, field dictionary and safe query catalog.
- Event envelope and event schema contracts.
- Outbox, polling checkpoint, captured-state and reconciliation persistence schemas.
- Constraints, indexes, partitioning, retention, backup and data-quality structures.

## Does not own
Polling schedulers, broker clients, event publishers, Go service workflows or Python runtime implementation.

## Workflow
Inspect current schema -> define entity owner/lifecycle -> define keys, constraints, nullability, units and terminology -> design indexes from query patterns -> plan migration/backfill/rollback -> add schema/data tests -> document consumer impact.

For material changes provide DDL/migration, constraints, indexes, sample queries, classification, migration/rollback and tests. Never store credentials, access tokens or private keys in application schemas.


## Database delivery and operations
- Provide versioned migration artifacts and documented migration/verification commands.
- Document PostgreSQL 18 initialization, extensions, backup, restore, retention and health checks.
- Never place production database credentials in Dockerfiles, Compose literals or source control.
- Production database persistence and backup must use managed or explicitly provisioned durable storage.
- Schema migration execution is coordinated by the release process; do not run migrations concurrently from every application replica.
- Existing legacy MySQL is external, read-only and must not be changed by containers or migration jobs.


## Workspace-level PostgreSQL platform
- Support shared workspace schemas while preserving explicit schema/domain ownership.
- Proposed shared schemas include `platform`, `iam`, `security`, `audit`, `workflow`, `eventing`, `integration`, `ai_platform`, `notification`, `licensing`, `ui_platform` and `readmodel`, alongside clinical/business domains.
- Do not create every schema speculatively. Create only when an approved capability has an owner, data classification and consumers.
- Separate migration, runtime, reporting and legacy database roles. Runtime roles must be least-privilege; never use superuser.
- Shared cluster does not imply cross-schema unrestricted reads/writes. Prefer APIs/events and approved read models.
- Secrets, private keys, high-volume metrics/logs, binary clinical documents and message queues do not belong in ordinary relational tables.

## Repository conventions (ADR-DB-001, ADR-DB-002 — proposed)
- Database, roles and baseline privileges come only from `bootstrap/bootstrap.psql` (superuser, idempotent). New
  capability group roles are added there before a migration grants to them.
- Migrations: `migrations/NNNN_snake_case.sql`, plain PostgreSQL 18 SQL, forward-only, immutable once applied anywhere
  shared. No `BEGIN`/`COMMIT`/`SET ROLE` inside; the runner wraps each file in a transaction as `hms_meta_owner`.
- Grant explicitly to group roles (`hms_*_rw`, `hms_audit_append`, `hms_audit_read`, `hms_report_read`); never to
  `PUBLIC` or login roles. Functions get `SET search_path = pg_catalog, pg_temp`.
- Every schema change ships with tests in `tests/sql/` and updates `schemas/<schema>/README.md`,
  `documentation/DATA-DICTIONARY.md` and, for new schemas, `documentation/DOMAIN-OWNERSHIP.md`.
- Verify with `scripts/migrate.* --plan`, `scripts/migrate.*` and `scripts/test.*` against a disposable or development
  database. Never run tests against production.
- Clinical record tables (ADR-DB-004/005):
  - Use `hms_meta.enable_versioned_record` (versioning, history, no delete, tenant RLS) or `hms_meta.enable_tenant_rls`.
  - Reference patients/encounters with composite `(id, patient_id)` / `(id, organization_id)` keys.
  - Coded values are `(system, code, display)`, and the system must be registered in `terminology.code_systems`.
  - Never hard-code national code lists in migrations; load them as approved terminology releases.
  - Keep `standards/healthcare/clinical-data-standards.md` and `documentation/standards-traceability.md` current.

## Runtime policy and UI metadata
- Own migrations and persistence contracts for versioned runtime policy and `ui_platform`.
- Store policy values with schema/version/scope metadata, never secret values.
- Store immutable compiled UI IR versions, hashes, compiler/contract versions, assignments, approvals and active-version pointers.
- Keep Python source definitions in controlled source/version control; database persistence is for published artifacts and lifecycle metadata.
- Treat UI IR as declarative data, never executable code.
