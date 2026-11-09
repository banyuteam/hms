# Schema `patient`

- Migration: `0010_patient.sql` (ADR-DB-004, ADR-DB-005); `consents.encounter_id` added by 0011
- Writer: `hms_services` patient module (`hms_patient_rw`)
- Readers: `hms_services` only
- Classification: restricted (specific personal data, UU 27/2022 Pasal 4)

This is the master patient index and consent of one organization (the tenant). It is native HMS data: Khanza
`pasien` rows are linked through `integration.legacy_record_links`, never mirrored.

## Tables (versioned records, tenant row-level security, no deletes)
- `patients`:
  - FHIR `administrative_gender` (for exchange) and the national `gender_code` (Kepmenkes 1423 jenis kelamin);
  - birth date (with an `estimated` flag), birth place and deceased status;
  - coded marital status, religion, education and occupation, with free text for "lain-lain";
  - nationality (ISO 3166) and preferred language (BCP 47).
- `identifiers`: one row per identifier.
  - Format, placeholder and uniqueness rules come from `terminology.identifier_systems`.
  - A unique system (NIK) identifies one *active* patient per organization; NIK ibu may be shared by siblings.
  - System and value never change: to correct one, deactivate it and add a new row. `verified_at` and
    `verification_source` record registry checks (e.g. `satusehat`).
- `names`: `text` is the full name as written; parts are optional.
- `telecoms`, `addresses`: addresses carry the Kemendagri province/city/district/village codes and RT/RW, matching
  the SATUSEHAT `administrativeCode` extension.
- `contacts`: related persons (guarantor, next of kin, the mother of a newborn).
- `links`: duplicate resolution. The duplicate is set `active = false` and linked `replaced-by` the survivor.
  Clinical rows keep their original `patient_id`; readers follow links.
- `consents`: FHIR Consent decisions (scope, category, provision, period, grantor), optionally for one encounter
  (general consent). The signed form lives in object storage (`source_document_ref` + SHA-256). Changing an
  active/rejected/inactive consent needs `hms.change_reason`.

Parts (`identifiers`, `names`, ...) bump the patient's version, so `patient.patients.version` changes whenever any
part changes. A registration done in one transaction is version 1.

## Usage
Every transaction sets the context (ADR-DB-005):
```sql
SELECT set_config('hms.organization_id', $org, true), set_config('hms.actor_user_id', $user, true);
```
Search by name prefix uses `idx_names_search` (`lower(text) LIKE lower($q) || '%'`). Search by identifier uses
`idx_identifiers_lookup`. Measure before adding trigram indexes.

## Not decided yet
- Column encryption of identifiers and contact data.
- The IHS-number URI.
- The merge workflow beyond links.
