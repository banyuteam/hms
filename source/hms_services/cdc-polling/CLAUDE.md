# cdc-polling — Instructions

Python service that mirrors allowlisted Khanza MariaDB (10.6.26) tables into PostgreSQL 18 and records
change events, using hash-based reconciliation over fixed-size primary-key ranges. Read the root
`CLAUDE.md`, `design/hms_services/cdc-polling/PRD.md` and `BUILD-PLAN.md` first.

## Scope

- Capture only: Khanza replica → `khanza_mirror.<table>` + `cdc.change_event` (+ checkpoints) in PostgreSQL.
- Publishing `cdc.change_event` to a broker and translating to domain events belongs to
  `source/hms_services/event-streaming/`.
- PostgreSQL DDL belongs to `source/hms_database/cdc-polling/migrations/`; this project never creates tables.

## Rules

- **Never write to Khanza.** All source SQL comes from `sqlgen.py` and passes the allowlist in
  `source.py`. Don't add a code path that bypasses `ReadOnlySource._exec`, don't widen the allowlist
  beyond reads, and don't weaken the grant check.
- **No table-specific code in the engine.** A new table is a mapping file plus a migration; follow the
  `cdc-table-mapping` skill.
- Hashes are computed by MariaDB only. If you change `sqlgen.row_hash_expr`, bump
  `mapping.HASH_VERSION` (every table then needs `resync`).
- Ranges are bounded on the MariaDB side only; never compare source keys with PostgreSQL ordering.
  Key membership is `cdc.row_state.range_id`.
- One PostgreSQL transaction per range. Anything a range writes goes through `Target.apply_range`.
- PHI: don't log keys or values. Use counts, range ids, or `logs.key_ref()`. Tests use synthetic data.
- Cross-platform: `pathlib`, no shell scripts, Python 3.10 syntax (Ubuntu 22.04 stock Python).
- Secrets only from the environment / `.env` (git-ignored). Update `.env.example` when adding a setting.
- Run `python -m pytest` (with the integration variables set, see `tests/integration/README.md`) before
  calling work done.
