# Schema `platform`

- Migration: `0001_platform_foundation.sql`
- Writer: `hms_services` platform module (`hms_platform_rw`: SELECT, INSERT, UPDATE; no DELETE)
- Readers: `hms_services`; reporting (`hms_report_read`: SELECT)
- Classification: internal (no PHI)

## Tables
- `organizations`: tenant boundary. `id` is what other schemas store as `tenant_id` / `organization_id`.
  `code` is a stable upper-case business code. `status` `active|inactive`; rows are deactivated, never deleted.
- `facilities`: care site of an organization; unit of facility-scoped authorization. `timezone` is an IANA name
  (e.g. `Asia/Jakarta`) used to render instants and interpret local clinical dates and times.

`updated_at` is maintained by `hms_meta.touch_updated_at()` (transaction time).

## Not decided yet
Departments, units, rooms, beds, external identifiers (e.g. SATUSEHAT organization ids) and the relationship to
legacy codes. Add them with the owning domain team; do not infer from the legacy schema.
