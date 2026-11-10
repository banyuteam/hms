# Schema `imaging`

- Migration: `0017_imaging.sql` (ADR-DB-004)
- Writer: `hms_services` imaging integration (`hms_clinical_rw`)
- Readers: `hms_services`
- Classification: restricted (health data)

These are references to DICOM studies held in PACS. Pixel data, instances and their metadata stay in PACS, and
hms_services retrieves them via DICOMweb (QIDO-RS search, WADO-RS retrieve) using the PACS registered in
`integration.external_systems` (`pacs`). Endpoints and credentials are deployment configuration.

## Tables (versioned records, tenant row-level security)
- `studies`:
  - Study Instance UID, unique per organization (DICOM UID format, at most 64 characters, no leading zeros);
  - accession number, status (FHIR ImagingStudy) and modalities (DICOM codes);
  - counts, referrer and location;
  - optional encounter and procedure of the same patient.
- `series`: Series Instance UID, modality, number, body site, laterality (R/L/B/U) and instance count.

A radiology report is `clinical.diagnostic_reports` with `imaging_study_id` (same patient). For FHIR exchange the study
UID becomes `identifier.system = urn:dicom:uid`, `value = urn:oid:<uid>`.

**Layer separation (0021, ADR-ROOT-002):** every record table here has `record_origin` (`native` | `legacy`) and a
layer guard. A table belongs to a record domain (`integration.record_domain_tables`); the domain's authority for the
organization decides whether the native runtime or the legacy bridge may write it (SQLSTATE `HM001` otherwise).
