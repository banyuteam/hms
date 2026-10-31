# event-streaming — Instructions

Captures changes from the Khanza MariaDB (10.6.26) and publishes them as events for every
other subproject. Read the root `CLAUDE.md` and `design/hms_services/event-streaming/PRD.md` first (plans, PRD and skills live in `design/hms_services/event-streaming/`; this folder is the code).

## Scope

- Capture itself (polling Khanza) now lives in `source/hms_services/cdc-polling/` (product owner,
  2026-10-30, proposed ADR-0005). This project relays its outbox `cdc.change_event` (PostgreSQL 18) to the
  broker; it does not poll Khanza itself.
- Raw change topics: `khanza.<table>` (one topic per table, key = table primary key).
- Translators (anti-corruption layer) that turn raw changes into domain events
  `<domain>.<entity>.<event>.v<N>` (e.g. `encounter.visit.registered.v1`), with schemas in
  `source/hms_shared/events/`.
- Snapshot/backfill procedure, offset management, replay, dead-letter handling, monitoring.

Out of scope: business logic of consuming services; warehouse modeling (`source/hms_web-frontend-UIUX/web-datatooling/`).

## Rules

- Approach: **CDC query polling** (product owner, 2026-10-29), recorded as proposed **ADR-0001** — not
  accepted yet, so ask before building. No triggers, outbox tables or any write against Khanza.
  Polling cannot see deletes and needs a usable change marker per table (see ADR-0001); record the
  marker and the delete-detection strategy per table before enabling it.
- Prerequisites live on the DB side and are done by the DBA, not by our code: a dedicated read-only
  user with `SELECT` on the allowlisted tables only. Document required settings in
  `source/hms_services/event-streaming/docs/`; never run `SET GLOBAL` or grants yourself.
- Poll a read-only replica, never the primary; bound each query (key range / time window, `LIMIT`).
- Khanza tables can lack primary keys or use composite keys (`no_rawat` + others). For each
  table, record the key used and how keyless tables are handled before enabling it.
- Mask or drop columns that aren't needed downstream (data minimisation). Record per-table
  column decisions in the table allowlist file.
- Delivery is at-least-once: every event carries a stable event id, source position (poll
  cursor value / run id), table, op (`c/u/d/r`) and timestamp so consumers can dedupe and order.
- Schema changes in Khanza (after a Khanza upgrade) must not silently break consumers:
  detect, alert, and version the affected event schema.

## Adding a table (checklist)

1. Confirm table and columns against `docs/references/khanza-schema/`.
2. Add to allowlist with key, columns kept/masked, and owning domain.
3. Define the raw and domain event schema in `source/hms_shared/events/`.
4. Add translator + tests with synthetic rows (insert, update, delete, snapshot read).
5. Note the backfill plan (snapshot size, run window).
