# web-datatooling — Instructions

Web tooling for backend developers, DBAs and data engineers (part of `hms_web-frontend-UIUX`; the
browser workspace for clinical staff is `../web-workspace/`). Replaces the former `data-warehouse` project. Read the root `CLAUDE.md` and `design/hms_web-frontend-UIUX/web-datatooling/PRD.md` first (plans, PRD and skills live in `design/hms_web-frontend-UIUX/web-datatooling/`; this folder is the code).

## Scope

- Web UI for: report management, an ETL tool, and developer documentation (API / event / schema docs).
- Warehouse pipeline behind the ETL tool (so reporting no longer hits the operational Khanza database):

- Ingest raw (`khanza.<table>`) and domain events from `source/hms_services/event-streaming/` into a staging layer.
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
