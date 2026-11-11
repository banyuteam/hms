# ADR-SVC-001: Staff sign-in with the legacy HMS login and server-side cookie sessions

- Status: Accepted (owner approval 2026-11-10; owner decisions 2026-11-08 recorded below)
- Date: 2026-11-08
- Owners: hms_services
- Affected projects: hms_services (owner), hms_database (iam/audit schema, ADR-DB-003), hms_workspace (web client)
- Related contracts: `contracts/api/auth-v1.openapi.yaml`; ADR-DB-003 (IAM persistence, no stored credentials)

## Context
Workstream 2 needs authentication, sessions and authorization. Owner decisions: no credentials stored in HMS
(ADR-DB-003); staff sign in with their existing legacy HMS (Khanza) login; only active doctors/employees may use the
system (staff identity rule carried over from the previous implementation, accepted by the owner); a first valid
sign-in creates the HMS user automatically with no access; roles are granted per organization or facility; tenant
RSUB2, facility RSUB2-MAIN.

## Decision
1. `POST /api/v1/auth/sign-in` verifies the legacy login read-only: the typed ID and password are AES-encrypted in Go
   exactly as MySQL `AES_ENCRYPT` and compared as `HEX()` strings against `user` (the AES values are binary data in
   text columns, which MySQL re-encodes in the connection character set: verified 2026-11-08, 329 of 330 raw IDs
   arrived altered, 330 of 330 via HEX matched); no password or key is sent to MySQL. Then the person is resolved doctor-first (`dokter.status = '1'`), else employee
   (`pegawai.stts_aktif = 'AKTIF'`, by `LEGACY_LOGIN_EMPLOYEE_FIELD`). Four fixed SELECT statements, test-enforced, on
   a read-only session.
2. The legacy identity maps to `iam.external_identities` (`legacy-hms:dokter|pegawai`, subject). Unknown identities are
   provisioned (user + link + audit, one transaction; concurrent first sign-ins converge on one user) with no roles.
3. Sessions are server-side: 256-bit random token in an HttpOnly, Secure (HTTPS), SameSite=Strict cookie with the
   `__Host-` prefix; only SHA-256 of the token is stored in `iam.sessions`. Idle 15 min, absolute 12 h (configurable).
4. Each request re-validates the session, the HMS user status and the legacy active status (cached up to 5 min);
   inactive or suspended people lose their sessions; a legacy outage fails closed (503) without ending sessions.
5. Brute-force protection: per-account lockout (5 failures / 15 min -> 15 min lock, counted on a hash of the typed ID,
   atomic in PostgreSQL) and a per-address limit per process. All failures look identical to the client.
6. CSRF: state-changing requests must match the public origin (Origin, or Sec-Fetch-Site: same-origin) and be JSON;
   no CORS is granted.
7. Authorization: `RequirePermission(code)` checks `iam.effective_permissions` at the session's facility (grant for
   that facility or organization-wide); denials are audited. The server is the only authority.
8. Audit (`audit.audit_events`): sign-in success/failure/denial, provisioning, sign-out, revocations and permission
   denials; success events commit atomically with the change. No typed IDs, passwords or tokens are written.

## Alternatives considered
1. PIN sign-in with staff ID as first password (an interim flow of the previous implementation): rejected by the owner (no stored credentials;
   root CLAUDE.md §10).
2. JWT access tokens in the browser: revocation and theft exposure are worse than an HttpOnly server-side session for
   a same-origin web client. Mobile clients need a separate token design later.
3. Sending `AES_ENCRYPT(?, key)` to MySQL: puts passwords and keys in the server's query log.
4. Pre-registered users only: nobody could sign in until manual SQL linking.

## Consequences
- Positive: no credential store; immediate revocation; least-privilege runtime role; full audit.
- Negative: sign-in depends on Khanza availability and its weak password storage (AES-ECB, recoverable with the key);
  the AES keys are among the most sensitive secrets. Per-process rate limiting needs an ingress limit with replicas.
- Operational: `hms-services setup-organization` once; secrets via `*_FILE`; `/healthz`, `/readyz`.
- Security/privacy: staff names are confidential; sign-in failures are audited anonymously.

## Acceptance criteria
- [x] Unit, HTTP and PostgreSQL integration tests (lockout, provisioning race, sessions, scope, audit) pass.
- [x] Six deliberate defects (mutations) each caught by a test.
- [x] Real sign-in verified against the Khanza dev database by the owner (2026-11-08).
- [x] ID key and `LEGACY_LOGIN_EMPLOYEE_FIELD=nik` confirmed on the dev Khanza with `check-legacy-key` (2026-11-08,
      counts only: 330 accounts, 330 decoded and re-encrypted exactly, 59 active doctors, 217 active employees via nik,
      54 neither).
- [x] Password key confirmed by the owner's real sign-in (2026-11-08).
- [ ] Container image, CI, ingress rate limit and TLS before staging.

**Amendment 2026-11-09:** references to the previous implementation outside this workspace removed; decisions unchanged.
