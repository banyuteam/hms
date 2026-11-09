-- iam: identity links, scoped role assignments, effective permissions, sessions (migration 0005). Synthetic data;
-- rolled back. Fixed ids: organizations ...0a/0b, facilities ...a1/a2/b1, users ...u1 (org A) / ...u2 (org B).
BEGIN;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
BEGIN
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO platform.organizations (id, code, name) VALUES
            ('00000000-0000-7000-8000-00000000000a', 'TEST-ORG-A', 'Test Organization A'),
            ('00000000-0000-7000-8000-00000000000b', 'TEST-ORG-B', 'Test Organization B')
    $q$);
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO platform.facilities (id, organization_id, code, name, timezone) VALUES
            ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-00000000000a', 'A1', 'Facility A1', 'Asia/Jakarta'),
            ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-00000000000a', 'A2', 'Facility A2', 'Asia/Jakarta'),
            ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-00000000000b', 'B1', 'Facility B1', 'Asia/Jakarta')
    $q$);
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO iam.users (id, organization_id, display_name) VALUES
            ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-00000000000a', 'Test User One'),
            ('00000000-0000-7000-8000-0000000000c2', '00000000-0000-7000-8000-00000000000b', 'Test User Two')
    $q$);

    -- External identity links.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO iam.external_identities (id, user_id, provider_type, issuer, subject) VALUES
            ('00000000-0000-7000-8000-0000000000d1', '00000000-0000-7000-8000-0000000000c1', 'legacy_hms', 'legacy-hms:dokter', 'TEST-D001'),
            ('00000000-0000-7000-8000-0000000000d2', '00000000-0000-7000-8000-0000000000c1', 'legacy_hms', 'legacy-hms:pegawai', 'TEST-P001'),
            ('00000000-0000-7000-8000-0000000000d3', '00000000-0000-7000-8000-0000000000c2', 'oidc', 'https://sso.test.invalid/realms/hms', 'sub-002')
    $q$) = 3, 'one user may hold several identity links');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO iam.external_identities (user_id, provider_type, issuer, subject)
                                       VALUES ('00000000-0000-7000-8000-0000000000c2', 'legacy_hms', 'legacy-hms:dokter', 'TEST-D001')$q$,
                                 '23505', 'an active external identity maps to one user');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO iam.external_identities (user_id, provider_type, issuer, subject)
                                       VALUES ('00000000-0000-7000-8000-0000000000c2', 'oidc', 'http://insecure.test.invalid', 'x')$q$,
                                 '23514', 'OIDC issuer must be https');

    -- Catalog.
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO iam.permissions (code, description) VALUES
            ('test_patient.read', 'Read test patients'),
            ('test_encounter.read', 'Read test encounters'),
            ('test_iam.manage', 'Manage test IAM')
    $q$);
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO iam.permissions (code, description) VALUES ('nodot', 'x')$q$,
                                 '23514', 'permission codes are resource.action');
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO iam.roles (id, code, name) VALUES
            ('00000000-0000-7000-8000-0000000000e1', 'test-physician', 'Test Physician'),
            ('00000000-0000-7000-8000-0000000000e2', 'test-viewer', 'Test Viewer')
    $q$);
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO iam.role_permissions (role_id, permission_code) VALUES
            ('00000000-0000-7000-8000-0000000000e1', 'test_patient.read'),
            ('00000000-0000-7000-8000-0000000000e1', 'test_encounter.read'),
            ('00000000-0000-7000-8000-0000000000e2', 'test_encounter.read')
    $q$);

    -- Facility-scoped grant: physician at A1.
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO iam.role_assignments (id, user_id, role_id, organization_id, facility_id, grant_reason) VALUES
            ('00000000-0000-7000-8000-0000000000f1', '00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-0000000000e1',
             '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1', 'test')
    $q$);
END
$$;

-- "Has permission P at facility F" as hms_services asks it.
CREATE FUNCTION pg_temp.can(p_user text, p_perm text, p_facility text) RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (
        SELECT 1 FROM iam.effective_permissions e
        JOIN platform.facilities f ON f.id = p_facility::uuid AND f.organization_id = e.organization_id
        WHERE e.user_id = p_user::uuid AND e.permission_code = p_perm
          AND (e.facility_id IS NULL OR e.facility_id = f.id))
$$;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    u1  text := '00000000-0000-7000-8000-0000000000c1';
    u2  text := '00000000-0000-7000-8000-0000000000c2';
    a1  text := '00000000-0000-7000-8000-0000000000a1';
    a2  text := '00000000-0000-7000-8000-0000000000a2';
    b1  text := '00000000-0000-7000-8000-0000000000b1';
BEGIN
    -- Positive, negative and cross-facility.
    PERFORM pg_temp.ok(pg_temp.can(u1, 'test_patient.read', a1), 'granted permission at the granted facility');
    PERFORM pg_temp.ok(NOT pg_temp.can(u1, 'test_iam.manage', a1), 'permission outside the role is not granted');
    PERFORM pg_temp.ok(NOT pg_temp.can(u1, 'test_patient.read', a2), 'facility grant does not reach another facility');
    PERFORM pg_temp.ok(NOT pg_temp.can(u1, 'test_patient.read', b1), 'grant does not reach another organization');
    PERFORM pg_temp.ok(NOT pg_temp.can(u2, 'test_patient.read', a1), 'user without assignment has nothing');

    -- Cross-tenant grants are impossible.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO iam.role_assignments (user_id, role_id, organization_id, facility_id)
                                       VALUES (%L, '00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-00000000000a', %L)$q$, u1, b1),
                                 '23503', 'facility of another organization cannot be granted');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO iam.role_assignments (user_id, role_id, organization_id)
                                       VALUES (%L, '00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-00000000000b')$q$, u1),
                                 '23503', 'user cannot be granted a role in another organization');

    -- Organization-wide grant reaches every facility of the organization, not others.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO iam.role_assignments (id, user_id, role_id, organization_id)
        VALUES ('00000000-0000-7000-8000-0000000000f2', %L, '00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-00000000000a')$q$, u1));
    PERFORM pg_temp.ok(pg_temp.can(u1, 'test_encounter.read', a2), 'organization-wide grant reaches facility A2');
    PERFORM pg_temp.ok(NOT pg_temp.can(u1, 'test_encounter.read', b1), 'organization-wide grant stays in its organization');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO iam.role_assignments (user_id, role_id, organization_id)
        VALUES (%L, '00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-00000000000a')$q$, u1),
                                 '23505', 'duplicate active organization-wide grant is refused');

    -- Validity window.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO iam.role_assignments (user_id, role_id, organization_id, facility_id, valid_from)
        VALUES (%L, '00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-00000000000a', %L, now() + interval '1 day')$q$, u1, a2));
    PERFORM pg_temp.ok(NOT pg_temp.can(u1, 'test_patient.read', a2), 'future grant is not yet in force');

    -- Status of user, role and permission.
    PERFORM pg_temp.exec_as(rt, $q$UPDATE iam.permissions SET status = 'deprecated' WHERE code = 'test_patient.read'$q$);
    PERFORM pg_temp.ok(NOT pg_temp.can(u1, 'test_patient.read', a1), 'deprecated permission grants nothing');
    PERFORM pg_temp.exec_as(rt, $q$UPDATE iam.permissions SET status = 'active' WHERE code = 'test_patient.read'$q$);
    PERFORM pg_temp.exec_as(rt, $q$UPDATE iam.roles SET status = 'retired' WHERE code = 'test-physician'$q$);
    PERFORM pg_temp.ok(NOT pg_temp.can(u1, 'test_patient.read', a1), 'retired role grants nothing');
    PERFORM pg_temp.exec_as(rt, $q$UPDATE iam.roles SET status = 'active' WHERE code = 'test-physician'$q$);
    PERFORM pg_temp.exec_as(rt, format($q$UPDATE iam.users SET status = 'suspended', status_reason = 'test' WHERE id = %L$q$, u1));
    PERFORM pg_temp.ok(NOT pg_temp.can(u1, 'test_patient.read', a1), 'suspended user has nothing');
    PERFORM pg_temp.exec_as(rt, format($q$UPDATE iam.users SET status = 'active', status_reason = NULL WHERE id = %L$q$, u1));
    PERFORM pg_temp.ok(pg_temp.can(u1, 'test_patient.read', a1), 'access returns after reactivation');

    -- Revocation is final and needs a reason.
    PERFORM pg_temp.expect_error(rt, $q$UPDATE iam.role_assignments SET revoked_at = now()
                                       WHERE id = '00000000-0000-7000-8000-0000000000f1'$q$, '23514', 'revocation needs a reason');
    PERFORM pg_temp.exec_as(rt, format($q$UPDATE iam.role_assignments SET revoked_at = now(), revoked_by_user_id = %L,
        revoke_reason = 'test' WHERE id = '00000000-0000-7000-8000-0000000000f1'$q$, u1));
    PERFORM pg_temp.ok(NOT pg_temp.can(u1, 'test_patient.read', a1), 'revoked grant is not in force');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE iam.role_assignments SET revoked_at = NULL, revoked_by_user_id = NULL, revoke_reason = NULL
                                       WHERE id = '00000000-0000-7000-8000-0000000000f1'$q$, 'P0001', 'a revoked grant cannot be restored');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE iam.role_assignments SET facility_id = NULL
                                       WHERE id = '00000000-0000-7000-8000-0000000000f2'$q$, '42501', 'grant scope cannot be edited');
    PERFORM pg_temp.expect_error(rt, 'DELETE FROM iam.role_assignments', '42501', 'grants cannot be deleted');
    PERFORM pg_temp.expect_error(rt, 'DELETE FROM iam.users', '42501', 'users cannot be deleted');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE iam.users SET organization_id = '00000000-0000-7000-8000-00000000000b' WHERE id = %L$q$, u1),
                                 '42501', 'a user cannot move to another organization');

    -- Sessions hold only a token hash.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$INSERT INTO iam.sessions (id_hash, user_id, external_identity_id, facility_id,
            client_type, auth_method, absolute_expires_at)
        VALUES (sha256('test-session-token'), %L, '00000000-0000-7000-8000-0000000000d1', %L, 'web', 'legacy_hms_login',
                now() + interval '12 hours')$q$, u1, a1)) = 1, 'session is stored by token hash');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO iam.sessions (id_hash, user_id, external_identity_id, client_type,
            auth_method, absolute_expires_at)
        VALUES ('\x0102', %L, '00000000-0000-7000-8000-0000000000d1', 'web', 'legacy_hms_login', now() + interval '1 hour')$q$, u1),
                                 '23514', 'session key must be a 32-byte hash');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE iam.sessions SET revoked_at = now()$q$, '23514', 'session revocation needs a reason');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$UPDATE iam.sessions SET revoked_at = now(), revoke_reason = 'sign_out'
                                              WHERE id_hash = sha256('test-session-token')$q$) = 1, 'session signs out');

    -- Lockout counter upsert.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO iam.signin_attempts (account_key_hash, failures, last_failure_at) VALUES (sha256('test-account'), 1, now())
        ON CONFLICT (account_key_hash) DO UPDATE SET failures = signin_attempts.failures + 1, last_failure_at = now()
    $q$) = 1, 'failed sign-in is counted');

    -- Readers.
    PERFORM pg_temp.ok(pg_temp.exec_as(pg_temp.r('auditor'), 'SELECT * FROM iam.role_assignments') >= 2,
                       'auditor reads role assignment history');
    PERFORM pg_temp.ok(pg_temp.exec_as(pg_temp.r('auditor'), 'SELECT * FROM iam.effective_permissions') >= 1,
                       'auditor reads effective permissions');
    PERFORM pg_temp.expect_error(pg_temp.r('auditor'), 'SELECT * FROM iam.sessions', '42501', 'auditor cannot read sessions');
    PERFORM pg_temp.expect_error(pg_temp.r('reporting'), 'SELECT * FROM iam.users', '42501', 'reporting cannot read users');
END
$$;

ROLLBACK;
