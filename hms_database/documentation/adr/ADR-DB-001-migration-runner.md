# ADR-DB-001: Plain-SQL migrations applied by a psql-based runner

- Status: Proposed
- Date: 2026-11-08
- Owners: hms_database
- Affected projects: hms_database (owner), root `deployment/` (release step), hms_services (must not self-migrate)
- Related contracts: `standards/architecture/shared-postgresql-platform.md`, root `CLAUDE.md` §13

## Context
Workstream 1 needs versioned, reviewed migrations executed as a controlled one-shot release step, not by every
service replica. The previous implementation embedded migrations in Go packages, each with its own ledger and
run at service start-up; its database project left the tool undecided. This workspace keeps
`hms_database` independent of the Go runtime, and the developer machine is Windows while CI/containers are Linux.

## Decision
1. Migrations are plain PostgreSQL SQL files `migrations/NNNN_snake_case.sql`, forward-only and immutable once
   applied anywhere shared. Fixes are new migrations.
2. They are applied by a runner written in psql scripting (`tooling/psql/`), driven by thin wrappers
   (`scripts/migrate.ps1`, `scripts/migrate.sh`) that list files and compute checksums. One psql session per run.
3. Ledger `hms_meta.schema_migrations` (version, name, SHA-256 checksum of the file without CR bytes, applied_at,
   applied_by, duration_ms).
4. Per run: session advisory lock (one runner per database); `SET ROLE` to the database owner; reject changed
   checksums, applied versions missing on disk, new versions older than the latest applied, duplicate versions,
   BOMs and transaction control in files; apply each pending file in its own transaction together with its ledger
   row; `--plan` reports without changes in a read-only session.
5. Services never run DDL: the runtime role has no CREATE rights (ADR-DB-002).

## Alternatives considered
1. golang-migrate / goose (Go): good fit with hms_services, but couples hms_database to the Go toolchain and needs
   module downloads; no built-in checksum verification of applied files (golang-migrate).
2. Flyway / Liquibase: mature checksum and history handling, but a JVM dependency and licensing review; Flyway's
   `V<n>__name.sql` convention could be adopted later by renaming.
3. Sqitch: strong dependency model, adds Perl and a plan file; heavier than needed now.
4. Embedded per-package migrations run at service start (previous implementation): rejected by root `CLAUDE.md` (migrations
   are a controlled release step, not run from every replica).

## Consequences
- Positive: only `psql` 18 needed (present in the PostgreSQL install and the `postgres:18` image); plain SQL stays
  portable to another tool; one password prompt per run; checksums identical on Windows and Linux (verified).
- Negative: two small wrappers to keep in step; no non-transactional migrations yet (`CREATE INDEX CONCURRENTLY`
  needs a marker and a separate code path when first required); no down migrations (deliberate: fix forward).
- Operational: run as `hms_meta_migrator`; schedule as a release step before rolling out services.
- Compatibility: the ledger table is ours; moving to another tool means importing its rows into that tool's history.
- Security/privacy: the migrator has no inherited rights; it acts only after `SET ROLE hms_meta_owner`. Passwords come
  from the psql prompt, PGPASSWORD or pgpass, never from the scripts.
- Patient-safety: none directly; failed migrations roll back completely (verified).

## Ownership impact
hms_database owns the runner, migrations and ledger. The root workspace owns wiring it into Compose/CI as a one-shot
job. hms_services consumes the resulting schema only.

## Migration and rollout
New; no existing database. CI should run bootstrap -> migrate -> test -> `migrate --plan` (no pending) on an
ephemeral PostgreSQL 18.

## Acceptance criteria
- [x] Applies pending migrations in order, each atomically with its ledger row.
- [x] Second run is a no-op; `--plan` changes nothing.
- [x] Rejects edited, missing, duplicate and out-of-order migrations; rejects concurrent runs.
- [x] Same checksums from PowerShell and bash, with LF or CRLF checkouts.
- [ ] Wired into CI and the release process.

**Amendment 2026-11-09:** references to the previous implementation outside this workspace removed; decisions unchanged.
