---
name: cdc-table-mapping
description: Add a Khanza table to cdc-polling, or change an existing table mapping (columns, key, range size, scan intervals, target SQL). Use when editing source/hms_services/cdc-polling/mappings/*.yaml or the matching khanza_mirror migration.
---

# Add or change a cdc-polling table mapping

A table is **configuration, not code**: one mapping file plus one PostgreSQL migration. Never add
table-specific logic to `src/khanza_cdc/`. Khanza is never written to; you only read its schema snapshot.

Files involved:

| What | Where |
|---|---|
| Mapping (machine-read) | `source/hms_services/cdc-polling/mappings/<table>.yaml` |
| Mirror DDL | `source/hms_database/cdc-polling/migrations/NNNN_mirror_<table>.sql` (next free number) |
| Human mapping notes | `source/hms_database/cdc-polling/MAPPING.md` |
| DBA grant list | `source/hms_services/cdc-polling/docs/source-db-prerequisites.md` |
| Schema snapshot | `docs/references/khanza-schema/rsb221022021.sql` (structure only) |

## Adding a table

1. **Read the table in the schema snapshot.** Copy exact column names and types; never guess.
   Note the `PRIMARY KEY (...)` and the type of each key column.
2. **Pick the key strategy.**
   - No primary key → stop. Not supported (BUILD-PLAN.md §5); tell the product owner.
   - Single integer key → `int_range` (fixed-width ranges) or `keyset`.
   - Anything else (varchar, char, composite, date, double) → `keyset`.
   - Any key column of MariaDB type `ENUM` → list it in `key.enum_columns`
     (ENUM sorts by index but compares as text; the engine casts it so keyset paging stays correct).
3. **Choose columns (data minimisation).** Copy only what a known consumer needs. Every key column must
   be listed. Mark identifying or clinical columns `phi: true` (names, NIK `no_ktp`, BPJS `no_peserta`,
   `no_rkm_medis`, `no_rawat`, address, phone, birth date, diagnoses). Only listed columns are hashed:
   a change in an unlisted column is deliberately not an event.
4. **Map types** (mirror is a raw copy; translators do the business conversion):

   | MariaDB | PostgreSQL `type:` |
   |---|---|
   | varchar(n) / char(n) | varchar(n) / char(n) |
   | enum, set, text | text |
   | tinyint / smallint | smallint |
   | int / mediumint | integer |
   | bigint | bigint |
   | double / decimal | numeric (money stays raw here; integer Rupiah in translators) |
   | date / time / datetime | date / time / timestamp (zero dates become NULL automatically) |

   Optional `transform:` per column: `zero_date_null`, `strip`, `empty_to_null`, `float_to_decimal`.
5. **Size the ranges.** `range.size` 2 000–5 000 rows, `range.page_size` 500–1 000. Tables keyed by
   date-prefixed values (`no_rawat` = `YYYY/MM/DD/NNNNNN`) get most changes in the tail range, which is
   always hot. Set `scan.hot_interval_s` to the latency the consumer needs and `scan.cold_interval_s`
   to the longest acceptable delay for edits to old rows. Every scan re-reads its range on the replica.
6. **Write the mapping** (`<table>.yaml`; the file name must equal `table`):

   ```yaml
   # Khanza `<table>` — what it is. Key: <cols> (<types>). Mirror DDL: NNNN_mirror_<table>.sql
   table: <table>
   domain: <owning domain>
   enabled: true
   key:
     columns: [<pk col>, ...]       # exact PRIMARY KEY order
     strategy: keyset               # or int_range
     enum_columns: []               # key columns that are ENUM in MariaDB
   range: {size: 5000, page_size: 1000}
   scan: {hot_interval_s: 60, cold_interval_s: 3600}
   columns:
     - {name: <col>, type: <pg type>, phi: true}
   target:
     table: khanza_mirror.<table>
     # upsert_sql_file: <table>.upsert.sql   # only if the generated upsert can't express it
   ```

7. **Write the migration** in `source/hms_database/cdc-polling/migrations/`, following `0002_mirror_pasien.sql`:
   the mapped columns with the same names, the same primary key, plus
   `_cdc_row_hash char(32) NOT NULL`, `_cdc_synced_at timestamptz NOT NULL DEFAULT now()`,
   `_cdc_deleted_at timestamptz`; `COMMENT ON COLUMN ... IS 'PHI: ...'` for PHI columns; header lines for
   online-safety and rollback. Migrations are immutable once merged: fix forward.
8. **Update** `MAPPING.md` (source → mirror columns, what is not copied and why) and add the table's
   `GRANT SELECT` line to `docs/source-db-prerequisites.md`.
9. **Check and test:**

   ```
   cdc-polling validate              # mapping syntax and rules, no database
   cdc-polling show-sql --table <t>  # review the generated SELECTs (share with the DBA)
   cdc-polling check                 # against a dev/replica DB: key, enum keys, columns, mirror schema
   python -m pytest                  # unit + integration (tests/integration/README.md)
   ```

   If the table has a key shape the tests don't cover yet, add synthetic rows for it to
   `tests/integration/` (insert, update, update to NULL, delete, split). Synthetic data only.

## Changing an existing mapping

- **Tuning only** (`range.size`, `page_size`, `scan.*`, `enabled`): no resync. Existing ranges keep their
  boundaries; `range.size` applies to future splits.
- **Columns, types, transforms, key, target or upsert SQL** change the mapping fingerprint. The engine
  then refuses to run the table until you:
  1. add a forward migration for the mirror change (e.g. `ADD COLUMN`),
  2. deploy the new mapping,
  3. run `cdc-polling resync --table <t> --yes` — every row is re-read and re-applied on the next
     passes and reported as `r` events, not `u`. Warn the DBA: it is a full re-read of that table.
- Changing the **key** (rare, e.g. after a Khanza upgrade) needs a new mirror table and a fresh bootstrap;
  ask the product owner first because downstream consumers see a new key.
- Never edit `HASH_VERSION` or `sqlgen.row_hash_expr` as part of a mapping change.

## Hand-written target SQL

Use `target.upsert_sql_file` only when the generated `INSERT ... ON CONFLICT` can't express the need.
The file lives in `mappings/`, uses named placeholders `%(<target column>)s` plus `%(_cdc_row_hash)s`,
must set `_cdc_synced_at = now()` and `_cdc_deleted_at = NULL` on conflict, and may only write the table's own
mirror table. It is part of the fingerprint, so changing it requires a resync.
