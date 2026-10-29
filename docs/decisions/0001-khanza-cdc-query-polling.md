# ADR-0001: Capture Khanza changes by CDC query polling

- Status: proposed
- Date: 2026-10-29
- Deciders: Product owner (user); hospital DBA to confirm replica and read-only user

## Context
Khanza (MariaDB 10.6.26) must stay untouched (root `CLAUDE.md` rule 1): no DDL, triggers or writes. The
product owner chose **query polling** as the CDC approach for `source/hms_services/event-streaming/` on
2026-10-29. This replaces the earlier recommendation (log-based CDC via the binlog, which this ADR slot
was reserved for) and merges the separate "CDC query polling" service into `event-streaming`.

## Options considered
| Option | Notes |
|---|---|
| Log-based CDC (binlog / Debezium) | Sees inserts, updates and deletes with no table changes; needs binlog `ROW` format and a replication user. Previously recommended. |
| **Query polling (chosen by product owner)** | Needs only a read-only `SELECT` user; no binlog prerequisites. Cannot see deletes by itself and needs a reliable change marker per table. Adds read load. |
| Outbox / triggers | Requires writing to Khanza. Not allowed. |

## Decision
_Proposed:_ poll allowlisted Khanza tables on a read-only replica with a bounded, cursor-based query per table.
Per table, before enabling it, record: the change marker (monotonic key, `updated_at`-like column, or a
full-row hash comparison for tables with neither), the delete-detection strategy (periodic key
reconciliation), and the poll interval. Events carry a stable id (table + key + marker) so consumers dedupe.

## Consequences (incl. PHI / compliance impact)
- Deletes and in-place updates without a marker are detected late or by reconciliation only; latency is
  bounded by the poll interval, not near-real-time.
- Extra read load on the replica; never poll the primary.
- Raw topics carry PHI: apply the per-table column minimisation and masking rules; no payloads in logs.
- Broker, language and scheduler remain undecided (separate ADRs).
- If tables prove unpollable, revisit log-based CDC as a fallback.
