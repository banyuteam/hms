-- 0008 platform locations: physical places of a facility (building, ward, room, bed, clinic room) used by encounters,
-- practitioner roles and imaging (schema platform, ADR-DB-004). Maps to FHIR Location; SATUSEHAT registers each
-- location under the organization's own identifier system.
-- Owner: hms_database (definitions); writes: hms_services platform module (hms_platform_rw); reads: hms_services,
-- reporting. Classification: internal (no PHI).
-- Departments (FHIR Organization sub-units) are not modeled here yet: they need the department catalog and its
-- mapping to legacy codes first (ADR-DB-003 deferred department scope).
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE TABLE platform.locations (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    facility_id      uuid        NOT NULL,
    parent_id        uuid,
    code             text        NOT NULL,
    name             text        NOT NULL,
    physical_type    text        NOT NULL,
    description      text,
    status           text        NOT NULL DEFAULT 'active',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_locations PRIMARY KEY (id),
    CONSTRAINT uq_locations_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT uq_locations_id_facility_id UNIQUE (id, facility_id),
    CONSTRAINT uq_locations_facility_id_code UNIQUE (facility_id, code),
    CONSTRAINT fk_locations_facility FOREIGN KEY (facility_id, organization_id) REFERENCES platform.facilities (id, organization_id),
    -- A parent is a location of the same facility.
    CONSTRAINT fk_locations_parent FOREIGN KEY (parent_id, facility_id) REFERENCES platform.locations (id, facility_id),
    CONSTRAINT ck_locations_parent CHECK (parent_id <> id),
    CONSTRAINT ck_locations_code CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,31}$'),
    CONSTRAINT ck_locations_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    -- HL7 location-physical-type (http://terminology.hl7.org/CodeSystem/location-physical-type).
    CONSTRAINT ck_locations_physical_type CHECK (physical_type IN
        ('si', 'bu', 'wi', 'wa', 'lvl', 'co', 'ro', 'bd', 've', 'ho', 'ca', 'rd', 'area', 'jdn')),
    CONSTRAINT ck_locations_description CHECK (length(description) <= 1000),
    -- FHIR R4 Location.status.
    CONSTRAINT ck_locations_status CHECK (status IN ('active', 'suspended', 'inactive'))
);
COMMENT ON TABLE platform.locations IS 'Physical location in a facility (FHIR Location); deactivate, never delete';
COMMENT ON COLUMN platform.locations.physical_type IS 'HL7 location-physical-type code: si site, bu building, wa ward, ro room, bd bed, ...';
CREATE INDEX idx_locations_parent_id ON platform.locations (parent_id) WHERE parent_id IS NOT NULL;

CREATE TRIGGER trg_locations_touch_updated_at BEFORE UPDATE ON platform.locations
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();

GRANT SELECT, INSERT ON platform.locations TO hms_platform_rw;
GRANT UPDATE (parent_id, name, physical_type, description, status) ON platform.locations TO hms_platform_rw;
GRANT SELECT ON platform.locations TO hms_report_read;
