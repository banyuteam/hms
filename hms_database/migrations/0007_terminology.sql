-- 0007 terminology: code systems and their releases, concepts, value sets, concept maps, element bindings and
-- identifier systems (schema terminology, ADR-DB-004).
-- Owner: hms_database (definitions); writes: hms_services terminology import/governance (hms_terminology_rw);
-- reads: every clinical module, reporting. Classification: internal (reference data, no PHI).
-- Coded clinical columns elsewhere are (system, code, display) triplets whose system must be registered here, so
-- every code names its code system even when that system's content (e.g. SNOMED CT) is not loaded. Releases are
-- imported with provenance and licence terms, approved, and never edited afterwards; a correction is a new release.
-- No code lists are invented here: national value sets (Kepmenkes 1423/2022, SATUSEHAT) are loaded as releases from
-- their official source with checksum.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA terminology;
COMMENT ON SCHEMA terminology IS 'hms_database: code systems, releases, value sets, concept maps, identifier systems';

CREATE TABLE terminology.code_systems (
    id            uuid        NOT NULL DEFAULT uuidv7(),
    uri           text        NOT NULL,
    name          text        NOT NULL,
    publisher     text        NOT NULL,
    scope         text        NOT NULL,
    licence_note  text,
    status        text        NOT NULL DEFAULT 'active',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_code_systems PRIMARY KEY (id),
    CONSTRAINT uq_code_systems_uri UNIQUE (uri),
    CONSTRAINT ck_code_systems_uri CHECK (uri ~ '^(https?://|urn:)[^[:space:]]{3,250}$'),
    CONSTRAINT ck_code_systems_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_code_systems_publisher CHECK (length(btrim(publisher)) BETWEEN 1 AND 200),
    CONSTRAINT ck_code_systems_scope CHECK (scope IN ('international', 'national', 'local', 'legacy')),
    CONSTRAINT ck_code_systems_licence_note CHECK (length(licence_note) <= 1000),
    CONSTRAINT ck_code_systems_status CHECK (status IN ('active', 'retired'))
);
COMMENT ON TABLE terminology.code_systems IS
    'Registered code systems (canonical URI); coded columns reference uri. Content may or may not be loaded';
COMMENT ON COLUMN terminology.code_systems.scope IS 'international (LOINC, SNOMED CT, ICD), national (Kemenkes), local (HMS), legacy (Khanza codes)';

-- One imported release (version) of a code system, with provenance. Lifecycle: draft (concepts may be loaded) ->
-- approved (immutable) -> retired; or draft -> rejected. Effective dates decide which approved release applies.
CREATE TABLE terminology.code_system_releases (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    code_system_id       uuid        NOT NULL,
    version              text        NOT NULL,
    published_on         date,
    effective_from       date        NOT NULL,
    effective_until      date,
    source_reference     text        NOT NULL,
    artifact_sha256      bytea       NOT NULL,
    licence_terms        text,
    import_tool_version  text        NOT NULL,
    imported_at          timestamptz NOT NULL DEFAULT now(),
    concept_count        integer,
    status               text        NOT NULL DEFAULT 'draft',
    approved_at          timestamptz,
    approved_by_user_id  uuid,
    status_reason        text,
    CONSTRAINT pk_code_system_releases PRIMARY KEY (id),
    CONSTRAINT uq_code_system_releases_version UNIQUE (code_system_id, version),
    CONSTRAINT fk_code_system_releases_code_system_id FOREIGN KEY (code_system_id) REFERENCES terminology.code_systems (id),
    CONSTRAINT fk_code_system_releases_approved_by_user_id FOREIGN KEY (approved_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_code_system_releases_version CHECK (length(btrim(version)) BETWEEN 1 AND 64),
    CONSTRAINT ck_code_system_releases_effective CHECK (effective_until IS NULL OR effective_until > effective_from),
    CONSTRAINT ck_code_system_releases_source_reference CHECK (length(btrim(source_reference)) BETWEEN 1 AND 500),
    CONSTRAINT ck_code_system_releases_sha256 CHECK (octet_length(artifact_sha256) = 32),
    CONSTRAINT ck_code_system_releases_licence_terms CHECK (length(licence_terms) <= 2000),
    CONSTRAINT ck_code_system_releases_tool CHECK (length(btrim(import_tool_version)) BETWEEN 1 AND 100),
    CONSTRAINT ck_code_system_releases_concept_count CHECK (concept_count >= 0),
    CONSTRAINT ck_code_system_releases_status CHECK (status IN ('draft', 'approved', 'retired', 'rejected')),
    CONSTRAINT ck_code_system_releases_approved CHECK (
        (status IN ('approved', 'retired')) = (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL)),
    CONSTRAINT ck_code_system_releases_status_reason CHECK (length(status_reason) <= 500)
);
COMMENT ON TABLE terminology.code_system_releases IS
    'Imported release of a code system with source, checksum, licence and approval; approved releases are immutable';
COMMENT ON COLUMN terminology.code_system_releases.source_reference IS 'Where the artifact came from (publication, file name); no credentials';

CREATE TABLE terminology.concepts (
    release_id   uuid    NOT NULL,
    code         text    NOT NULL,
    display      text    NOT NULL,
    parent_code  text,
    is_active    boolean NOT NULL DEFAULT true,
    properties   jsonb   NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT pk_concepts PRIMARY KEY (release_id, code),
    CONSTRAINT fk_concepts_release_id FOREIGN KEY (release_id) REFERENCES terminology.code_system_releases (id),
    CONSTRAINT ck_concepts_code CHECK (length(code) BETWEEN 1 AND 100 AND code = btrim(code)),
    CONSTRAINT ck_concepts_display CHECK (length(btrim(display)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_concepts_parent_code CHECK (length(parent_code) BETWEEN 1 AND 100),
    CONSTRAINT ck_concepts_properties CHECK (jsonb_typeof(properties) = 'object' AND octet_length(properties::text) <= 8192)
);
COMMENT ON TABLE terminology.concepts IS 'Concepts of one release; loaded while the release is draft, immutable after';
CREATE INDEX idx_concepts_code ON terminology.concepts (code);

-- A value set: the codes allowed for a coded element (e.g. Kepmenkes 1423 religion codes). Members are fixed once
-- the value set version is active.
CREATE TABLE terminology.value_sets (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    uri                  text        NOT NULL,
    version              text        NOT NULL,
    name                 text        NOT NULL,
    purpose              text,
    source_reference     text        NOT NULL,
    status               text        NOT NULL DEFAULT 'draft',
    approved_at          timestamptz,
    approved_by_user_id  uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_value_sets PRIMARY KEY (id),
    CONSTRAINT uq_value_sets_uri_version UNIQUE (uri, version),
    CONSTRAINT fk_value_sets_approved_by_user_id FOREIGN KEY (approved_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_value_sets_uri CHECK (uri ~ '^(https?://|urn:)[^[:space:]]{3,250}$'),
    CONSTRAINT ck_value_sets_version CHECK (length(btrim(version)) BETWEEN 1 AND 64),
    CONSTRAINT ck_value_sets_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_value_sets_purpose CHECK (length(purpose) <= 1000),
    CONSTRAINT ck_value_sets_source_reference CHECK (length(btrim(source_reference)) BETWEEN 1 AND 500),
    CONSTRAINT ck_value_sets_status CHECK (status IN ('draft', 'active', 'retired')),
    CONSTRAINT ck_value_sets_approved CHECK ((status IN ('active', 'retired')) = (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL))
);
COMMENT ON TABLE terminology.value_sets IS 'Versioned value set (allowed codes for an element); members fixed once active';

CREATE TABLE terminology.value_set_members (
    value_set_id  uuid NOT NULL,
    system_uri    text NOT NULL,
    code          text NOT NULL,
    display       text NOT NULL,
    CONSTRAINT pk_value_set_members PRIMARY KEY (value_set_id, system_uri, code),
    CONSTRAINT fk_value_set_members_value_set_id FOREIGN KEY (value_set_id) REFERENCES terminology.value_sets (id),
    CONSTRAINT fk_value_set_members_system_uri FOREIGN KEY (system_uri) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_value_set_members_code CHECK (length(code) BETWEEN 1 AND 100 AND code = btrim(code)),
    CONSTRAINT ck_value_set_members_display CHECK (length(btrim(display)) BETWEEN 1 AND 1000)
);
COMMENT ON TABLE terminology.value_set_members IS 'Codes in a value set version';

-- Which value set governs a coded element, e.g. element Patient.religion -> Kepmenkes 1423 religion value set.
-- hms_services validates writes against the binding in force; strength follows FHIR binding strength.
CREATE TABLE terminology.element_bindings (
    id              uuid        NOT NULL DEFAULT uuidv7(),
    element         text        NOT NULL,
    value_set_id    uuid        NOT NULL,
    strength        text        NOT NULL,
    effective_from  date        NOT NULL,
    effective_until date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_element_bindings PRIMARY KEY (id),
    CONSTRAINT fk_element_bindings_value_set_id FOREIGN KEY (value_set_id) REFERENCES terminology.value_sets (id),
    CONSTRAINT ck_element_bindings_element CHECK (element ~ '^[A-Z][A-Za-z]{1,63}(\.[a-z][A-Za-z0-9]{0,63}){1,5}$'),
    CONSTRAINT ck_element_bindings_strength CHECK (strength IN ('required', 'extensible', 'preferred', 'example')),
    CONSTRAINT ck_element_bindings_effective CHECK (effective_until IS NULL OR effective_until > effective_from)
);
COMMENT ON TABLE terminology.element_bindings IS 'Value set bound to a coded element (FHIR-style path) for a period';
COMMENT ON COLUMN terminology.element_bindings.element IS 'Resource element path, e.g. Patient.religion, Condition.code';
CREATE UNIQUE INDEX uq_element_bindings_open ON terminology.element_bindings (element) WHERE effective_until IS NULL;

-- Translation between code systems (e.g. legacy Khanza diagnosis codes -> ICD-10, ICD-10 -> SNOMED CT).
CREATE TABLE terminology.concept_maps (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    uri                  text        NOT NULL,
    version              text        NOT NULL,
    name                 text        NOT NULL,
    source_system_uri    text        NOT NULL,
    target_system_uri    text        NOT NULL,
    purpose              text,
    status               text        NOT NULL DEFAULT 'draft',
    approved_at          timestamptz,
    approved_by_user_id  uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_concept_maps PRIMARY KEY (id),
    CONSTRAINT uq_concept_maps_uri_version UNIQUE (uri, version),
    CONSTRAINT fk_concept_maps_source_system_uri FOREIGN KEY (source_system_uri) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_concept_maps_target_system_uri FOREIGN KEY (target_system_uri) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_concept_maps_approved_by_user_id FOREIGN KEY (approved_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_concept_maps_uri CHECK (uri ~ '^(https?://|urn:)[^[:space:]]{3,250}$'),
    CONSTRAINT ck_concept_maps_version CHECK (length(btrim(version)) BETWEEN 1 AND 64),
    CONSTRAINT ck_concept_maps_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_concept_maps_systems CHECK (source_system_uri <> target_system_uri),
    CONSTRAINT ck_concept_maps_purpose CHECK (length(purpose) <= 1000),
    CONSTRAINT ck_concept_maps_status CHECK (status IN ('draft', 'active', 'retired')),
    CONSTRAINT ck_concept_maps_approved CHECK ((status IN ('active', 'retired')) = (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL))
);
COMMENT ON TABLE terminology.concept_maps IS 'Versioned map between two code systems; elements fixed once active';

CREATE TABLE terminology.concept_map_elements (
    id              bigint GENERATED ALWAYS AS IDENTITY,
    concept_map_id  uuid   NOT NULL,
    source_code     text   NOT NULL,
    target_code     text,
    equivalence     text   NOT NULL,
    comment         text,
    CONSTRAINT pk_concept_map_elements PRIMARY KEY (id),
    CONSTRAINT fk_concept_map_elements_concept_map_id FOREIGN KEY (concept_map_id) REFERENCES terminology.concept_maps (id),
    CONSTRAINT uq_concept_map_elements UNIQUE NULLS NOT DISTINCT (concept_map_id, source_code, target_code),
    CONSTRAINT ck_concept_map_elements_source_code CHECK (length(source_code) BETWEEN 1 AND 100),
    CONSTRAINT ck_concept_map_elements_target_code CHECK (length(target_code) BETWEEN 1 AND 100),
    -- FHIR R4 ConceptMapEquivalence.
    CONSTRAINT ck_concept_map_elements_equivalence CHECK (equivalence IN
        ('relatedto', 'equivalent', 'equal', 'wider', 'subsumes', 'narrower', 'specializes', 'inexact', 'unmatched', 'disjoint')),
    CONSTRAINT ck_concept_map_elements_unmatched CHECK ((equivalence = 'unmatched') = (target_code IS NULL)),
    CONSTRAINT ck_concept_map_elements_comment CHECK (length(comment) <= 1000)
);
COMMENT ON TABLE terminology.concept_map_elements IS 'One source->target correspondence (FHIR R4 equivalence)';

-- Identifier namespaces for patients, practitioners and other records (NIK, IHS number, medical record number,
-- passport, BPJS member number, legacy keys). value_pattern is enforced on write; unique_value makes one value
-- identify at most one active record per organization.
CREATE TABLE terminology.identifier_systems (
    id             uuid        NOT NULL DEFAULT uuidv7(),
    uri            text        NOT NULL,
    name           text        NOT NULL,
    applies_to     text[]      NOT NULL,
    kind           text        NOT NULL,
    value_pattern  text,
    excluded_values text[]     NOT NULL DEFAULT '{}',
    unique_value   boolean     NOT NULL,
    sensitivity    text        NOT NULL,
    status         text        NOT NULL DEFAULT 'active',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_identifier_systems PRIMARY KEY (id),
    CONSTRAINT uq_identifier_systems_uri UNIQUE (uri),
    CONSTRAINT ck_identifier_systems_uri CHECK (uri ~ '^(https?://|urn:)[^[:space:]]{3,250}$'),
    CONSTRAINT ck_identifier_systems_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_identifier_systems_applies_to CHECK (cardinality(applies_to) >= 1
        AND applies_to <@ ARRAY['Patient', 'Practitioner', 'Organization', 'Location', 'Encounter', 'ImagingStudy']),
    CONSTRAINT ck_identifier_systems_kind CHECK (kind IN
        ('national_person_id', 'national_registry_id', 'medical_record_number', 'insurance_member_id',
         'travel_document', 'family_registration', 'professional_licence', 'facility_record_id', 'legacy_key')),
    CONSTRAINT ck_identifier_systems_value_pattern CHECK (length(value_pattern) BETWEEN 2 AND 200),
    CONSTRAINT ck_identifier_systems_sensitivity CHECK (sensitivity IN ('confidential', 'restricted')),
    CONSTRAINT ck_identifier_systems_status CHECK (status IN ('active', 'retired'))
);
COMMENT ON TABLE terminology.identifier_systems IS
    'Identifier namespaces (NIK, IHS number, MRN, passport, member numbers, licences, legacy keys) with format rules';
COMMENT ON COLUMN terminology.identifier_systems.value_pattern IS 'Anchored POSIX regex every value must match, e.g. ^[0-9]{16}$';
COMMENT ON COLUMN terminology.identifier_systems.excluded_values IS
    'Placeholder values that mean "no identifier" and are never stored (Kepmenkes 1423/2022: NIK 9999999999999999)';
COMMENT ON COLUMN terminology.identifier_systems.unique_value IS 'true: a value identifies at most one active record per organization';
COMMENT ON COLUMN terminology.identifier_systems.sensitivity IS 'restricted: national/person identifiers (masked by default in APIs)';

CREATE TRIGGER trg_code_systems_touch_updated_at BEFORE UPDATE ON terminology.code_systems
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();
CREATE TRIGGER trg_identifier_systems_touch_updated_at BEFORE UPDATE ON terminology.identifier_systems
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();

-- Content guards: concepts, members and map elements change only while their container is draft, and an approved or
-- active container's identifying fields never change.
CREATE FUNCTION terminology.guard_release_content() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    parent_status text;
BEGIN
    IF TG_TABLE_NAME = 'concepts' THEN
        SELECT r.status INTO parent_status FROM terminology.code_system_releases r
        WHERE r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.release_id ELSE NEW.release_id END;
    ELSIF TG_TABLE_NAME = 'value_set_members' THEN
        SELECT v.status INTO parent_status FROM terminology.value_sets v
        WHERE v.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.value_set_id ELSE NEW.value_set_id END;
    ELSE
        SELECT m.status INTO parent_status FROM terminology.concept_maps m
        WHERE m.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.concept_map_id ELSE NEW.concept_map_id END;
    END IF;
    IF parent_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'terminology.%: content of a % container cannot change (publish a new version)',
            TG_TABLE_NAME, coalesce(parent_status, 'missing');
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'concepts' THEN
        IF NEW.release_id <> OLD.release_id THEN
            RAISE EXCEPTION 'terminology.concepts: a concept cannot move to another release';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER trg_concepts_guard BEFORE INSERT OR UPDATE OR DELETE ON terminology.concepts
    FOR EACH ROW EXECUTE FUNCTION terminology.guard_release_content();
CREATE TRIGGER trg_value_set_members_guard BEFORE INSERT OR UPDATE OR DELETE ON terminology.value_set_members
    FOR EACH ROW EXECUTE FUNCTION terminology.guard_release_content();
CREATE TRIGGER trg_concept_map_elements_guard BEFORE INSERT OR UPDATE OR DELETE ON terminology.concept_map_elements
    FOR EACH ROW EXECUTE FUNCTION terminology.guard_release_content();

-- Lifecycle of releases, value sets and concept maps: draft -> approved/active -> retired, draft -> rejected; once
-- out of draft only status, status_reason and effective_until may change.
CREATE FUNCTION terminology.guard_lifecycle() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    o jsonb := to_jsonb(OLD) - ARRAY['status', 'status_reason', 'effective_until', 'approved_at', 'approved_by_user_id'];
    n jsonb := to_jsonb(NEW) - ARRAY['status', 'status_reason', 'effective_until', 'approved_at', 'approved_by_user_id'];
BEGIN
    IF OLD.status <> 'draft' AND n IS DISTINCT FROM o THEN
        RAISE EXCEPTION 'terminology.%: % row % is no longer draft; only its status may change', TG_TABLE_NAME, OLD.status, OLD.id;
    END IF;
    IF OLD.status <> 'draft' AND (to_jsonb(NEW)->'approved_at', to_jsonb(NEW)->'approved_by_user_id')
                                  IS DISTINCT FROM (to_jsonb(OLD)->'approved_at', to_jsonb(OLD)->'approved_by_user_id') THEN
        RAISE EXCEPTION 'terminology.%: approval of row % cannot change', TG_TABLE_NAME, OLD.id;
    END IF;
    IF NOT ((OLD.status = NEW.status)
            OR (OLD.status = 'draft' AND NEW.status IN ('approved', 'active', 'rejected'))
            OR (OLD.status IN ('approved', 'active') AND NEW.status = 'retired')) THEN
        RAISE EXCEPTION 'terminology.%: status % -> % is not allowed', TG_TABLE_NAME, OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER trg_code_system_releases_lifecycle BEFORE UPDATE ON terminology.code_system_releases
    FOR EACH ROW EXECUTE FUNCTION terminology.guard_lifecycle();
CREATE TRIGGER trg_value_sets_lifecycle BEFORE UPDATE ON terminology.value_sets
    FOR EACH ROW EXECUTE FUNCTION terminology.guard_lifecycle();
CREATE TRIGGER trg_concept_maps_lifecycle BEFORE UPDATE ON terminology.concept_maps
    FOR EACH ROW EXECUTE FUNCTION terminology.guard_lifecycle();

-- Registry of well-known international code systems (canonical URIs from HL7 FHIR R4 and the publishers). This
-- registers names only; no concept content is loaded. National and local systems are added by governance once their
-- official URIs are confirmed (documentation/standards-traceability.md).
INSERT INTO terminology.code_systems (uri, name, publisher, scope, licence_note) VALUES
    ('http://loinc.org', 'LOINC', 'Regenstrief Institute', 'international', 'LOINC licence terms apply'),
    ('http://snomed.info/sct', 'SNOMED CT', 'SNOMED International', 'international',
     'Use requires SNOMED CT licensing (member country or affiliate licence); confirm before loading content'),
    ('http://hl7.org/fhir/sid/icd-10', 'ICD-10', 'World Health Organization', 'international',
     'Edition in national use to be confirmed by coding governance'),
    ('http://hl7.org/fhir/sid/icd-9-cm', 'ICD-9-CM', 'NCHS / CMS', 'international',
     'Procedure classification; edition in national use to be confirmed by coding governance'),
    ('http://unitsofmeasure.org', 'UCUM', 'Regenstrief Institute', 'international', NULL),
    ('http://dicom.nema.org/resources/ontology/DCM', 'DICOM Controlled Terminology', 'NEMA', 'international', NULL),
    ('urn:iso:std:iso:3166', 'ISO 3166-1 country codes', 'ISO', 'international', NULL),
    ('urn:ietf:bcp:47', 'IETF BCP 47 language tags', 'IETF', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/v3-ActCode', 'HL7 v3 ActCode', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/v3-ParticipationType', 'HL7 v3 ParticipationType', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/v3-MaritalStatus', 'HL7 v3 MaritalStatus', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/v3-RoleCode', 'HL7 v3 RoleCode', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', 'HL7 v3 ObservationInterpretation', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/v3-DataOperation', 'HL7 v3 DataOperation', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/v2-0131', 'HL7 v2 Contact Role', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/v2-0203', 'HL7 v2 Identifier Type', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/observation-category', 'Observation Category', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/data-absent-reason', 'Data Absent Reason', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/diagnosis-role', 'Diagnosis Role', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/provenance-participant-type', 'Provenance Participant Type', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/consentcategorycodes', 'Consent Category Codes', 'HL7 International', 'international', NULL),
    ('http://terminology.hl7.org/CodeSystem/location-physical-type', 'Location Physical Type', 'HL7 International', 'international', NULL),
    -- SATUSEHAT Medication.code system (satusehat.kemkes.go.id/platform/docs, Medication resource).
    ('http://sys-ids.kemkes.go.id/kfa', 'Kamus Farmasi dan Alat Kesehatan (KFA)', 'Kementerian Kesehatan RI', 'national', NULL);

-- Identifier systems confirmed in the SATUSEHAT FHIR R4 documentation (Patient and Practitioner onboarding APIs) and
-- Kepmenkes HK.01.07/MENKES/1423/2022 (NIK: 16 digits, 9999999999999999 when absent). The IHS-number URI and the
-- organization-specific systems (MRN, encounter, location) are registered by governance after confirmation.
INSERT INTO terminology.identifier_systems (uri, name, applies_to, kind, value_pattern, excluded_values, unique_value, sensitivity) VALUES
    ('https://fhir.kemkes.go.id/id/nik', 'Nomor Induk Kependudukan (NIK)', ARRAY['Patient', 'Practitioner'],
     'national_person_id', '^[0-9]{16}$', ARRAY['9999999999999999'], true, 'restricted'),
    ('https://fhir.kemkes.go.id/id/nik-ibu', 'NIK ibu (newborn identification by the mother''s NIK)', ARRAY['Patient'],
     'national_person_id', '^[0-9]{16}$', ARRAY['9999999999999999'], false, 'restricted'),
    ('https://fhir.kemkes.go.id/id/paspor', 'Nomor paspor', ARRAY['Patient'], 'travel_document', NULL, '{}', true, 'restricted'),
    ('https://fhir.kemkes.go.id/id/kk', 'Nomor Kartu Keluarga', ARRAY['Patient'], 'family_registration', NULL, '{}', false, 'restricted');

GRANT USAGE ON SCHEMA terminology TO hms_terminology_rw, hms_report_read;
GRANT SELECT, INSERT, UPDATE ON terminology.code_systems, terminology.code_system_releases, terminology.value_sets,
    terminology.concept_maps, terminology.identifier_systems, terminology.element_bindings TO hms_terminology_rw;
-- Draft content may be reloaded; the guards refuse it once the container leaves draft.
GRANT SELECT, INSERT, UPDATE, DELETE ON terminology.concepts, terminology.value_set_members,
    terminology.concept_map_elements TO hms_terminology_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA terminology TO hms_report_read;
