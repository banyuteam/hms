# Schema `platform`

- Migrations: `0001_platform_foundation.sql`; `0008_platform_locations.sql` (locations)
- Writer: `hms_services` platform module (`hms_platform_rw`: SELECT, INSERT, UPDATE; no DELETE)
- Readers: `hms_services`; reporting (`hms_report_read`: SELECT)
- Classification: internal (no PHI)

## Tables
- `organizations`: tenant boundary. `id` is what other schemas store as `tenant_id` / `organization_id`.
  `code` is a stable upper-case business code. `status` `active|inactive`; rows are deactivated, never deleted.
- `facilities`: care site of an organization; unit of facility-scoped authorization. `timezone` is an IANA name
  (e.g. `Asia/Jakarta`) used to render instants and interpret local clinical dates and times.

- `locations` (0008): physical places of a facility (FHIR Location): building, ward, room, bed, clinic room.
  - `physical_type` is the HL7 location-physical-type code.
  - `parent_id` must be a location of the same facility.
  - `code` is unique per facility.
  - `status` is `active|suspended|inactive`; locations are deactivated, never deleted.
  - Used by encounters, practitioner roles, procedures and imaging.

`updated_at` is maintained by `hms_meta.touch_updated_at()` (transaction time).

## Not decided yet
Departments (FHIR Organization sub-units), external identifiers (e.g. SATUSEHAT organization ids) and the relationship to
legacy codes. Add them with the owning domain team; do not infer from the legacy schema.
