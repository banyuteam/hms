# Schema `privacy`

- Migration: `0019_privacy_and_audit_anchoring.sql` (ADR-DB-004)
- Writer: `hms_services` privacy module (`hms_privacy_rw`)
- Readers: `hms_services`; DPO/audit reviewers (`hms_audit_read`)
- Classification: restricted (`disclosures`, `data_subject_requests`); internal (`processing_activities`)
- Basis: UU 27/2022 and Permenkes 24/2022 Pasal 33-37 (`standards/healthcare/clinical-data-standards.md`)

## Tables
- `processing_activities`: the processing register, covering:
  - purpose and legal basis;
  - data categories and whether specific (health) data is included;
  - recipients, retention rule, DPIA reference and owner.

  An active activity with specific data must cite a DPIA. It is maintained by the DPO through a reviewed change, and
  the runtime cannot write it.
- `disclosures`: append-only accounting of disclosures of a patient's data outside HMS. Each row records:
  - the recipient system or description;
  - the resource version or scope;
  - whether the data was de-identified;
  - the actor, and the submission id for SATUSEHAT.
- `data_subject_requests`: access, rectification, erasure, restriction, objection, portability and consent
  withdrawal.
  - Each request records its due date and identity check.
  - A decision needs a reason. Decided requests change only with `hms.change_reason`. The request is versioned
    (`privacy.resource_versions`).
  - An erasure inside the medical-record retention period is refused with its legal basis (Permenkes 24/2022
    Pasal 39); records are not deleted.
