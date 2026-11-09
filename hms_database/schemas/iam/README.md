# Schema `iam`

- Migration: `0005_iam_foundation.sql` ([ADR-DB-003](../../documentation/adr/ADR-DB-003-iam-persistence.md))
- Writer: `hms_services` IAM module (`hms_iam_rw`)
- Readers: `hms_services`; audit reviewers (`hms_audit_read`: users, identities, roles, permissions, assignments,
  effective permissions; not sessions or lockout counters)
- Classification: confidential (staff names and identifiers; no patient data)
- **No credentials.** No password, PIN, token or key is stored; a governance test fails if a column looks like one.
  Sign-in is verified outside this database (legacy HMS login now, OIDC later).

`hms_services` is the authorization authority. These tables persist who is granted what; the service decides on every
request, together with checks this database cannot make (for example that the legacy staff record is still active).

## Tables
- `users`: a staff person in one organization (tenant). `id` is the `actor_id` written to `audit.audit_events`.
  `status` `active|suspended|deactivated` is the HMS-side switch: non-active users get no permissions. Users are never
  deleted and never move organization.
- `external_identities`: who vouches for a user.
  - `legacy_hms`: `issuer` = `legacy-hms:<staff table>`, `subject` = that table's key, e.g. `legacy-hms:dokter` +
    `kd_dokter`, `legacy-hms:pegawai` + `pegawai.id` (ADR-DB-003).
  - `oidc`: `issuer` = issuer URL (https), `subject` = `sub` claim.
  
  One user can hold several links (a doctor who is also an employee). Each active `(issuer, subject)` belongs to one
  user. Links are revoked, not deleted or edited; re-linking is a new row.
- `roles`: global role catalog (`code` like `physician`); `retired` roles grant nothing.
- `permissions`: capabilities `hms_services` enforces, `resource.action` (e.g. `patient.read`); registered by
  `hms_services`; `deprecated` codes grant nothing.
- `role_permissions`: permissions in a role.
- `role_assignments`: role granted to a user for the whole organization (`facility_id` NULL) or one facility, from
  `valid_from` until `valid_until` (open-ended if NULL). Composite foreign keys make cross-tenant grants impossible
  (the facility and the user must belong to `organization_id`). Assignments are revoked once, with a reason, and never
  edited, restored or deleted.
- `sessions`: server-side sessions keyed by `id_hash` = SHA-256 of the token the client holds. Records the identity
  used to sign in, client type (`web|android|ios`), optional facility context and absolute expiry. Idle timeout is
  runtime policy applied to `last_seen_at`.
- `signin_attempts`: lockout counters keyed by SHA-256 of the normalized identifier as typed. Thresholds are runtime
  policy.

## Authorization check
`iam.effective_permissions` is the single definition of "granted now" (active user, role, permission; assignment not
revoked and within its validity window). To ask "may user U do P at facility F":
```sql
SELECT EXISTS (
    SELECT 1 FROM iam.effective_permissions e
    JOIN platform.facilities f ON f.id = $facility AND f.organization_id = e.organization_id
    WHERE e.user_id = $user AND e.permission_code = $permission
      AND (e.facility_id IS NULL OR e.facility_id = f.id));
```
Tests (`tests/sql/070_iam.sql`) cover positive, negative, cross-facility and cross-organization cases.

## First administrator
No role, permission or user is seeded: the role catalog and the first IAM administrator are owner decisions. Until
`hms_services` provides an audited bootstrap command, the first administrator is created once by an operator with
the runtime role, recorded in the audit trail, and every later change goes through the service.

## Not decided yet
Department/ward/care-relationship scope, break-glass access, delegation, refresh tokens for mobile clients, retention
of revoked sessions and lockout rows, and the legacy staff-to-user linking process (counts must be verified on the
legacy data, not assumed).
