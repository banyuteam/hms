# ADR-SVC-002: IAM administration, permission registry and first administrator

- Status: Accepted (owner approval 2026-11-10)
- Date: 2026-11-08
- Owners: hms_services
- Affected projects: hms_services, hms_database (iam schema, ADR-DB-003), hms_workspace (future admin screens)
- Related contracts: `contracts/api/iam-admin-v1.openapi.yaml`, `contracts/api/auth-v1.openapi.yaml`

## Context
After ADR-SVC-001 every signed-in user is provisioned with no access. Someone must be able to grant access, without
SQL and without an unaudited back door, while the clinical role catalog remains an owner decision.

## Decision
1. **Permission registry.** Each permission the service enforces is declared in code (`iam.Registry`) and inserted
   into `iam.permissions` at startup (new codes only, audited). Administrators combine registered permissions into
   roles; they cannot invent codes the service does not enforce.
2. **First administrator.** `hms-services bootstrap-admin -legacy-user-id <Khanza ID>` grants the system role
   `iam-admin` (all `iam.*` permissions) organization-wide to an active staff member who has signed in once. It runs
   on the server with the runtime credentials, is audited, and refuses once any administrator exists.
3. **Administration API** (organization-scoped, permission-checked, audited): list/view users; suspend, deactivate
   or reactivate; list roles and permissions; create roles and set their permissions; grant (organization-wide or per
   facility, optional end date, mandatory reason) and revoke (mandatory reason).
4. **Guards that hold for every caller:** no change to your own status or assignments; the last active IAM
   administrator of an organization cannot be revoked or suspended (serialized by a per-organization advisory lock);
   `iam-admin` cannot be created or edited through the API; ids of other organizations answer 404; suspension ends
   the user's sessions immediately.

## Alternatives considered
1. Seed an administrator in a migration: needs a person-specific id in source control and bypasses the audit trail.
2. Grant administration by SQL only: no guards, easy to misuse, not usable by IT staff.
3. Allow self-grants with audit only: weaker separation of duties for little benefit.

## Consequences
- Positive: access is granted without SQL; every change is attributable; lockout of all administrators is prevented.
- Negative: a single remaining administrator cannot hand over without first granting a second one (intended).
- Security: anyone with server access and the runtime credentials could run bootstrap-admin, but only while no
  administrator exists; afterwards it is refused.

## Acceptance criteria
- [x] Integration test over HTTP and PostgreSQL covering grants, revocation, suspension, scoping and all guards.
- [x] Eight deliberate defects in the guards each caught by the tests.
- [x] Owner chooses the first administrator and runs bootstrap-admin on the dev server (confirmed by the owner
      2026-11-10).
- [x] Owner defines the clinical role catalog (permissions arrive as clinical APIs are built) (confirmed by the owner
      2026-11-10).
