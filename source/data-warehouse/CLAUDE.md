# data-warehouse — Instructions

Builds the hospital data warehouse from the event streams so reporting no longer hits the
operational Khanza database. Read the root `CLAUDE.md` and `design/data-warehouse/PRD.md` first (plans, PRD and skills live in `design/data-warehouse/`; this folder is the code).

## Scope

- Ingest raw (`khanza.<table>`) and domain events from `source/event-streaming/` into a staging layer.
- Layers: `staging` (as-received, append-only, with source position) → `core` (cleaned,
  conformed dimensions and facts) → `marts` (subject areas: patient visits, inpatient
  occupancy, revenue & billing, BPJS claims, pharmacy, lab/radiology).
- Data quality checks, lineage documentation, historical backfill from CDC snapshots.

Out of scope: operational APIs (those belong to services); writing back to any source.

## Rules

- Warehouse engine and transformation tool are pending an ADR — ask before choosing.
  Transformations must be SQL-first, version-controlled, and testable.
- Never query the Khanza primary. Backfills come from CDC snapshots or a read-only replica.
- Keep history: use slowly changing dimensions (type 2) for patient, doctor, room/ward,
  tariff and insurer data; facts reference the version valid at event time.
- PHI: marts for general reporting use pseudonymised patient keys. Direct identifiers (NIK,
  name, BPJS number, address) stay in a restricted `core` area with separate access.
- Every model has: owner, grain, description, primary-key uniqueness and not-null tests.
- Money as integer Rupiah; dates as UTC with an Asia/Jakarta date column for reporting.
- Reconcile key metrics (daily visits, admissions, billing totals) against Khanza reports
  and document any differences.
