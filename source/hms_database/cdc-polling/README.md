# hms_database / cdc-polling

PostgreSQL 18 schema for the [`cdc-polling`](../../hms_services/cdc-polling/) service. Never applied to Khanza.

| Migration | Contents |
|---|---|
| `0001_cdc_control_schema.sql` | Schemas `cdc` and `khanza_mirror`; `cdc.table_state`, `cdc.range_checkpoint` (one independent checkpoint per primary-key range), `cdc.row_state` (source row hash per key), `cdc.change_event` (outbox for event-streaming), `cdc.scan_run` (metrics) |
| `0002_mirror_pasien.sql` | `khanza_mirror.pasien` |
| `0003_mirror_reg_periksa.sql` | `khanza_mirror.reg_periksa` |
| `0004_mirror_diagnosa_pasien.sql` | `khanza_mirror.diagnosa_pasien` (composite key) |
| `roles.example.sql` | Template for the DBA: `cdc_polling` writer role and a read-only consumer role |

Every mirror table has the mapped source columns plus `_cdc_row_hash`, `_cdc_synced_at` and
`_cdc_deleted_at` (deletes in Khanza become soft deletes here). Column-by-column mapping: [`MAPPING.md`](MAPPING.md).

The mirror tables deliberately differ from the general rules in `../CLAUDE.md`: they are a raw read-side copy,
so they keep the source key as primary key and use `_cdc_synced_at` instead of `created_at`/`updated_at`, and
`biaya_reg` stays `numeric` (MariaDB `double`) until a translator converts it to integer Rupiah.

## Apply

The migration tool is not decided yet (see `../CLAUDE.md`). The files are plain, ordered SQL; each states
whether it is online-safe and how to roll back.

```bash
psql "host=<host> dbname=<db> user=<owner>" -v ON_ERROR_STOP=1 -f migrations/0001_cdc_control_schema.sql
# then 0002, 0003, 0004 in order (Windows: same command in PowerShell)
```

The dev compose file in `source/hms_services/cdc-polling/` mounts this folder into a PostgreSQL 18 container.
