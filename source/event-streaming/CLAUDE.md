# event-streaming — Instructions

Captures changes from the Khanza MariaDB (10.6.26) and publishes them as events for every
other subproject. Read the root `CLAUDE.md` and `design/event-streaming/PRD.md` first (plans, PRD and skills live in `design/event-streaming/`; this folder is the code).

## Scope

- CDC connector configuration for Khanza tables (table allowlist — never "all tables").
- Raw change topics: `khanza.<table>` (one topic per table, key = table primary key).
- Translators (anti-corruption layer) that turn raw changes into domain events
  `<domain>.<entity>.<event>.v<N>` (e.g. `encounter.visit.registered.v1`), with schemas in
  `source/shared/events/`.
- Snapshot/backfill procedure, offset management, replay, dead-letter handling, monitoring.

Out of scope: business logic of consuming services; warehouse modeling (`source/data-warehouse/`).

## Rules

- Approach is pending **ADR-0001** (recommended: log-based CDC via binlog). Don't build
  polling, triggers or outbox against Khanza.
- Prerequisites live on the DB side and are done by the DBA, not by our code: `binlog_format=ROW`,
  `binlog_row_image=FULL`, sufficient binlog retention, a unique `server_id`, and a dedicated
  CDC user with only `SELECT, RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT`.
  Document required settings in `source/event-streaming/docs/`; never run `SET GLOBAL` or grants yourself.
- Prefer reading the binlog from a replica so the primary is never loaded by snapshots.
- Khanza tables can lack primary keys or use composite keys (`no_rawat` + others). For each
  table, record the key used and how keyless tables are handled before enabling it.
- Mask or drop columns that aren't needed downstream (data minimisation). Record per-table
  column decisions in the table allowlist file.
- Delivery is at-least-once: every event carries a stable event id, source position (binlog
  file/pos or GTID), table, op (`c/u/d/r`) and timestamp so consumers can dedupe and order.
- Schema changes in Khanza (after a Khanza upgrade) must not silently break consumers:
  detect, alert, and version the affected event schema.

## Adding a table (checklist)

1. Confirm table and columns against `docs/references/khanza-schema/`.
2. Add to allowlist with key, columns kept/masked, and owning domain.
3. Define the raw and domain event schema in `source/shared/events/`.
4. Add translator + tests with synthetic rows (insert, update, delete, snapshot read).
5. Note the backfill plan (snapshot size, run window).
