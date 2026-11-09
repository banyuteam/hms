# Schema `workforce`

- Migration: `0009_workforce.sql` (ADR-DB-004, ADR-DB-005)
- Writer: `hms_services` workforce module (`hms_workforce_rw`)
- Readers: `hms_services`; audit reviewers (`hms_audit_read`)
- Classification: confidential (NIK and licence numbers are restricted)

A practitioner is the clinical identity that authors, performs, attests and signs. `iam.users` is the sign-in
identity. `practitioners.user_id` links the two (one practitioner per user, same organization). The database never
infers the practitioner from the session.

## Tables (versioned records, tenant row-level security)
- `practitioners`: display name, administrative gender, active, optional `user_id`.
- `practitioner_identifiers`: NIK, SATUSEHAT practitioner id, STR, SIP and legacy keys. They are validated against
  `terminology.identifier_systems`. System and value never change: a wrong identifier is deactivated and a new row
  is added.
- `practitioner_roles`: role and specialty at a facility (optional location) for a period. It can cite the licence
  identifier (SIP is facility-specific); the licence must belong to the same practitioner.

History: `workforce.resource_versions` (resource types `Practitioner`, `Practitioner.identifier`,
`PractitionerRole`).
