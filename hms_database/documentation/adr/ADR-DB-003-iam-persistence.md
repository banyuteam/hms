# ADR-DB-003: IAM persistence without stored credentials, organization/facility-scoped roles

- Status: Proposed (two owner decisions recorded 2026-11-08, see Decision 1 and 3)
- Date: 2026-11-08
- Owners: hms_database (schema); hms_services (enforcement)
- Affected projects: hms_database, hms_services (IAM module, sign-in, authorization), hms_workspace (session use only)
- Related: root `CLAUDE.md` §6, §10, §14-15; ADR-DB-002; ADR-SVC-001 (sign-in and sessions,
  `hms_services/documentation/architecture/`)

## Context
Workstream 2 needs identity, roles, permissions, facility scope and sessions. The previous implementation
identified staff by legacy HMS records (`dokter.kd_dokter`, `pegawai.id`, active staff only), signed them in with
their existing legacy login, and accepted an interim PIN flow that uses the staff ID as the first password. In this
workspace, root `CLAUDE.md` §10 forbids building that bootstrap-password flow without the identity/security owner's
approval of the full flow, and `hms_database/CLAUDE.md` forbids credentials in application schemas. A planned SSO
(`hms-sso`) will issue OIDC identities later.

## Decision
1. **No stored credentials (owner, 2026-11-08).** Schema `iam` holds no password, PIN, token or key. Sign-in is
   verified by an external authority (legacy HMS login via `hms_services`, later OIDC). Sessions and lockout counters
   store SHA-256 hashes only. A governance test rejects credential-like columns.
2. Identity is an HMS `users` row per person and organization, linked to one or more `external_identities`
   (`legacy_hms` or `oidc`, unique active `(issuer, subject)`). Email is not an identity key.
3. **Role scope = organization or facility (owner, 2026-11-08).** `role_assignments` grant a role for a whole
   organization (`facility_id` NULL) or one facility, with a validity window; composite foreign keys prevent
   cross-organization grants. Department/ward scope is deferred until departments are modeled.
4. Grants are append-and-revoke: assignments and identity links are revoked once and never edited, restored or
   deleted; users are never deleted. Change history comes from these rows plus the audit trail.
5. `iam.effective_permissions` (security-invoker view) is the single definition of "granted now".
6. Cross-schema foreign keys to `platform` are deliberate: one database, one owner, one transactional boundary
   (`workspace-control-plane.md`).
7. Runtime access through new group role `hms_iam_rw` (added to the bootstrap and to `<p>_runtime`); audit reviewers
   read identities and grants, not sessions.

## Alternatives considered
1. Store PIN hashes with one-time enrollment (the previous implementation's interim flow): rejected for now by the owner; needs §10
   approval and an ADR before it may be added.
2. OIDC only from day one: no sign-in possible until the IdP exists.
3. Department-level scope now: needs the department model and its mapping to legacy codes first.
4. Roles per organization instead of a global catalog: unnecessary for one hospital; can be added by a new column.

## Consequences
- Positive: no credential database to protect or leak; cross-tenant grants impossible at the database level; one
  shared rule for "granted now"; full grant history.
- Negative: sign-in depends on the legacy HMS (and its credential storage weaknesses, see ADR-SVC-001)
  until SSO exists; no offline/PIN sign-in.
- Operational: re-run the bootstrap before migration 0005 (creates `hms_iam_rw`); the first IAM administrator is a
  one-time operator step.
- Compatibility: `audit.audit_events.actor_id` should carry `iam.users.id`.
- Security/privacy: staff names are confidential; reporting cannot read `iam`.
- Patient-safety: access rules are only as correct as the role catalog; clinical owners must review role contents.

## Ownership impact
hms_database owns the schema and tests. hms_services owns sign-in, session lifecycle, permission registration,
authorization decisions, legacy staff active checks and audit events for every IAM change. hms_workspace only holds
the session token and renders permitted UI.

## Migration and rollout
New schema; existing databases: re-run bootstrap, then `migrate` (0005). Without the bootstrap the migration fails and
rolls back completely (verified).

## Acceptance criteria
- [x] Positive, negative, cross-facility and cross-organization authorization cases tested (`070_iam.sql`).
- [x] Revoked, future, suspended, retired and deprecated grants are not in force (tested; each rule mutation-checked).
- [x] No credential-like columns (governance test).
- [ ] hms_services sign-in and authorization implemented against this schema.
- [ ] Role catalog and first administrator approved by the owner.

**Amendment 2026-11-09:** references to the previous implementation outside this workspace removed; decisions unchanged.
