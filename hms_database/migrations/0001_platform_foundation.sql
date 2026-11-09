-- 0001 platform foundation: shared utilities and the organization/facility anchor for tenant and facility scope.
-- Owner: hms_database (definitions); writes: hms_services platform module. Classification: internal (no PHI).
-- Online-safe: creates new objects only. Rollback: fix forward; on an empty development database the objects can be
-- dropped (DROP SCHEMA platform CASCADE; DROP FUNCTION hms_meta.touch_updated_at()) together with ledger row 0001.

CREATE FUNCTION hms_meta.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END
$$;
COMMENT ON FUNCTION hms_meta.touch_updated_at() IS 'BEFORE UPDATE trigger: sets updated_at to the transaction time';

CREATE SCHEMA platform;
COMMENT ON SCHEMA platform IS 'hms_database: organizations, facilities and platform reference data';

-- An organization is the tenant boundary: the legal/operating entity whose data is isolated from other tenants.
CREATE TABLE platform.organizations (
    id          uuid        NOT NULL DEFAULT uuidv7(),
    code        text        NOT NULL,
    name        text        NOT NULL,
    status      text        NOT NULL DEFAULT 'active',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_organizations PRIMARY KEY (id),
    CONSTRAINT uq_organizations_code UNIQUE (code),
    CONSTRAINT ck_organizations_code CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CONSTRAINT ck_organizations_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_organizations_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE platform.organizations IS 'Tenant boundary; referenced as tenant_id/organization_id by other schemas';
COMMENT ON COLUMN platform.organizations.code IS 'Stable business code, upper case, unique';

-- A facility is a care site of an organization (hospital, clinic). Facility scope drives authorization.
CREATE TABLE platform.facilities (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    code             text        NOT NULL,
    name             text        NOT NULL,
    timezone         text        NOT NULL,
    status           text        NOT NULL DEFAULT 'active',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_facilities PRIMARY KEY (id),
    CONSTRAINT fk_facilities_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT uq_facilities_organization_id_code UNIQUE (organization_id, code),
    CONSTRAINT ck_facilities_code CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    CONSTRAINT ck_facilities_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_facilities_timezone CHECK (timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'),
    CONSTRAINT ck_facilities_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE platform.facilities IS 'Care site of an organization; unit of facility-scoped authorization';
COMMENT ON COLUMN platform.facilities.timezone IS
    'IANA zone (e.g. Asia/Jakarta) used to render instants and interpret local clinical dates/times';

CREATE TRIGGER trg_organizations_touch_updated_at BEFORE UPDATE ON platform.organizations
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();
CREATE TRIGGER trg_facilities_touch_updated_at BEFORE UPDATE ON platform.facilities
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();

-- Organizations and facilities are deactivated, never deleted: other schemas keep references to them.
GRANT USAGE ON SCHEMA platform TO hms_platform_rw, hms_report_read;
GRANT SELECT, INSERT, UPDATE ON platform.organizations, platform.facilities TO hms_platform_rw;
GRANT SELECT ON platform.organizations, platform.facilities TO hms_report_read;
