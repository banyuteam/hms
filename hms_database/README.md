# hms_database

Owns PostgreSQL 18 data architecture, canonical data models, schema/migration governance, legacy schema documentation
and event/persistence contracts. Start with `CLAUDE.md`; use the project skills under `.claude/skills/`. Coordinate
shared contract changes with `hms_services`.

**Status: development-ready foundation** (Workstream 1 of `standards/architecture/implementation-roadmap-v4.md`).
Not CI-, staging- or production-ready yet; see [Open items](#open-items).

## What exists

| Path | Purpose |
|---|---|
| `bootstrap/bootstrap.psql` | Superuser step: database, roles, baseline privileges ([ADR-DB-002](documentation/adr/ADR-DB-002-database-roles-and-privileges.md)) |
| `migrations/NNNN_name.sql` | Forward-only, immutable schema migrations |
| `tooling/psql/` | Migration runner core (ledger, checksums, ordering, lock) ([ADR-DB-001](documentation/adr/ADR-DB-001-migration-runner.md)) |
| `scripts/*.ps1`, `scripts/*.sh` | Wrappers: `bootstrap`, `migrate`, `test` (PowerShell for Windows, bash for CI/containers) |
| `tests/sql/` | Role, privilege, governance and schema behaviour tests (rolled back) |
| `schemas/<schema>/README.md` | Per-schema owner, classification, tables and usage patterns |
| `documentation/` | Domain ownership, data dictionary, ADRs, operations runbook |

Schemas created so far:
- **Platform:** `hms_meta` (ledger), `platform`, `audit`, `eventing`, `integration`, `iam`.
- **Native clinical record** (ADR-DB-004, ADR-DB-005):
  - `terminology`, `workforce`, `patient`, `clinical`, `knowledge`, `imaging`, `readmodel`, `privacy` and
    `analytics`;
  - separate from the legacy Khanza database and following `standards/healthcare/clinical-data-standards.md`.
- **Not yet production content:** code lists, templates and the processing register still need clinical-governance
  and DPO approval.

## Quick start (local PostgreSQL 18)

Requirements: PostgreSQL 18 server and `psql` 18 (`C:\Program Files\PostgreSQL\18\bin` is found automatically on
Windows). Run these in your own terminal: psql prompts for passwords interactively.

```powershell
cd hms_database

# 1. Create the database and roles. Prompts for the superuser (master) password, then asks you to choose
#    passwords for hms_meta_migrator and hms_meta_runtime. Nothing is stored by the scripts.
powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1 -Database hms -SuperUser postgres

# 2. See what would be applied, then apply (prompts for the hms_meta_migrator password).
powershell -ExecutionPolicy Bypass -File scripts\migrate.ps1 -Database hms -Plan
powershell -ExecutionPolicy Bypass -File scripts\migrate.ps1 -Database hms

# 3. Run the database tests (prompts for the superuser password; rolled back, development/CI only).
powershell -ExecutionPolicy Bypass -File scripts\test.ps1 -Database hms
```

bash equivalents: `scripts/bootstrap.sh --database hms`, `scripts/migrate.sh --database hms [--plan]`,
`scripts/test.sh --database hms`. Common options: host/port (`-DbHost`/`-Port`, `--host`/`--port`, or `PGHOST`/`PGPORT`).

Resulting roles (prefix `hms_meta` by default; a second database on the same server needs its own `-RolePrefix`):

| Role | Login | Use |
|---|---|---|
| `hms_meta_owner` | no | Owns the database and all objects |
| `hms_meta_migrator` | yes | Runs migrations (SET ROLE `hms_meta_owner`); nothing else |
| `hms_meta_runtime` | yes | `hms_services` runtime connection (native transaction layer): DML only, no DDL |
| `hms_meta_legacy_bridge` | yes | `hms_services legacy-bridge` worker (ADR-ROOT-002, ADR-DB-006): canonical record groups and bridge state only; password from `HMS_LEGACY_BRIDGE_PASSWORD` or `\password hms_meta_legacy_bridge` |
| `hms_meta_auditor` | yes | Read-only audit review (set a password with `\password hms_meta_auditor` when needed) |
| `hms_meta_reporting` | yes | Read-only reporting (`\password hms_meta_reporting` when needed) |

## Writing a migration

1. Next free number: `migrations/0022_short_name.sql` (lowercase snake case).
2. Header comment: purpose, owner/writer, classification, online-safety, rollback/fix-forward.
3. Schema-qualify every object; name constraints (`pk_`, `fk_`, `uq_`, `ck_`, `idx_`, `trg_`); `timestamptz` for
   instants; `uuidv7()` defaults for externally referenced ids.
4. Grant explicitly to group roles (`hms_*_rw`, `hms_audit_*`, `hms_report_read`); never to `PUBLIC` or login roles.
   New group roles are added to `bootstrap/bootstrap.psql` first.
5. No `BEGIN`/`COMMIT` and no `SET ROLE`: the runner wraps each file in a transaction as the owner.
6. Add tests in `tests/sql/`, update `schemas/<schema>/README.md` and `documentation/DATA-DICTIONARY.md`.
   Clinical record tables use `hms_meta.enable_versioned_record(...)` (versioning, history, no delete, tenant RLS) and
   carry `organization_id`, `version`, `created_at`, `updated_at` and `last_xact_id` (ADR-DB-005). Those in
   `patient`, `workforce`, `clinical` and `imaging` also call `hms_meta.enable_record_domain(table, domain)` (layer
   guard and `record_origin`, ADR-DB-006); a child table goes in its parent's domain.
7. Never edit a migration once it has been applied anywhere shared: the runner rejects changed checksums. Fix forward.

## Open items

- CI pipeline (`.github/workflows/ci.yml`, ephemeral PostgreSQL 18 service: bootstrap -> migrate --plan -> migrate ->
  migrate --plan must show nothing pending -> tests) is written but has not had its first run. The same sequence passed
  locally on 2026-11-10 against a fresh PostgreSQL 18.6 cluster (21 migrations, all 13 test files).
- Root `deployment/compose.yaml` now runs bootstrap (superuser) and migrations (`hms_meta_migrator`) as one-shot jobs
  and `hms-services` as `hms_meta_runtime`; passwords are mounted secret files. Not yet run with Docker.
- `hms_services` sign-in (ADR-SVC-001) connects as `hms_meta_runtime` and uses `iam`, `audit` and `platform`; it
  still needs permission registration and real Khanza verification (ADR-DB-003).
- IAM role catalog and the first IAM administrator are owner decisions; nothing is seeded.
- The audit anchor table and verification exist (0019). Not built yet:
  - the anchoring job;
  - retention/partitioning jobs;
  - production backup/PITR (RUNBOOK, Disaster recovery).
- Clinical record: `hms_services` must set the transaction context (ADR-DB-005) before its first write. Its legacy
  import, SATUSEHAT exchange and read-through cutover each need their own ADR (ADR-DB-004 rollout).
- Open owner decisions (ADR-DB-004 open questions):
  - identifier encryption;
  - the IHS-number URI;
  - break-glass access;
  - departments and orders;
  - retention execution.
