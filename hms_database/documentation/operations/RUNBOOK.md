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
- Enable the legacy bridge login (only where the bridge runs): `\password hms_meta_legacy_bridge`, or re-run the
  bootstrap with `HMS_LEGACY_BRIDGE_PASSWORD`.
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

## Clinical record data (ADR-DB-004, ADR-DB-005)
**Manual queries.** Tenant tables in `patient`, `workforce`, `clinical`, `imaging`, `privacy`, `readmodel` and the
0016 `integration` tables have row-level security:
- As a login role you see nothing until you set the tenant.
- A write also needs an actor. A correction of a finalized record also needs a reason.

```sql
BEGIN;
SELECT set_config('hms.organization_id', '<organization uuid>', true),
       set_config('hms.actor_user_id', '<your iam.users id>', true),          -- or hms.actor_service
       set_config('hms.change_reason', '<ticket and reason>', true);          -- only for corrections
-- ... statements ...
COMMIT;
```
- Never fix clinical data by disabling triggers; use a reviewed, attributed correction.
- Records are never deleted: mark them `entered-in-error` with a reason.

**Integrity checks** (auditor role):
```sql
SELECT * FROM audit.verify_chain();     -- first_invalid_seq IS NULL
SELECT * FROM audit.verify_anchors();   -- no rows
```

**Retention.**
- Medical records are retained for at least 25 years from the patient's last visit (Permenkes 24/2022 Pasal 39).
  No delete path exists.
- Expect `*.resource_versions` to grow with every change. Monitor sizes with
  `SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class WHERE relname = 'resource_versions';`.
- Plan partitioning and archiving before tables reach a size that slows vacuum or backup. Not built yet; needs
  measurements.

## Domain authority and cutover (ADR-ROOT-002, ADR-DB-006)
Every canonical record write needs the domain's authority for the organization: `legacy` (only the legacy bridge
writes), `cutover` (nobody) or `native` (only HMS writes). Without a row, nobody writes the domain. Only the owner
changes authority; run these as `hms_meta_migrator` after `SET ROLE hms_meta_owner`, with an approval reference.

**Initial authority** (once per organization; `legacy` for a hospital running the legacy HMS, `native` for one
without):
```sql
BEGIN;
SET ROLE hms_meta_owner;
SELECT set_config('hms.organization_id', '<organization uuid>', true),
       set_config('hms.actor_user_id', '<approver iam.users id>', true);
INSERT INTO integration.domain_authority (organization_id, domain, authority, decision_reference)
SELECT '<organization uuid>', code, 'legacy', '<approval reference>' FROM integration.record_domains;
COMMIT;
```

**Cutover of one domain** (e.g. `patient`):
1. Readiness: the bridge has completed a full pass (`integration.sync_runs` succeeded with `pass_complete` in its
   log); no open `rejected` issues remain unaccepted
   (`SELECT kind, reason_code, count(*) FROM integration.bridge_issues WHERE status = 'open' GROUP BY 1, 2`); counts
   reconcile with the legacy HMS; the native slice is released and users are trained.
2. Start the window (nobody writes; close the legacy screens for data entry):
   ```sql
   BEGIN; SET ROLE hms_meta_owner;
   SELECT set_config('hms.organization_id', '<org>', true), set_config('hms.actor_user_id', '<approver>', true),
          set_config('hms.change_reason', '<why, plan reference>', true);
   UPDATE integration.domain_authority SET authority = 'cutover', decision_reference = '<approval>'
   WHERE organization_id = '<org>' AND domain = 'patient';
   COMMIT;
   ```
3. Let the bridge run one more pass; it now reports instead of writing (`not_applied` issues).
4. Commit the cutover with the same statement and `authority = 'native'`, or abort with `authority = 'legacy'`.
   `native` is final: later problems are fixed forward in HMS.
5. Afterwards, watch `not_applied` issues: they mean someone still changes the domain in the legacy HMS.

History of every change: `SELECT * FROM integration.resource_versions WHERE resource_type = 'DomainAuthority'`.

## Legacy bridge operations
- Runs as `hms-services legacy-bridge` with the `hms_meta_legacy_bridge` login and the SELECT-only legacy account;
  one batch at a time per stream (lease with fencing), so a second instance waits.
- Progress: `SELECT * FROM integration.poll_checkpoints` (cursor, last error class) and
  `SELECT status, count(*) FROM integration.sync_runs WHERE stream_name = '<stream>' GROUP BY 1`.
- Re-map everything after a mapping change: release the new mapping version; the row hash includes it.
- Never fix a bridged record in the legacy database from HMS, and never write the crosswalk by hand.

## Disaster recovery (requirements; production procedure not verified yet)
Permenkes 24/2022 requires:
- a backup system that is periodic, at a different location from the facility, and described in an SOP
  (Pasal 20(4)-(5));
- in-country storage when storage is outsourced (Pasal 22(1)).

Requirements for the production design (targets are proposals for the owner to confirm):
1. Physical base backups plus continuous WAL archiving (e.g. pgBackRest or the managed service's PITR) to encrypted
   storage in a second site in Indonesia. `pg_dump` alone is not a disaster-recovery backup.
2. Proposed targets [owner to confirm]:
   - RPO 15 minutes or better (WAL archive timeout);
   - RTO 4 hours for a full restore;
   - a warm standby (streaming replica) if the RTO must be shorter.
3. A restore drill at least quarterly into an isolated environment:
   1. Restore to a point in time.
   2. Run `scripts/test.*` against the restored copy (it uses rolled-back transactions only).
   3. As auditor, check `audit.verify_chain()` and `audit.verify_anchors()`.
   4. Compare row counts of `patient.patients`, `clinical.encounters` and `*.resource_versions` with the source.
   5. Record the drill result and the time taken.
4. Keep the external audit anchors and the backup catalog outside the primary site. Backups contain PHI: encrypt them
   at rest and restrict who can read them.
5. Promotion between environments with logical dumps keeps versions and history. The record triggers use
   transaction id *and* time, so repeated transaction ids in the new cluster cannot merge versions (tested in
   `090_patient_record.sql`).

## Reset a development database
```sh
psql -U postgres -d postgres -c "DROP DATABASE hms"
scripts/bootstrap.* --database hms   # roles are kept and reused
scripts/migrate.*   --database hms
```
