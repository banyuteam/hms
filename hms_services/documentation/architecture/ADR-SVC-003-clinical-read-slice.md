# ADR-SVC-003: First clinical vertical slice — patient and encounter read

- Status: Proposed (owner decisions 2026-11-08 recorded in Decision 1–4)
- Date: 2026-11-08
- Owners: hms_services
- Affected projects: hms_services (owner), hms_workspace/web (consumer), hms_database (audit trail, iam permissions)
- Related contracts: `contracts/api/clinical-read-v1.openapi.yaml`; standards/security/legacy-read-only-policy.md

## Context
The web EMR windows were built against the previous implementation's generic Khanza table API (raw column names, a large
"journey" document). v4 needs patient and encounter reads that are authorized, audited and expressed in HMS terms,
without waiting for canonical persistence.

## Decision
1. **Read-through (owner).** hms-services reads Khanza read-only on each request (fixed, parameterised SELECT statements
   on `pasien` and `reg_periksa`, read-only session, statement timeout). No patient data is stored in PostgreSQL.
2. **HMS API shape (owner).** Versioned contract with HMS field names. Legacy values without agreed canonical semantics
   are labelled as such (`status.system = legacy-hms:reg_periksa.stts`, `payer_code`). Until canonical persistence
   exists, the resource identifiers are the hospital's business identifiers: the medical record number (MRN) and the
   encounter number (`no_rawat`, URL-encoded because it contains `/`). Times recorded in hospital local time are returned
   with the facility's UTC offset.
3. **Access rule (owner).** `patient.read` / `encounter.read` at the session facility allow reading any patient of the
   facility. Narrower care-relationship rules are a later decision.
4. **Sensitive identifiers (owner).** NIK, phone, email, address lines, BPJS membership number and the responsible
   person's address are returned masked only; `GET /patients/{mrn}/identifiers/{kind}` returns one value and needs
   `patient.identifiers.reveal`.
5. **Audit.** Every request writes an audit event (`patient.search`, `patient.read`, `patient.identifier.reveal`,
   `encounter.list`, `encounter.read`, `encounter.search`) with the resource identifier and never a value or search text.
   If the event cannot be written, the data is not returned (503).
6. Search keeps the previous implementation's measured rules: patients by name or MRN (2–64 characters, at most 5 words, each
   word contained in the name or MRN; measured 1–18 ms on 56,786 rows), encounters by the start of the encounter number
   (3–17 characters, primary-key prefix).

## Alternatives considered
1. Copy into PostgreSQL via polling first: the long-term path; weeks before anything is visible, a second PHI copy.
2. Re-implement the old endpoints: ties the v4 API to Khanza's table layout.
3. Send full identifiers and mask in the browser: every full NIK in browser memory whenever a profile is open.

## Consequences
- Positive: real patient data in the existing windows with authorization, audit and minimal PHI in the browser.
- Negative: every read depends on Khanza availability and load; identifiers are legacy business keys (a later
  canonical model must map them); the encounter journey (clinical timeline) is not in this slice.
- Security/privacy: broad read within the facility (Decision 3) is compensated only by audit; review with clinical
  governance before production.

## Acceptance criteria
- [x] Contract, statements allowlist, mapping and masking tests; HTTP tests for permissions, audit and fail-closed.
- [ ] `check-clinical-read` against the dev Khanza (counts only) by the owner.
- [ ] Owner review of the access rule with clinical governance before production.

**Amendment 2026-11-09:** references to the previous implementation outside this workspace removed; decisions unchanged.

**Amendment 2026-11-09 (payer history):** clinical-read-v1 1.1.0 adds `GET /patients/{mrn}/payers` (`encounter.read`,
audit action `patient.payers.read` with counts only). It reads the patient's `reg_periksa` rows with their payer name
through one fixed `LEFT JOIN penjab` (the only join in this slice; SELECT-only, listed in `Statements()`), at most 500
visits, latest registration first, and groups them by payer code. Requested by the Patient Profile guarantor section
(hms_workspace contract request 09, P-2). Additive; no decision above changes.
