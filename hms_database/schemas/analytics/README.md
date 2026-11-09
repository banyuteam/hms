# Schema `analytics`

- Migration: `0020_analytics.sql` (ADR-DB-004)
- Readers: reporting (`hms_report_read`), views only
- Classification: confidential (pseudonymized; not anonymized)

This schema holds pseudonymized clinical facts. The views run with the owner's rights, so reporting reads them
without any access to identifiable tables.

- `patient_pseudonyms`, `encounter_pseudonyms`: a random UUID per patient/encounter, assigned by trigger on insert.
  These are the re-identification keys and are readable by the owner only.
- `encounter_facts`: encounter key, patient key, facility, class, type, status, local start date, length of stay
  (hours), age at start (years), administrative gender and discharge disposition.
- `diagnosis_facts`: coded encounter diagnoses with role and rank (refuted and entered-in-error excluded).
- `observation_facts`: final/amended/corrected observations with numeric or coded value, unit and local date.

No names, identifiers, contact data, addresses, free text or internal ids. A governance test fails if a view gains
an identifying column. Reporting must suppress small cells (e.g. counts below 5) and review outputs before release:
pseudonymized data is still personal data under UU 27/2022.
