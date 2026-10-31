# ADR-0005: Detect Khanza changes by hash-based reconciliation over primary-key ranges

- Status: proposed
- Date: 2026-10-30
- Deciders: Product owner (user); hospital DBA to confirm the replica load budget

## Context
ADR-0001 (proposed) chose query polling of a read-only replica but left the per-table change marker open.
Khanza tables have no `updated_at`, many keys are varchar or composite (measured on the schema snapshot:
540 single char/varchar, 446 composite, 89 single integer, 151 without a primary key), and Khanza must not be
changed (no triggers, columns or tables). On 2026-10-30 the product owner asked for hash-based reconciliation
with primary-key range partitioning and incremental scan checkpoints, with four constraints: fixed-size
primary-key ranges, keyset pagination inside each partition, independent scan checkpoints, and MariaDB untouched.
The broker for raw topics is still undecided.

## Options considered
| Option | Notes |
|---|---|
| **Hash reconciliation over PK ranges (requested)** | Works without any change marker; sees inserts, updates and deletes. Cost: every scan re-reads the range on the replica; changes between two scans are coalesced. |
| Full-table snapshot diff each cycle | Simplest, but reads and transfers every row every cycle. |
| Monotonic key / date column as cursor | Only sees inserts; Khanza updates and deletes in place. |
| Log-based CDC (binlog) | Real-time and complete, but needs binlog/replication privileges; ADR-0001's fallback. |

## Decision
_Proposed:_ the `cdc-polling` service (Python, ADR-0006) splits each allowlisted table into contiguous
`[lower, upper)` key ranges of fixed size (`keyset`: a boundary every N rows in MariaDB's key order, for any
key; `int_range`: fixed-width integer ranges). Per range it compares a MariaDB-computed digest (row count and
XOR of MD5 prefixes of the mapped columns) with the stored checkpoint, and only on a mismatch pages through
`(key, row hash)` with keyset pagination in a read-only snapshot, diffs against stored row hashes, fetches the
changed rows and applies mirror rows, row hashes, change events and the checkpoint in one PostgreSQL transaction.
Ranges have independent checkpoints and adaptive re-scan intervals. Captured changes land in PostgreSQL 18
(ADR-0004): `khanza_mirror.<table>` and the outbox table `cdc.change_event`, which `event-streaming` relays to
`khanza.<table>` topics once the broker is chosen. Tables without a primary key are out of scope for now.

## Consequences (incl. PHI / compliance impact)
- Replica load is proportional to rows scanned, not rows changed; bounded by range size, intervals, a
  rows-per-second limit and `max_statement_time`. To be measured on the replica before go-live.
- Change latency is the range's scan interval (seconds for hot/tail ranges, up to the cold interval for quiet ones).
- Intermediate states between two scans are not seen; events carry no before-image payload.
- Only mapped columns are hashed and copied (data minimisation); the mirror and `cdc` tables contain PHI and
  stay in the hospital's PostgreSQL. Logs carry no keys or values.
- The broker decision is decoupled: the outbox can be relayed later without changing capture.
