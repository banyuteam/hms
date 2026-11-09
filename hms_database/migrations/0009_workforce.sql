-- 0009 workforce: practitioners (clinical professionals), their identifiers and their roles at a facility
-- (schema workforce, ADR-DB-004). Maps to FHIR Practitioner and PractitionerRole.
-- Owner: hms_database (definitions); writes: hms_services workforce module (hms_workforce_rw); reads: hms_services,
-- audit reviewers. Classification: confidential (staff identity, NIK and licence numbers are restricted).
-- A practitioner is the clinical identity that authors, performs and signs; an iam.users row is the sign-in identity.
-- user_id links the two when the practitioner uses HMS. Clinical authorship is never inferred from the session user.
-- Versioned records (ADR-DB-005): every change is kept in workforce.resource_versions with its actor; rows are never
-- deleted; tenant row-level security on organization_id.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA workforce;
COMMENT ON SCHEMA workforce IS 'hms_database: practitioners, practitioner identifiers and roles';

SELECT hms_meta.create_version_store('workforce');

CREATE TABLE workforce.practitioners (
    id                    uuid        NOT NULL DEFAULT uuidv7(),
    organization_id       uuid        NOT NULL,
    user_id               uuid,
    display_name          text        NOT NULL,
    administrative_gender text        NOT NULL DEFAULT 'unknown',
    active                boolean     NOT NULL DEFAULT true,
    version               integer     NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    last_xact_id          xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_practitioners PRIMARY KEY (id),
    CONSTRAINT uq_practitioners_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT fk_practitioners_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_practitioners_user FOREIGN KEY (user_id, organization_id) REFERENCES iam.users (id, organization_id),
    CONSTRAINT ck_practitioners_display_name CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_practitioners_administrative_gender CHECK (administrative_gender IN ('male', 'female', 'other', 'unknown'))
);
COMMENT ON TABLE workforce.practitioners IS 'Clinical professional (FHIR Practitioner); user_id links the HMS sign-in identity';
CREATE UNIQUE INDEX uq_practitioners_user_id ON workforce.practitioners (user_id) WHERE user_id IS NOT NULL;

-- NIK, SATUSEHAT practitioner number, STR, SIP and legacy keys. End a link by closing its period or deactivating it.
CREATE TABLE workforce.practitioner_identifiers (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    practitioner_id  uuid        NOT NULL,
    system_uri       text        NOT NULL,
    value            text        NOT NULL,
    period_start     date,
    period_end       date,
    active           boolean     NOT NULL DEFAULT true,
    unique_value     boolean     NOT NULL DEFAULT false,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_practitioner_identifiers PRIMARY KEY (id),
    CONSTRAINT uq_practitioner_identifiers_id_practitioner_id UNIQUE (id, practitioner_id),
    CONSTRAINT fk_practitioner_identifiers_practitioner FOREIGN KEY (practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_practitioner_identifiers_system_uri FOREIGN KEY (system_uri) REFERENCES terminology.identifier_systems (uri),
    CONSTRAINT ck_practitioner_identifiers_value CHECK (length(value) BETWEEN 1 AND 100 AND value = btrim(value)),
    CONSTRAINT ck_practitioner_identifiers_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
COMMENT ON TABLE workforce.practitioner_identifiers IS 'Identifier of a practitioner (NIK, SATUSEHAT id, STR, SIP, legacy key)';
COMMENT ON COLUMN workforce.practitioner_identifiers.unique_value IS 'Copied from the identifier system on insert (trigger)';
CREATE UNIQUE INDEX uq_practitioner_identifiers_active ON workforce.practitioner_identifiers (organization_id, system_uri, value)
    WHERE active AND unique_value;
CREATE INDEX idx_practitioner_identifiers_practitioner_id ON workforce.practitioner_identifiers (practitioner_id);

-- What a practitioner does where: role and specialty at a facility (optionally a location), for a period. SIP is
-- facility-specific in Indonesia, so the licence identifier can be referenced per role.
CREATE TABLE workforce.practitioner_roles (
    id                 uuid        NOT NULL DEFAULT uuidv7(),
    organization_id    uuid        NOT NULL,
    practitioner_id    uuid        NOT NULL,
    facility_id        uuid        NOT NULL,
    location_id        uuid,
    role_system        text        NOT NULL,
    role_code          text        NOT NULL,
    role_display       text,
    specialty_system   text,
    specialty_code     text,
    specialty_display  text,
    licence_identifier_id uuid,
    period_start       date        NOT NULL,
    period_end         date,
    active             boolean     NOT NULL DEFAULT true,
    version            integer     NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    last_xact_id       xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_practitioner_roles PRIMARY KEY (id),
    CONSTRAINT fk_practitioner_roles_practitioner FOREIGN KEY (practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_practitioner_roles_facility FOREIGN KEY (facility_id, organization_id)
        REFERENCES platform.facilities (id, organization_id),
    CONSTRAINT fk_practitioner_roles_location FOREIGN KEY (location_id, facility_id) REFERENCES platform.locations (id, facility_id),
    CONSTRAINT fk_practitioner_roles_role_system FOREIGN KEY (role_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_practitioner_roles_specialty_system FOREIGN KEY (specialty_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_practitioner_roles_licence_identifier FOREIGN KEY (licence_identifier_id, practitioner_id)
        REFERENCES workforce.practitioner_identifiers (id, practitioner_id),
    CONSTRAINT ck_practitioner_roles_role_code CHECK (length(role_code) BETWEEN 1 AND 100),
    CONSTRAINT ck_practitioner_roles_role_display CHECK (length(role_display) <= 500),
    CONSTRAINT ck_practitioner_roles_specialty CHECK ((specialty_system IS NULL) = (specialty_code IS NULL)
                                                      AND length(specialty_code) <= 100 AND length(specialty_display) <= 500),
    CONSTRAINT ck_practitioner_roles_period CHECK (period_end IS NULL OR period_end >= period_start)
);
COMMENT ON TABLE workforce.practitioner_roles IS 'Practitioner role and specialty at a facility for a period (FHIR PractitionerRole)';
CREATE INDEX idx_practitioner_roles_practitioner_id ON workforce.practitioner_roles (practitioner_id);
CREATE INDEX idx_practitioner_roles_facility_id ON workforce.practitioner_roles (facility_id) WHERE active;

-- Identifier values must fit their system: allowed resource type, format, no placeholder values. Shared with
-- patient identifiers (0010). Sets unique_value from the system so uniqueness is enforced by a partial index.
CREATE FUNCTION terminology.check_identifier() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    s terminology.identifier_systems;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        NEW.unique_value := OLD.unique_value;  -- system and value are fixed columns; uniqueness cannot be switched off
        RETURN NEW;
    END IF;
    SELECT * INTO s FROM terminology.identifier_systems x WHERE x.uri = NEW.system_uri;
    IF NOT FOUND THEN
        RETURN NEW;  -- the foreign key reports the unknown system
    END IF;
    IF s.status <> 'active' THEN
        RAISE EXCEPTION 'identifier system % is retired', NEW.system_uri USING ERRCODE = '23514';
    END IF;
    IF NOT (TG_ARGV[0] = ANY (s.applies_to)) THEN
        RAISE EXCEPTION 'identifier system % does not apply to %', NEW.system_uri, TG_ARGV[0] USING ERRCODE = '23514';
    END IF;
    IF s.value_pattern IS NOT NULL AND NEW.value !~ s.value_pattern THEN
        RAISE EXCEPTION 'identifier value does not match the format of %', NEW.system_uri USING ERRCODE = '23514';
    END IF;
    IF NEW.value = ANY (s.excluded_values) THEN
        RAISE EXCEPTION 'placeholder value for % means "no identifier" and is not stored', NEW.system_uri USING ERRCODE = '23514';
    END IF;
    NEW.unique_value := s.unique_value;
    RETURN NEW;
END
$$;
COMMENT ON FUNCTION terminology.check_identifier() IS 'Validates identifier values against terminology.identifier_systems';

CREATE TRIGGER trg_practitioner_identifiers_check BEFORE INSERT OR UPDATE ON workforce.practitioner_identifiers
    FOR EACH ROW EXECUTE FUNCTION terminology.check_identifier('Practitioner');
-- A wrong identifier is deactivated and a new row added: system and value never change (fixed columns below).

SELECT hms_meta.enable_versioned_record('workforce.practitioners', 'Practitioner', NULL, 'id,organization_id');
SELECT hms_meta.enable_versioned_record('workforce.practitioner_identifiers', 'Practitioner.identifier', NULL,
                                        'id,organization_id,practitioner_id,system_uri,value', '', 'workforce.practitioners', 'practitioner_id');
SELECT hms_meta.enable_versioned_record('workforce.practitioner_roles', 'PractitionerRole', NULL,
                                        'id,organization_id,practitioner_id');

GRANT USAGE ON SCHEMA workforce TO hms_workforce_rw, hms_audit_read;
GRANT SELECT, INSERT ON workforce.practitioners, workforce.practitioner_identifiers, workforce.practitioner_roles
    TO hms_workforce_rw;
GRANT UPDATE (user_id, display_name, administrative_gender, active) ON workforce.practitioners TO hms_workforce_rw;
GRANT UPDATE (period_start, period_end, active) ON workforce.practitioner_identifiers TO hms_workforce_rw;
GRANT UPDATE (location_id, role_display, specialty_system, specialty_code, specialty_display, licence_identifier_id,
              period_end, active) ON workforce.practitioner_roles TO hms_workforce_rw;
GRANT SELECT ON workforce.resource_versions TO hms_workforce_rw;
-- Audit review: who was which practitioner, with which licence and role, when.
GRANT SELECT ON workforce.practitioners, workforce.practitioner_identifiers, workforce.practitioner_roles,
    workforce.resource_versions TO hms_audit_read;
