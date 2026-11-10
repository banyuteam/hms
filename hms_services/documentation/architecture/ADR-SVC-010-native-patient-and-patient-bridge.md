# ADR-SVC-010: First slice of the two write layers — native patient registration and the patient bridge

- Status: Proposed (2026-11-10)
- Date: 2026-11-10
- Owners: hms_services
- Affected projects: hms_services (owner); hms_database (migration 0021, consumed); deployment (bridge worker);
  hms_workspace (future consumer of patient-records-v1)
- Related: ADR-ROOT-002, ADR-DB-006, ADR-SVC-003 (legacy read-through, unchanged); contract
  `contracts/api/patient-records-v1.openapi.yaml`

## Context
ADR-ROOT-002 separates a native transaction layer and a legacy bridge that write one canonical record. Root
`CLAUDE.md` §12 asks for a vertical slice before broad abstractions. Patients come first: every other domain refers
to them, and the legacy read slice (ADR-SVC-003) already established which `pasien` columns mean what.

## Decision
1. **Packages and boundaries** (enforced by `core/archtest`):
   - `canonical/recordtx`: transaction context (organization, one actor, request id, reason), refusal
     classification (HM001 → not authoritative, 23505 → conflict, check/FK/format → invalid), domain authority
     lookup, and the start-up role check (`CheckLayerRole`).
   - `canonical/patient`: the canonical Patient store (create, replace with history, get). No business rules.
   - `native/patient`: registration rules, IAM permission `patient.register`, audit, HTTP. Never imports the legacy
     adapter, the bridge or the read-through slices.
   - `legacybridge/patientsync`: mapping `legacy-hms.pasien/1`, row hash, scan/lease/checkpoint/run, crosswalk and
     issues. Never reaches, even transitively, the native layer, IAM or HTTP slices.
   - `integrations/legacyhms`: gains one fixed SELECT (`PatientScan`, primary-key range, bounded), listed in
     `Statements()`.
2. **Native API (patient-records-v1):** `POST /api/v1/patient-records` (patient.register) and
   `GET /api/v1/patient-records/{id}` (patient.read). Registration is refused with 409 `domain_not_native` until the
   organization's patient domain is native. A client-generated id makes retries return the existing record. NIK,
   passport and family card are masked except the last 4 characters; the MRN is shown. Creation is audited in the
   same transaction; a read is audited before it is returned.
3. **Bridge worker:** `hms-services legacy-bridge [-once]`, configuration `config.LoadBridge` (database login
   default `hms_meta_legacy_bridge`, SELECT-only legacy account, `BRIDGE_BATCH_SIZE` 500, `BRIDGE_BATCH_PAUSE_MS`
   1000, `BRIDGE_INTERVAL_SECONDS` 300). Per batch: lease with fence → read checkpoint → scan → map and write each
   row in its own transaction → advance the checkpoint only while the lease is held → close the run.
4. **Mapping v1** (`pasien`): `no_rkm_medis` → MRN identifier (invalid → rejected); `nm_pasien` → official name
   (missing → rejected); `jk` L/P → male/female, empty or "-" → unknown, other → unknown and partial issue;
   `tgl_lahir` real date 1900..today ("0000-00-00" = not recorded), else partial; `tmp_lahir` → birth place;
   `no_ktp` 16 digits → NIK, `9999999999999999` = no NIK, other → partial; a NIK already another patient's →
   dropped with `duplicate_nik`. Unmapped columns are listed in `mapping.go` and wait for terminology maps or their
   canonical tables.
5. **Change detection:** keyset scan by primary key with a full pass, row hash on the crosswalk; no update timestamp
   is assumed. Deleted Khanza rows are not detected (open decision in ADR-ROOT-002).

## Alternatives considered
1. Bridge through the native commands: native rules (no MRN from clients, required fields) do not fit legacy data,
   and the bridge would need IAM identities. The shared canonical store is the meeting point instead.
2. Polling by `tgl_daftar`: registration date, not an update time; edits to old rows would be missed.
3. One transaction per batch: one bad row would roll back the batch. Per-row transactions isolate failures; the
   checkpoint moves once per batch, so a crash re-reads at most one batch (idempotent by hash).

## Consequences
- Load on Khanza: one primary-key range query per batch (500 rows by default), paused 1 s between batches, full pass
  then 5 minutes idle. About 57k patients (measured, ADR-SVC-003) ≈ 114 batches per pass.
- The serve process refuses to start as the bridge login and the bridge refuses the runtime login.
- New permission `patient.register`, registered at start-up; no role holds it until an administrator grants it.

## Acceptance criteria
- [x] Unit: mapping rules and hash, registration rules, masking, statement allowlist, layer boundaries.
- [x] PostgreSQL integration (CI): `TestPGBridgeMapsLegacyPatientsUntilCutover`, `TestPGNativeRegistration`.
- [ ] Owner review of mapping v1 with the medical-records unit.
- [ ] `legacy-bridge -once` against a development Khanza copy, counts reported.
- [ ] Workspace screen for registration and for bridge issues (separate contract requests).
