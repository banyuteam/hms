-- 0005 iam: users, external identity links, roles, permissions, scoped role assignments, sessions and sign-in
-- lockout counters (schema iam, ADR-DB-003).
-- Owner: hms_database (definitions); writes: hms_services IAM module (hms_iam_rw); reads: hms_services, audit
-- reviewers (hms_audit_read, for "who had which access when"). hms_services is the authorization authority: these
-- tables persist grants, they do not decide.
-- Classification: confidential (staff names and identifiers; no patient data).
-- No credentials: no password, PIN, token or key is stored. Sign-in is verified externally (legacy HMS login now,
-- OIDC later); sessions and lockout rows hold SHA-256 hashes only (owner decision 2026-11-08).
-- Requires group role hms_iam_rw: re-run bootstrap/bootstrap.psql before applying.
-- Online-safe: new objects; adds unique constraints to platform.facilities (small table). Rollback: fix forward.

-- Composite keys so assignments can prove facility and user belong to the assignment's organization.
ALTER TABLE platform.facilities
    ADD CONSTRAINT uq_facilities_id_organization_id UNIQUE (id, organization_id);

CREATE SCHEMA iam;
COMMENT ON SCHEMA iam IS 'hms_database: identity and access persistence (enforcement is in hms_services)';

-- A person who can act in HMS, within one organization (tenant).
CREATE TABLE iam.users (
    id                 uuid        NOT NULL DEFAULT uuidv7(),
    organization_id    uuid        NOT NULL,
    display_name       text        NOT NULL,
    status             text        NOT NULL DEFAULT 'active',
    status_reason      text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uq_users_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT fk_users_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT ck_users_display_name CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_users_status CHECK (status IN ('active', 'suspended', 'deactivated')),
    CONSTRAINT ck_users_status_reason CHECK (length(status_reason) <= 500)
);
COMMENT ON TABLE iam.users IS 'HMS user (staff person) in one organization; id is the actor_id written to the audit trail';
COMMENT ON COLUMN iam.users.status IS
    'HMS-side status; suspended/deactivated users get no access even if the external identity is still valid';

-- Who vouches for the user. legacy_hms: issuer legacy-hms:<role table>, subject = the key of that table (e.g.
-- legacy-hms:dokter + kd_dokter, legacy-hms:pegawai + pegawai.id). oidc: issuer URL + sub claim.
-- One user may hold several links (a doctor who is also an employee); each active (issuer, subject) maps to one user.
CREATE TABLE iam.external_identities (
    id                     uuid        NOT NULL DEFAULT uuidv7(),
    user_id                uuid        NOT NULL,
    provider_type          text        NOT NULL,
    issuer                 text        NOT NULL,
    subject                text        NOT NULL,
    linked_at              timestamptz NOT NULL DEFAULT now(),
    linked_by_user_id      uuid,
    last_authenticated_at  timestamptz,
    revoked_at             timestamptz,
    revoked_by_user_id     uuid,
    CONSTRAINT pk_external_identities PRIMARY KEY (id),
    CONSTRAINT fk_external_identities_user_id FOREIGN KEY (user_id) REFERENCES iam.users (id),
    CONSTRAINT fk_external_identities_linked_by_user_id FOREIGN KEY (linked_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT fk_external_identities_revoked_by_user_id FOREIGN KEY (revoked_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_external_identities_issuer CHECK (
        (provider_type = 'legacy_hms' AND issuer ~ '^legacy-hms:[a-z][a-z0-9_]{0,62}$')
        OR (provider_type = 'oidc' AND issuer ~ '^https://[^[:space:]]+$' AND length(issuer) <= 500)),
    CONSTRAINT ck_external_identities_subject CHECK (length(subject) BETWEEN 1 AND 255),
    CONSTRAINT ck_external_identities_revoked CHECK (revoked_by_user_id IS NULL OR revoked_at IS NOT NULL)
);
COMMENT ON TABLE iam.external_identities IS 'Link from an external identity (legacy staff record, OIDC subject) to an HMS user';
CREATE UNIQUE INDEX uq_external_identities_issuer_subject_active ON iam.external_identities (issuer, subject)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_external_identities_user_id ON iam.external_identities (user_id);

CREATE TABLE iam.roles (
    id           uuid        NOT NULL DEFAULT uuidv7(),
    code         text        NOT NULL,
    name         text        NOT NULL,
    description  text,
    status       text        NOT NULL DEFAULT 'active',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_roles PRIMARY KEY (id),
    CONSTRAINT uq_roles_code UNIQUE (code),
    CONSTRAINT ck_roles_code CHECK (code ~ '^[a-z][a-z0-9_-]{1,63}$'),
    CONSTRAINT ck_roles_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_roles_description CHECK (length(description) <= 1000),
    CONSTRAINT ck_roles_status CHECK (status IN ('active', 'retired'))
);
COMMENT ON TABLE iam.roles IS 'Role catalog (global across organizations); retired roles grant nothing';

-- Permission codes are the capabilities hms_services enforces (resource.action), registered by hms_services.
CREATE TABLE iam.permissions (
    code         text        NOT NULL,
    description  text        NOT NULL,
    status       text        NOT NULL DEFAULT 'active',
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_permissions PRIMARY KEY (code),
    CONSTRAINT ck_permissions_code CHECK (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$'),
    CONSTRAINT ck_permissions_description CHECK (length(btrim(description)) BETWEEN 1 AND 500),
    CONSTRAINT ck_permissions_status CHECK (status IN ('active', 'deprecated'))
);
COMMENT ON TABLE iam.permissions IS 'Capabilities enforced by hms_services, e.g. patient.read; deprecated codes grant nothing';

CREATE TABLE iam.role_permissions (
    role_id             uuid        NOT NULL,
    permission_code     text        NOT NULL,
    granted_at          timestamptz NOT NULL DEFAULT now(),
    granted_by_user_id  uuid,
    CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_code),
    CONSTRAINT fk_role_permissions_role_id FOREIGN KEY (role_id) REFERENCES iam.roles (id),
    CONSTRAINT fk_role_permissions_permission_code FOREIGN KEY (permission_code) REFERENCES iam.permissions (code),
    CONSTRAINT fk_role_permissions_granted_by_user_id FOREIGN KEY (granted_by_user_id) REFERENCES iam.users (id)
);
COMMENT ON TABLE iam.role_permissions IS 'Permissions contained in a role; changes are recorded in the audit trail by hms_services';
CREATE INDEX idx_role_permissions_permission_code ON iam.role_permissions (permission_code);

-- A role granted to a user for a whole organization (facility_id NULL) or for one facility. Never edited or deleted:
-- an assignment is revoked once, and a new grant is a new row.
CREATE TABLE iam.role_assignments (
    id                  uuid        NOT NULL DEFAULT uuidv7(),
    user_id             uuid        NOT NULL,
    role_id             uuid        NOT NULL,
    organization_id     uuid        NOT NULL,
    facility_id         uuid,
    valid_from          timestamptz NOT NULL DEFAULT now(),
    valid_until         timestamptz,
    granted_at          timestamptz NOT NULL DEFAULT now(),
    granted_by_user_id  uuid,
    grant_reason        text,
    revoked_at          timestamptz,
    revoked_by_user_id  uuid,
    revoke_reason       text,
    CONSTRAINT pk_role_assignments PRIMARY KEY (id),
    CONSTRAINT fk_role_assignments_user FOREIGN KEY (user_id, organization_id) REFERENCES iam.users (id, organization_id),
    CONSTRAINT fk_role_assignments_role_id FOREIGN KEY (role_id) REFERENCES iam.roles (id),
    CONSTRAINT fk_role_assignments_facility FOREIGN KEY (facility_id, organization_id)
        REFERENCES platform.facilities (id, organization_id),
    CONSTRAINT fk_role_assignments_granted_by_user_id FOREIGN KEY (granted_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT fk_role_assignments_revoked_by_user_id FOREIGN KEY (revoked_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_role_assignments_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT ck_role_assignments_grant_reason CHECK (length(grant_reason) <= 500),
    CONSTRAINT ck_role_assignments_revoked CHECK (
        (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoke_reason IS NULL)
        OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL AND length(btrim(revoke_reason)) BETWEEN 1 AND 500))
);
COMMENT ON TABLE iam.role_assignments IS
    'Role grant scoped to an organization (facility_id NULL = every facility of it) or one facility; revoke, never edit';
COMMENT ON COLUMN iam.role_assignments.organization_id IS 'Must equal the user''s organization (composite FK)';
CREATE UNIQUE INDEX uq_role_assignments_active ON iam.role_assignments (user_id, role_id, organization_id, facility_id)
    NULLS NOT DISTINCT WHERE revoked_at IS NULL;
CREATE INDEX idx_role_assignments_role_id ON iam.role_assignments (role_id) WHERE revoked_at IS NULL;

-- Authenticated session. id_hash = SHA-256 of the session token held by the client; the token itself is never stored.
CREATE TABLE iam.sessions (
    id_hash               bytea       NOT NULL,
    user_id               uuid        NOT NULL,
    external_identity_id  uuid        NOT NULL,
    facility_id           uuid,
    client_type           text        NOT NULL,
    auth_method           text        NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    last_seen_at          timestamptz NOT NULL DEFAULT now(),
    absolute_expires_at   timestamptz NOT NULL,
    revoked_at            timestamptz,
    revoke_reason         text,
    CONSTRAINT pk_sessions PRIMARY KEY (id_hash),
    CONSTRAINT fk_sessions_user_id FOREIGN KEY (user_id) REFERENCES iam.users (id),
    CONSTRAINT fk_sessions_external_identity_id FOREIGN KEY (external_identity_id) REFERENCES iam.external_identities (id),
    CONSTRAINT fk_sessions_facility_id FOREIGN KEY (facility_id) REFERENCES platform.facilities (id),
    CONSTRAINT ck_sessions_id_hash CHECK (octet_length(id_hash) = 32),
    CONSTRAINT ck_sessions_client_type CHECK (client_type IN ('web', 'android', 'ios')),
    CONSTRAINT ck_sessions_auth_method CHECK (auth_method IN ('legacy_hms_login', 'oidc')),
    CONSTRAINT ck_sessions_expiry CHECK (absolute_expires_at > created_at),
    CONSTRAINT ck_sessions_revoked CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
    CONSTRAINT ck_sessions_revoke_reason CHECK (revoke_reason IN
        ('sign_out', 'idle_timeout', 'admin_revoked', 'security_revoked', 'user_deactivated', 'identity_inactive'))
);
COMMENT ON TABLE iam.sessions IS 'Server-side sessions keyed by token hash; idle timeout is runtime policy applied to last_seen_at';
COMMENT ON COLUMN iam.sessions.external_identity_id IS 'Identity used to sign in (e.g. the doctor or the employee record)';
COMMENT ON COLUMN iam.sessions.facility_id IS 'Facility context chosen for the session; authorization still checks assignments';
CREATE INDEX idx_sessions_user_id_active ON iam.sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_absolute_expires_at ON iam.sessions (absolute_expires_at);

-- Failed sign-in counters for lockout. account_key_hash = SHA-256 of the normalized identifier as typed, so wrong or
-- mistyped identifiers (sometimes a password typed into the wrong field) are never stored.
CREATE TABLE iam.signin_attempts (
    account_key_hash   bytea       NOT NULL,
    failures           integer     NOT NULL DEFAULT 0,
    window_started_at  timestamptz NOT NULL DEFAULT now(),
    last_failure_at    timestamptz,
    locked_until       timestamptz,
    CONSTRAINT pk_signin_attempts PRIMARY KEY (account_key_hash),
    CONSTRAINT ck_signin_attempts_hash CHECK (octet_length(account_key_hash) = 32),
    CONSTRAINT ck_signin_attempts_failures CHECK (failures >= 0)
);
COMMENT ON TABLE iam.signin_attempts IS 'Lockout counters per hashed account key; thresholds are runtime policy';
CREATE INDEX idx_signin_attempts_window_started_at ON iam.signin_attempts (window_started_at);

CREATE TRIGGER trg_users_touch_updated_at BEFORE UPDATE ON iam.users
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();
CREATE TRIGGER trg_roles_touch_updated_at BEFORE UPDATE ON iam.roles
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();

-- A revoked link or assignment stays revoked; restoring access means a new row.
CREATE FUNCTION iam.refuse_change_after_revoke() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION '%.% row % is revoked and cannot be changed', TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER trg_role_assignments_refuse_change_after_revoke BEFORE UPDATE ON iam.role_assignments
    FOR EACH ROW EXECUTE FUNCTION iam.refuse_change_after_revoke();
CREATE TRIGGER trg_external_identities_refuse_change_after_revoke BEFORE UPDATE ON iam.external_identities
    FOR EACH ROW EXECUTE FUNCTION iam.refuse_change_after_revoke();

-- The one definition of "currently granted": active user, active role, active permission, assignment in force.
-- facility_id NULL means the grant covers every facility of organization_id. A check for facility F therefore matches
-- rows with facility_id = F or facility_id IS NULL (same organization). Runs with the caller's privileges.
CREATE VIEW iam.effective_permissions WITH (security_invoker = true) AS
SELECT a.user_id,
       a.organization_id,
       a.facility_id,
       rp.permission_code,
       r.code AS role_code,
       a.id AS role_assignment_id,
       a.valid_until
FROM iam.role_assignments a
JOIN iam.users u ON u.id = a.user_id AND u.status = 'active'
JOIN iam.roles r ON r.id = a.role_id AND r.status = 'active'
JOIN iam.role_permissions rp ON rp.role_id = a.role_id
JOIN iam.permissions p ON p.code = rp.permission_code AND p.status = 'active'
WHERE a.revoked_at IS NULL
  AND a.valid_from <= now()
  AND (a.valid_until IS NULL OR a.valid_until > now());
COMMENT ON VIEW iam.effective_permissions IS
    'Permissions in force now, per user and scope (facility_id NULL = organization-wide)';

GRANT USAGE ON SCHEMA iam TO hms_iam_rw, hms_audit_read;
GRANT SELECT, INSERT ON iam.users, iam.external_identities, iam.roles, iam.permissions, iam.role_permissions,
    iam.role_assignments, iam.sessions, iam.signin_attempts TO hms_iam_rw;
GRANT UPDATE (display_name, status, status_reason) ON iam.users TO hms_iam_rw;
GRANT UPDATE (last_authenticated_at, revoked_at, revoked_by_user_id) ON iam.external_identities TO hms_iam_rw;
GRANT UPDATE (name, description, status) ON iam.roles TO hms_iam_rw;
GRANT UPDATE (description, status) ON iam.permissions TO hms_iam_rw;
GRANT DELETE ON iam.role_permissions TO hms_iam_rw;
GRANT UPDATE (revoked_at, revoked_by_user_id, revoke_reason) ON iam.role_assignments TO hms_iam_rw;
GRANT UPDATE (last_seen_at, facility_id, revoked_at, revoke_reason), DELETE ON iam.sessions TO hms_iam_rw;
GRANT UPDATE, DELETE ON iam.signin_attempts TO hms_iam_rw;
GRANT SELECT ON iam.effective_permissions TO hms_iam_rw;

-- Audit review: who existed, which identities and roles they held, and when (not sessions or lockout counters).
GRANT SELECT ON iam.users, iam.external_identities, iam.roles, iam.permissions, iam.role_permissions,
    iam.role_assignments, iam.effective_permissions TO hms_audit_read;
