# PRD — cdc-polling

- **Status:** Draft  _(Stub → Draft → Approved)_
- **Based on draft:** product owner's request in the project thread, 2026-10-30 (no `docs/prd/` draft yet;
  a draft there would supersede this header)
- **Last updated:** 2026-10-30
- **Owner:** Product owner (user)

> Until this PRD is Approved, Claude may scaffold and run spikes but asks before building features.
> The first cut in `source/hms_services/cdc-polling/` was built on the product owner's explicit request.

## 1. Problem & goals

The new platform needs Khanza's data and its changes, but Khanza (MariaDB 10.6.26) must stay untouched
and its tables have no `updated_at` column. Goal: a change-capture service that uses **query polling**
(ADR-0001) with **hash-based reconciliation** over **primary-key range partitions** and **incremental scan
checkpoints** to keep a PostgreSQL 18 copy of selected Khanza tables and a log of their changes.

## 2. Users & roles

- Downstream services and teams that need Khanza data: `event-streaming` (relays change events),
  `domain-services`, `web-datatooling`.
- Operators / DBA: run, monitor and tune the service; own the replica and the read-only user.
- Developers: add and change table mappings.

## 3. Scope (in / out)

In:
- Python backend in `source/hms_services/cdc-polling/` (request: "hms_service for the full backend logic").
- PostgreSQL 18 DDL in `source/hms_database/cdc-polling/` (request: "hms_database for initialize DDL or SQL").
- Pluggable per-table query/mapping layer, separate from the core engine, plus a skill for managing it.
- Development on Windows, production on Ubuntu 22.04.

Out:
- Publishing to a message broker and translating to domain events (`event-streaming`, broker undecided).
- Any write to Khanza, now or as a dependency.
- Tables without a primary key (see open questions).

## 4. Functional requirements

| # | Requirement (from the request) |
|---|---|
| F1 | Source: Khanza MariaDB 10.6.26; target: PostgreSQL 18. |
| F2 | Change detection by hash-based reconciliation, because Khanza tables have no `updated_at`. Must detect inserts, updates and deletes. |
| F3 | Design decision 1: **fixed-size primary-key ranges**. |
| F4 | Design decision 2: **keyset pagination inside each partition**. |
| F5 | Design decision 3: **independent scan checkpoints** (per range), so scanning can resume after interruption. |
| F6 | Design decision 4: **MariaDB must remain untouched.** |
| F7 | Target queries and table mappings are managed separately from the core business logic. |
| F8 | Connection settings and credentials are kept in an environment file, not in code. |

Derived (needed to meet the above; listed so the product owner can confirm):
- D1 Composite and varchar primary keys must be supported (986 of 1 240 Khanza tables).
- D2 Each range is applied atomically; change events carry a deterministic id for consumer dedupe.
- D3 Deletes in Khanza become soft deletes in the mirror.
- D4 Only mapped columns are copied and hashed (data minimisation, root rule 2).

## 5. Non-functional requirements (security, performance, availability, audit)

- Security: SELECT-only source user on a replica; refuse to run with write privileges; TLS optional;
  secrets in `.env` / environment only.
- PHI: no keys or values in logs; synthetic test data only; PHI columns marked in DDL and mappings.
- Performance: every scan re-reads the range on the replica (inherent to hash comparison). Load is bounded
  by range size, adaptive re-scan intervals, a rows-per-second limit, a statement time limit, and an
  optional replica-lag guard. Target numbers: to be set after the replica spike.
- Availability: crash-safe per range; continuous mode retries with back-off.
- Audit: replication by a system account is not a user reading a medical record — confirm (open question 4).
- Portability: Python 3.10+, no shell-specific scripts.

## 6. Data & integrations

- Source tables in the first cut: `pasien`, `reg_periksa`, `diagnosa_pasien` (examples covering a varchar key,
  a date-ordered varchar key with a hot tail, and a composite key with an ENUM part).
- Target schemas: `cdc` (control) and `khanza_mirror` (data). Mapping: `source/hms_database/cdc-polling/MAPPING.md`.
- Downstream contract: `cdc.change_event` (op c/u/d/r, key, before/after hash, pass number). Will be
  formalised as an event schema in `source/hms_shared/events/` together with the event-streaming relay.

## 7. Acceptance criteria

1. Inserts, updates (incl. a value set to NULL) and deletes in the source appear in the mirror and as
   change events after the next scan of the affected range. *(integration test)*
2. A pass with no source changes produces no events and answers each range with one digest query. *(test)*
3. A range that grows beyond twice its size is split; checkpoints stay exact afterwards. *(test)*
4. Killing the service mid-pass loses nothing and duplicates nothing. *(test)*
5. The service refuses a source user with write privileges, and the source session is read-only. *(test)*
6. Composite and ENUM-containing keys paginate correctly; the keyset query uses an index range scan. *(test)*
7. A table is added with a mapping file + migration only, no engine code change. *(skill + tests)*
8. Runs on Windows (dev) and Ubuntu 22.04 (prod); credentials only in `.env`.

## 8. Milestones

1. First cut with three tables and tests (done, 2026-10-30).
2. Spike on the real replica: measure throughput and load; set range sizes, intervals and limits.
3. Approve PRD, ADR-0005 and ADR-0006; choose the table list and per-table latency targets.
4. Relay `cdc.change_event` to the broker (`event-streaming`).

## 9. Open questions

1. Approve this PRD, ADR-0005 (detection method) and ADR-0006 (Python stack).
2. DBA: replica host, read-only user, acceptable statement time and rows/second.
3. Which tables next, and the acceptable change latency for each (drives `hot`/`cold` intervals).
4. Does replication into the mirror need audit events, or only user-facing reads of it (Permenkes 24/2022)?
5. Retention for `cdc.change_event` and for soft-deleted mirror rows.
6. Tables without a primary key (151): skip, or add a whole-table multiset-hash mode for small ones?
7. Migration tool for `hms_database` (still undecided).
8. Encrypt NIK / BPJS number in the mirror at rest?

## Change log

- 2026-10-30 — Draft written from the product owner's request in the project thread; first cut implemented.
