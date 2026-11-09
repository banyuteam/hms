# hms_database Operations Runbook

Scope: development and CI. Staging/production procedures (managed PostgreSQL, PITR, TLS, secret manager, monitoring)
are not defined yet and must be reviewed before any release is called production-ready.

## Health check
```sh
pg_isready -h <host> -p <port> -d hms
psql -X -h <host> -U hms_meta_migrator -d hms -c "SET ROLE hms_meta_owner" -c "SELECT max(version) FROM hms_meta.schema_migrations"
scripts/migrate.sh --database hms --plan    # expect no 'pending' lines after a release
```

## Release step (migrations)
1. `scripts/migrate.* --plan` against the target; review pending versions.
2. Back up (below) unless the target is disposable.
3. `scripts/migrate.*` once, from one place (never from every service replica).
4. Roll out services. On failure, the failing migration has rolled back completely; fix forward with a new migration.

## Passwords
- Change a login password: `psql -U postgres -d hms -c "\password hms_meta_runtime"` (hashed before it is sent).
- Enable auditor/reporting logins: `\password hms_meta_auditor`, `\password hms_meta_reporting`.
- Never commit passwords; local tools may use a pgpass file outside the repository.

## Audit trail verification
```sql
-- as hms_meta_auditor
SELECT * FROM audit.verify_chain();   -- expect first_invalid_seq IS NULL
SELECT max(seq), encode(hash, 'hex') FROM audit.audit_events WHERE seq = (SELECT max(seq) FROM audit.audit_events) GROUP BY hash;
```
Record the latest `(seq, hash)` outside the database to detect truncation of the newest rows.

## Backup and restore (development)
```sh
pg_dump -h <host> -U postgres -d hms -Fc -f hms_$(date +%Y%m%d).dump
pg_dumpall -h <host> -U postgres --roles-only -f hms_roles.sql   # roles are cluster-wide; contains password hashes: protect it
# restore into a fresh cluster: run bootstrap first (roles, empty database, settings), then
pg_restore -h <host> -U postgres -d hms --no-owner --role=hms_meta_owner --exit-on-error hms_YYYYMMDD.dump
scripts/test.* --database hms
psql -U hms_meta_auditor -d hms -c "SELECT * FROM audit.verify_chain()"
```
- `pg_restore` loads table data before it creates triggers, so audit rows keep their original `seq`, `recorded_at`
  and hashes (verified 2026-11-08: identical hash sequence after dump/restore of 800 rows).
- Database-level and role-level settings (UTC time zone, timeouts) are not in a `-Fc` dump: create the target with
  the bootstrap, not with a bare `CREATE DATABASE`.
- The bootstrap only adopts roles whose comment names the same database, so restore into a database with the same
  name (or pass a new `-RolePrefix`).
- Production needs physical backups with point-in-time recovery and restore drills; `pg_dump` is not a substitute.

## Reset a development database
```sh
psql -U postgres -d postgres -c "DROP DATABASE hms"
scripts/bootstrap.* --database hms   # roles are kept and reused
scripts/migrate.*   --database hms
```
