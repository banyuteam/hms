# Build plan — cdc-polling (Khanza MariaDB → PostgreSQL 18)

- **Status:** Draft — implemented as a first cut, awaiting product-owner review
- **Based on:** product owner's request in the project thread, 2026-10-30 (no `docs/prd/` draft yet)
- **Related:** [`PRD.md`](PRD.md) · ADR-0001 (query polling) · ADR-0004 (PostgreSQL 18) ·
  ADR-0005 (hash-based PK-range reconciliation) · ADR-0006 (Python stack) — all *proposed*
- **Code:** [`source/hms_services/cdc-polling/`](../../../source/hms_services/cdc-polling/) (engine) and
  [`source/hms_database/cdc-polling/`](../../../source/hms_database/cdc-polling/) (PostgreSQL DDL)

## 1. What we are building

A Python service that keeps a **mirror of allowlisted Khanza tables in PostgreSQL 18** and records
every detected insert, update and delete as a **change event** row, without writing anything to
Khanza. Khanza tables have no `updated_at`, so we cannot ask "what changed since X". Instead we
compare *hashes* of the source and the mirror, range by range, and only read rows in ranges whose
hash differs.

```
Khanza MariaDB 10.6.26 (read-only replica, SELECT-only user)
   │  1. range digest      SELECT COUNT(*), BIT_XOR(md5-prefix)  … WHERE key in range      (1 row back)
   │  2. key+hash pages    SELECT key, MD5(row) … WHERE key in range AND key > :last LIMIT n (keyset)
   │  3. changed rows      SELECT cols, MD5(row) … WHERE key IN (changed keys)
   ▼
cdc-polling (Python)  ── diff (insert / update / delete) per range ──┐
   ▼                                                                  │ one PostgreSQL transaction per range
PostgreSQL 18:  khanza_mirror.<table>   (typed mirror, soft deletes)  │
                cdc.row_state           (key → source row hash, range id)
                cdc.range_checkpoint    (one independent checkpoint per range)
                cdc.change_event        (c / u / d / r rows; outbox for event-streaming)
                cdc.table_state, cdc.scan_run (status & metrics)
```

`cdc.change_event` is deliberately an outbox: `event-streaming` (broker still undecided) can later
relay it to `khanza.<table>` topics and translate to domain events, so the broker decision does not
block this work.

## 2. The four design decisions (hard constraints)

| # | Decision | How it is implemented |
|---|---|---|
| 1 | **Fixed-size primary-key ranges** | Each table's key space is cut into contiguous ranges `[lower, upper)`. Two strategies: `int_range` (single integer key; boundaries at multiples of `range.size`) and `keyset` (any key, incl. varchar and composite; a boundary every `range.size` rows in the source's own key order). The first range is open below, the last ("tail") range open above, so every possible key belongs to exactly one range. A range that grows past `2 × size` is split at the keys the scan just read. |
| 2 | **Keyset pagination inside each partition** | Inside a range, keys are read with `WHERE key > :last_key ORDER BY key LIMIT page_size` — never `OFFSET` paging over data. Composite keys use an expanded lexicographic predicate (`a > ? OR (a = ? AND b > ?) …`) that MariaDB can turn into an index range scan. |
| 3 | **Independent scan checkpoints** | One `cdc.range_checkpoint` row per range: digest, row count, last scanned, next due, unchanged streak. Each range commits its mirror changes, row hashes, change events and checkpoint in **one PostgreSQL transaction**. A crash loses at most the range in flight; restart continues with whatever is due. Ranges are scheduled independently (hot ranges often, cold ranges rarely). |
| 4 | **MariaDB stays untouched; no `updated_at`** | Only `SELECT`, `SHOW`, `SET SESSION …` and read-only transactions are ever sent (enforced in code by a statement allowlist). The session is `READ ONLY`. At start-up the service checks `SHOW GRANTS` and refuses to run if the user can write. All hashing is done with `SELECT` expressions; nothing is stored on the source. |

## 3. Change detection, step by step

For each due range of a table:

1. **Level 1 — digest (cheap on the wire, not on the replica).**
   `SELECT COUNT(*), BIT_XOR(CAST(CONV(LEFT(MD5(row_expr),16),16,10) AS UNSIGNED)) FROM t WHERE <range>`.
   `row_expr` concatenates the *mapped* columns with a field separator and an explicit NULL marker
   (`CONCAT_WS(CHAR(31), COALESCE(CAST(col AS CHAR), CHAR(30)), …)`). If `(count, digest)` equals the
   checkpoint, the range is unchanged: update `last_scanned_at` / `next_due_at` and move on.
2. **Level 2 — key + hash, keyset-paginated.** In a `START TRANSACTION READ ONLY` snapshot, page
   through `(key, MD5(row_expr))` for the range. Compare with `cdc.row_state` for that range id:
   - key in source, not in mirror → **insert** (`c`; `r` on the very first scan of a range),
   - key in both, hash differs → **update** (`u`),
   - key in mirror, not in source → **delete** (`d`).
3. **Level 3 — fetch changed rows** (same snapshot) by key, in batches, and apply.
4. **Apply** in one PostgreSQL transaction: upsert / soft-delete the mirror, upsert / delete
   `cdc.row_state`, insert `cdc.change_event` rows, update the checkpoint with the digest computed
   from the level-2 hashes, split the range if it outgrew `2 × size`.

**Hashes are always computed by MariaDB** and stored as opaque strings in PostgreSQL. PostgreSQL never
recomputes them, so latin1 vs UTF-8, `double` formatting, enum and date rendering cannot cause false
"changes". The Python digest (XOR of the first 16 hex digits of each MD5) is bit-identical to the
MariaDB one. Only mapped columns are hashed: a change in a column we don't copy (data minimisation) is
intentionally not an event.

The mirror's key order is never used to bound a range: `cdc.row_state.range_id` records which range a
key belongs to, so MariaDB's `latin1_swedish_ci` ordering (case-insensitive, trailing-space padding)
and PostgreSQL's collation never have to agree.

## 4. Cost — be explicit

- **Every scan of a range re-reads every row in it on the replica**, even when nothing changed. Level 1
  only saves network and PostgreSQL work, not replica I/O/CPU. A full sweep of a table costs roughly
  one clustered-index scan of that table plus an MD5 per row.
- Polling **coalesces** changes: if a row changes twice between two scans of its range, only the final
  state is seen (one `u`). There is no "before image" payload; consumers read the mirror.
- **Latency** for a change is the range's current scan interval: `hot_interval_s` for hot and tail
  ranges, up to `cold_interval_s` for ranges that have been quiet for a while.

Mitigations, all configurable per table in its mapping file:

| Mitigation | Setting | Effect |
|---|---|---|
| Range size | `range.size` | Bigger ranges → fewer queries but more rows re-read per detected change. Start at 2 000–5 000 rows. |
| Page size | `range.page_size` | Rows per keyset page in level 2 (memory/latency trade-off). |
| Adaptive re-scan | `scan.hot_interval_s`, `scan.cold_interval_s` | A range that changed is re-scanned at the hot interval; each unchanged scan doubles its interval up to the cold interval. The tail range (where new `no_rawat`/ids land) is always hot. Every range is still swept at least once per `cold_interval_s`. |
| Throttling | `CDC_MAX_SOURCE_ROWS_PER_SECOND`, `CDC_THROTTLE_SLEEP_MS`, `CDC_MAX_RANGES_PER_PASS` | Token bucket on rows read from the replica, sleep between ranges, cap per pass. |
| Statement timeout | `CDC_SOURCE_MAX_STATEMENT_TIME_S` | `SET SESSION max_statement_time` so a runaway scan is killed by the server. |
| Replica only | `CDC_SOURCE_HOST` = replica | Never the primary (root rule 1). Optional replica-lag guard (`CDC_MAX_REPLICA_LAG_S`) pauses scanning when the replica falls behind. |
| Off-peak bootstrap | `cdc-polling run --table … --once` | The first scan of a table is a full snapshot; run it in a quiet window. |

Measured on synthetic data in local containers (4 cores, 300 000 `reg_periksa` rows, 60 ranges of 5 000):
a full sweep with nothing changed took 1.4 s (≈ 215 000 rows/s at level 1), a sweep with 170 changes in
3 ranges 1.8 s, and the bootstrap snapshot 48 s. These are indicative only; the real replica's throughput
and CPU at the chosen limits must be measured in the spike (step 7).

## 5. Keys: integer, varchar, composite, none

Measured on the schema snapshot (`docs/references/khanza-schema/rsb221022021.sql`, 1 240 tables):

| Key shape | Tables | Strategy |
|---|---:|---|
| single varchar / char (e.g. `pasien.no_rkm_medis`, `reg_periksa.no_rawat`) | 540 | `keyset` |
| composite (e.g. `diagnosa_pasien (no_rawat, kd_penyakit, status)`) | 446 | `keyset` |
| single integer | 89 | `int_range` (or `keyset`) |
| single double / enum / date / datetime | 14 | `keyset` |
| **no primary key** | 151 (1 with a unique index) | **not supported in v1** — validator rejects; see open questions |

`keyset` boundaries are taken in MariaDB's own order (`ORDER BY key LIMIT 1 OFFSET size` from the
previous boundary), so they are correct under `latin1_swedish_ci`. Most keyless tables are display
queues (`antri*`); a later "whole-table multiset hash" mode can cover small ones.

## 6. Pluggable query / mapping layer

The engine has no table-specific code. Each table is one YAML file in
`source/hms_services/cdc-polling/mappings/<table>.yaml`: key columns and strategy, range and page
size, scan intervals, mapped columns (type, PHI flag, named transform), target table, and optional
hand-written target SQL (`target.upsert_sql_file`) for cases the generator can't express. The engine
derives every source and target statement from the mapping; a mapping fingerprint is stored in
`cdc.table_state` and the engine refuses to run when a mapping changed without an explicit `resync`.

The mirror table's DDL lives in `source/hms_database/cdc-polling/migrations/` (one migration per
table). A Claude Code skill, `cdc-table-mapping`, documents adding or changing a table.

## 7. Safety and PHI

- Source user: `SELECT` on allowlisted tables only (DBA creates it — see
  `source/hms_services/cdc-polling/docs/source-db-prerequisites.md`). The code does not run grants.
- Credentials only from environment / `.env` (git-ignored); `.env.example` has placeholders.
- Logs are JSON, contain counts, table names and range ids only. Keys and values are never logged; a
  log filter additionally masks NIK-, BPJS- and phone-shaped numbers as a second line of defence.
- The mirror holds PHI inside the hospital's PostgreSQL; PHI columns are marked in DDL comments and
  in the mapping (`phi: true`). Tests and fixtures use synthetic rows only.
- Mirror reads/writes by this service are system replication, not a user reading a medical record;
  the audit requirement applies to services that serve records to users (open question 4).

## 8. Platform

Development on Windows, production on Ubuntu 22.04: pure-Python drivers (PyMySQL) plus psycopg 3
binary wheels, `pathlib` everywhere, no shell scripts — every task is a `cdc-polling` subcommand or a
`python -m …` call. Python **3.10+** so the stock Ubuntu 22.04 interpreter works. A
`docker-compose.dev.yml` starts a synthetic MariaDB 10.6.26 and PostgreSQL 18 for local work; for
production, a systemd unit example is provided (Windows dev runs the same CLI in a terminal).

## 9. Work breakdown

| Step | Deliverable | Status |
|---|---|---|
| 1 | Build plan, PRD (draft), ADR-0005 and ADR-0006 (proposed) | done |
| 2 | `hms_database/cdc-polling`: control schema `cdc`, mirror schema, three mirror tables, grants template | done |
| 3 | Engine: config, mapping loader/validator, SQL generator, read-only source adapter, target adapter, range planner, diff, scheduler/throttle, CLI | done |
| 4 | Mappings: `pasien` (varchar key), `reg_periksa` (varchar key, hot tail), `diagnosa_pasien` (composite key) | done |
| 5 | Tests: unit (SQL generation, diff, ranges, digests, masking, mapping validation) + integration on MariaDB 10.6.26 and PostgreSQL 18 with synthetic data covering insert, update, delete, split, crash/restart | done |
| 6 | `cdc-table-mapping` skill | done |
| 7 | Spike on the real replica: measure level-1 throughput, pick range sizes and limits | **next — needs DBA** |
| 8 | Relay `cdc.change_event` → broker topics (`event-streaming`) | after broker ADR |

## 10. Open questions (also in the PRD)

1. Approve ADR-0005 / ADR-0006 and this PRD (until then this is a spike-grade first cut).
2. DBA: read-only user on the replica, `max_statement_time` limits, and whether we may read replica lag.
3. Which tables, in what order, beyond the three examples? What latency is acceptable per table?
4. Retention of `cdc.change_event` and of soft-deleted mirror rows.
5. Keyless tables: skip, or add a whole-table multiset-hash mode for small ones?
6. Migration tool for `hms_database` is still undecided; the SQL files are plain, ordered and
   tool-agnostic.
