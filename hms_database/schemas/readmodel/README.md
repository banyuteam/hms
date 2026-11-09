# Schema `readmodel`

- Migration: `0018_readmodel.sql` (ADR-DB-004)
- Writer: `hms_services` projection consumers (`hms_readmodel_rw`), fed by `eventing.outbox_events`
- Readers: `hms_services` query endpoints
- Classification: restricted (derived health data)

This is the Clinical Read Model for the longitudinal patient record. It is derived and rebuildable, not a source of
truth.

## Tables
- `clinical_timeline`: one row per clinical resource (its latest version) with patient, encounter, facility, time,
  status, code and a short `summary` built from coded values. Free-text notes are not copied. Consumers are
  idempotent:
  ```sql
  INSERT INTO readmodel.clinical_timeline AS t (...) VALUES (...)
  ON CONFLICT (resource_type, resource_id) DO UPDATE SET ...
  WHERE t.resource_version < EXCLUDED.resource_version;
  ```
- `patient_summaries`: chart banner per patient (name, gender, birth date, counts, last encounter).
- `projection_checkpoints`: status and progress per projection; `rebuilding` while a rebuild runs.

Rows are tenant-scoped (row-level security) and may be deleted for a rebuild.
