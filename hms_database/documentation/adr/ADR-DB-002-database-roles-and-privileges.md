# ADR-DB-002: Database, role model and baseline privileges

- Status: Proposed
- Date: 2026-11-08
- Owners: hms_database
- Affected projects: hms_database (owner), hms_services (connects as runtime), root `deployment/` (credentials)
- Related contracts: `standards/architecture/shared-postgresql-platform.md`, root `CLAUDE.md` §14-15

## Context
Root instructions require least-privilege, schema-scoped credentials with separate migration, runtime, reporting and
legacy identities, no superuser at runtime and no frontend access. PostgreSQL roles are cluster-wide, and a
development cluster may already hold roles from other projects (the shared dev cluster already holds `hms_app`,
`hms_audit_app`, `hms_audit_reader`, `hms_bff_app` from the previous implementation).

## Decision
1. One database per environment (default `hms`), UTF8, builtin `C.UTF-8` locale (same collation on Windows, Linux
   and containers), time zone UTC. Created by `bootstrap/bootstrap.psql` run by a superuser.
2. Per-database roles named `<p>_*`, prefix `<p>` = `hms_meta` by default (`hms_meta_owner`, `hms_meta_migrator`,
   `hms_meta_runtime`, `hms_meta_auditor`, `hms_meta_reporting`); each additional database on a cluster needs its own prefix:
   `<p>_owner` (NOLOGIN, owns database and objects), `<p>_migrator` (LOGIN, `SET` but not `INHERIT` on owner),
   `<p>_runtime` (LOGIN, hms_services), `<p>_auditor` and `<p>_reporting` (LOGIN, read-only sessions).
3. Capability group roles, NOLOGIN, shared by HMS databases on a cluster and the only grantees in migrations:
   `hms_platform_rw`, `hms_iam_rw` (added for ADR-DB-003), `hms_eventing_rw`, `hms_integration_rw`, `hms_audit_append`, `hms_audit_read`,
   `hms_report_read`. The runtime inherits the first five; auditor and reporting one each.
4. `PUBLIC` loses CONNECT/TEMPORARY/CREATE on the database, all rights on schema `public`, and EXECUTE on new
   functions (default privileges). Login roles get CONNECT on their own database only.
5. Role settings: runtime `statement_timeout 30s`, `lock_timeout 5s`, `idle_in_transaction_session_timeout 60s`;
   auditor/reporting `default_transaction_read_only on`, `statement_timeout 120s`; migrator `lock_timeout 10s`.
   Connection limits: runtime 50, reporting 10, auditor 5, migrator 3.
6. Every managed role carries a comment `hms_database:...`; the bootstrap refuses to adopt an existing role without
   the expected comment, and is otherwise idempotent (re-applies attributes, memberships and settings, drops nothing).
7. Passwords: interactive `\password` (hashed client-side) when a login has none; CI may pass
   `HMS_*_PASSWORD` environment variables (sent as `ALTER ROLE ... PASSWORD`, so not for servers that log DDL).

## Alternatives considered
1. One application login with broad rights: simplest, violates least privilege and the root role-separation rule.
2. Fixed cluster-wide login names (`hms_app`): collides with the existing roles on shared dev clusters and lets
   one database's login reach another's objects through ownership.
3. Default privileges instead of explicit GRANTs in migrations: less typing, but new tables become reachable
   implicitly; explicit grants keep every exposure reviewable.
4. Row-level security for tenant isolation now: deferred until tenant-scoped clinical tables exist.

## Consequences
- Positive: runtime cannot run DDL, read the audit trail or the ledger (tested); reporting sees only approved schemas;
  several HMS databases can share a dev cluster without reaching each other (verified).
- Negative: new capability group roles require re-running the bootstrap (superuser) before the migration using them.
- Operational: connection budget 68 + superuser reserve; size `max_connections` and service pools accordingly.
- Compatibility: root `deployment/compose.yaml` currently gives services the container superuser; it must switch to
  `<p>_runtime`.
- Security/privacy: the owner and superusers can still disable triggers; the audit hash chain detects in-chain tampering
  and needs external anchoring for full coverage.
- Patient-safety: none directly.

## Ownership impact
hms_database owns bootstrap, roles and grants. hms_services owns its connection pools and must use `<p>_runtime`.
The root workspace owns secret delivery (Docker secrets / secret manager).

## Migration and rollout
New. On an existing cluster: run the bootstrap with a superuser; it creates only what is missing.

## Acceptance criteria
- [x] Runtime role cannot create, alter or drop objects (tested).
- [x] No table or function in HMS schemas is accessible to `PUBLIC` (tested).
- [x] Bootstrap is idempotent and refuses foreign roles (verified).
- [ ] Production credentials delivered through an approved secret manager.
- [ ] Legacy MySQL credentials remain separate (outside this database; owned by hms_services/ops).

**Amendment 2026-11-09:** references to the previous implementation outside this workspace removed; decisions unchanged.
