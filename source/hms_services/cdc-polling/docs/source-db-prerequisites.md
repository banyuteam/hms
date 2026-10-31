# Source database prerequisites (for the hospital DBA)

The service only reads. Everything below is done by the DBA on the **replica**; the service never runs
grants, `SET GLOBAL` or DDL, and refuses to start if its user can write.

1. **Read-only replica** of the Khanza MariaDB 10.6 database. Do not point the service at the primary.
2. **A dedicated user with `SELECT` on the allowlisted tables only** (one grant per table in `mappings/`):

   ```sql
   CREATE USER 'cdc_reader'@'<cdc-host>' IDENTIFIED BY '<from secret store>';
   GRANT SELECT ON `<khanza_db>`.`pasien` TO 'cdc_reader'@'<cdc-host>';
   GRANT SELECT ON `<khanza_db>`.`reg_periksa` TO 'cdc_reader'@'<cdc-host>';
   GRANT SELECT ON `<khanza_db>`.`diagnosa_pasien` TO 'cdc_reader'@'<cdc-host>';
   -- optional, only for the replica-lag guard (CDC_MAX_REPLICA_LAG_S):
   GRANT REPLICA MONITOR ON *.* TO 'cdc_reader'@'<cdc-host>';
   ```

   Accepted privileges: `USAGE`, `SELECT`, `SHOW VIEW`, `REPLICA MONITOR` / `SLAVE MONITOR`,
   `REPLICATION CLIENT`, `BINLOG MONITOR`, `PROCESS`. Anything else (including role grants) makes
   `cdc-polling check` and `run` refuse to start.
3. **TLS** between the service and the replica if they are on different hosts (`CDC_SOURCE_SSL_CA`).
4. **Statement time limit**: the service sets `SET SESSION max_statement_time` (default 60 s). Confirm the
   value is acceptable, or set a lower per-user `MAX_STATEMENT_TIME` on the account.
5. **Load budget**: agree on `CDC_MAX_SOURCE_ROWS_PER_SECOND` and the scan intervals. Each scan of a range
   reads every row in it (hash comparison); see BUILD-PLAN.md §4.

What the service sends: `SELECT` statements (digests, keyset pages, row fetches, `information_schema`
lookups), `SHOW GRANTS`, `SHOW REPLICA STATUS`, `SET SESSION` (read-only, isolation, time zone, statement
time), and `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY` / `COMMIT`. Review the exact SQL with
`cdc-polling show-sql`.
