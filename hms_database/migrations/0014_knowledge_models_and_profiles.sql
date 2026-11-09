-- 0014 knowledge: governed clinical models and conformance artifacts (schema knowledge, ADR-DB-004):
--   openEHR archetypes and templates used for structured clinical documents (two-level modelling),
--   semantic bindings from template paths to FHIR elements, relational CDM columns and terminology codes,
--   FHIR StructureDefinition profiles (e.g. SATUSEHAT) that exchanged resources are validated against.
-- Owner: hms_database (definitions); writes: hms_services knowledge governance (hms_terminology_rw); reads: clinical
-- modules, interoperability, reporting. Classification: internal (no PHI).
-- The artifacts themselves (ADL, OPT, StructureDefinition JSON) live in source control or object storage; this schema
-- holds identity, version, checksum, lifecycle and approval. Approved artifacts are immutable; a change is a new
-- version. Nothing here executes: bindings are declarative data validated by hms_services.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA knowledge;
COMMENT ON SCHEMA knowledge IS 'hms_database: openEHR archetypes/templates, semantic bindings, FHIR profiles';

-- openEHR archetype, identified per openEHR AM (e.g. openEHR-EHR-OBSERVATION.blood_pressure.v2; only the major
-- version is in the id, the full semantic version is semver).
CREATE TABLE knowledge.archetypes (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    archetype_id         text        NOT NULL,
    semver               text        NOT NULL,
    rm_class             text        NOT NULL,
    adl_version          text        NOT NULL,
    source_lifecycle     text        NOT NULL,
    source_reference     text        NOT NULL,
    artifact_sha256      bytea       NOT NULL,
    status               text        NOT NULL DEFAULT 'draft',
    status_reason        text,
    approved_at          timestamptz,
    approved_by_user_id  uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_archetypes PRIMARY KEY (id),
    CONSTRAINT uq_archetypes_archetype_id_semver UNIQUE (archetype_id, semver),
    CONSTRAINT fk_archetypes_approved_by_user_id FOREIGN KEY (approved_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_archetypes_archetype_id CHECK (archetype_id ~
        '^([a-z][a-z0-9_.]*::)?[A-Za-z][A-Za-z0-9_]*-[A-Za-z][A-Za-z0-9_]*-[A-Z][A-Z_]*\.[a-z][a-z0-9_-]*(-[a-z0-9_-]+)*\.v[0-9]+$'),
    CONSTRAINT ck_archetypes_semver CHECK (semver ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$'),
    CONSTRAINT ck_archetypes_rm_class CHECK (rm_class ~ '^[A-Z][A-Z_]{1,63}$'),
    CONSTRAINT ck_archetypes_adl_version CHECK (adl_version IN ('1.4', '2')),
    CONSTRAINT ck_archetypes_source_lifecycle CHECK (source_lifecycle IN
        ('unmanaged', 'in_development', 'draft', 'published', 'deprecated', 'rejected', 'obsolete')),
    CONSTRAINT ck_archetypes_source_reference CHECK (length(btrim(source_reference)) BETWEEN 1 AND 500),
    CONSTRAINT ck_archetypes_sha256 CHECK (octet_length(artifact_sha256) = 32),
    CONSTRAINT ck_archetypes_status CHECK (status IN ('draft', 'approved', 'retired', 'rejected')),
    CONSTRAINT ck_archetypes_status_reason CHECK (length(status_reason) <= 500),
    CONSTRAINT ck_archetypes_approved CHECK ((status IN ('approved', 'retired')) = (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL))
);
COMMENT ON TABLE knowledge.archetypes IS 'openEHR archetype adopted locally (identity, version, checksum, approval)';
COMMENT ON COLUMN knowledge.archetypes.source_lifecycle IS 'Lifecycle at the source (e.g. CKM published); status is local adoption';
COMMENT ON COLUMN knowledge.archetypes.source_reference IS 'Origin, e.g. CKM URL or repository path of the ADL file';

-- openEHR operational template: the form/document definition a structured composition conforms to.
CREATE TABLE knowledge.templates (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    template_id          text        NOT NULL,
    version              text        NOT NULL,
    name                 text        NOT NULL,
    purpose              text,
    rm_release           text        NOT NULL,
    source_reference     text        NOT NULL,
    artifact_sha256      bytea       NOT NULL,
    status               text        NOT NULL DEFAULT 'draft',
    status_reason        text,
    approved_at          timestamptz,
    approved_by_user_id  uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_templates PRIMARY KEY (id),
    CONSTRAINT uq_templates_template_id_version UNIQUE (template_id, version),
    CONSTRAINT fk_templates_approved_by_user_id FOREIGN KEY (approved_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_templates_template_id CHECK (length(btrim(template_id)) BETWEEN 1 AND 200),
    CONSTRAINT ck_templates_version CHECK (length(btrim(version)) BETWEEN 1 AND 64),
    CONSTRAINT ck_templates_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_templates_purpose CHECK (length(purpose) <= 1000),
    CONSTRAINT ck_templates_rm_release CHECK (rm_release ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
    CONSTRAINT ck_templates_source_reference CHECK (length(btrim(source_reference)) BETWEEN 1 AND 500),
    CONSTRAINT ck_templates_sha256 CHECK (octet_length(artifact_sha256) = 32),
    CONSTRAINT ck_templates_status CHECK (status IN ('draft', 'active', 'retired', 'rejected')),
    CONSTRAINT ck_templates_status_reason CHECK (length(status_reason) <= 500),
    CONSTRAINT ck_templates_approved CHECK ((status IN ('active', 'retired')) = (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL))
);
COMMENT ON TABLE knowledge.templates IS 'openEHR operational template version; compositions with structured content reference it';
COMMENT ON COLUMN knowledge.templates.rm_release IS 'openEHR Reference Model release, e.g. 1.1.0';

CREATE TABLE knowledge.template_archetypes (
    template_id   uuid NOT NULL,
    archetype_id  uuid NOT NULL,
    CONSTRAINT pk_template_archetypes PRIMARY KEY (template_id, archetype_id),
    CONSTRAINT fk_template_archetypes_template_id FOREIGN KEY (template_id) REFERENCES knowledge.templates (id),
    CONSTRAINT fk_template_archetypes_archetype_id FOREIGN KEY (archetype_id) REFERENCES knowledge.archetypes (id)
);
COMMENT ON TABLE knowledge.template_archetypes IS 'Archetypes a template version uses';
CREATE INDEX idx_template_archetypes_archetype_id ON knowledge.template_archetypes (archetype_id);

-- Semantic binding of one template data point: where it lives in the canonical relational model, which FHIR element it
-- maps to for exchange, and which terminology concept defines it. Enables projecting structured documents into the
-- clinical tables and FHIR without guessing meaning.
CREATE TABLE knowledge.template_bindings (
    id              bigint GENERATED ALWAYS AS IDENTITY,
    template_id     uuid   NOT NULL,
    path            text   NOT NULL,
    cdm_target      text,
    fhir_profile_url text,
    fhir_path       text,
    code_system     text,
    code            text,
    unit_ucum       text,
    comment         text,
    CONSTRAINT pk_template_bindings PRIMARY KEY (id),
    CONSTRAINT uq_template_bindings_path UNIQUE (template_id, path),
    CONSTRAINT fk_template_bindings_template_id FOREIGN KEY (template_id) REFERENCES knowledge.templates (id),
    CONSTRAINT fk_template_bindings_code_system FOREIGN KEY (code_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_template_bindings_path CHECK (path ~ '^/[^[:space:]]+$' AND length(path) <= 1000),
    CONSTRAINT ck_template_bindings_cdm_target CHECK (cdm_target ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
    CONSTRAINT ck_template_bindings_fhir CHECK ((fhir_path IS NULL OR fhir_path ~ '^[A-Z][A-Za-z]+(\.[a-z][A-Za-z0-9\[\]]*)+$')
                                                AND length(fhir_profile_url) <= 500),
    CONSTRAINT ck_template_bindings_code CHECK ((code_system IS NULL) = (code IS NULL) AND length(code) <= 100),
    CONSTRAINT ck_template_bindings_unit_ucum CHECK (length(unit_ucum) <= 50),
    CONSTRAINT ck_template_bindings_target CHECK (num_nonnulls(cdm_target, fhir_path, code) >= 1),
    CONSTRAINT ck_template_bindings_comment CHECK (length(comment) <= 1000)
);
COMMENT ON TABLE knowledge.template_bindings IS
    'Template path -> canonical column / FHIR element / terminology concept (semantic interoperability map)';
COMMENT ON COLUMN knowledge.template_bindings.path IS 'openEHR path within the template, e.g. /content[openEHR-EHR-OBSERVATION.blood_pressure.v2]/...';
COMMENT ON COLUMN knowledge.template_bindings.cdm_target IS 'schema.table.column in the canonical model, e.g. clinical.observations.value_quantity';

-- FHIR StructureDefinition profiles exchanged resources conform to (SATUSEHAT publishes
-- https://fhir.kemkes.go.id/r4/StructureDefinition/{Name}).
CREATE TABLE knowledge.fhir_profiles (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    canonical_url        text        NOT NULL,
    version              text        NOT NULL,
    fhir_version         text        NOT NULL,
    resource_type        text        NOT NULL,
    publisher            text        NOT NULL,
    source_reference     text        NOT NULL,
    artifact_sha256      bytea       NOT NULL,
    status               text        NOT NULL DEFAULT 'draft',
    status_reason        text,
    approved_at          timestamptz,
    approved_by_user_id  uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_fhir_profiles PRIMARY KEY (id),
    CONSTRAINT uq_fhir_profiles_url_version UNIQUE (canonical_url, version),
    CONSTRAINT fk_fhir_profiles_approved_by_user_id FOREIGN KEY (approved_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_fhir_profiles_canonical_url CHECK (canonical_url ~ '^https?://[^[:space:]]{3,}$' AND length(canonical_url) <= 500),
    CONSTRAINT ck_fhir_profiles_version CHECK (length(btrim(version)) BETWEEN 1 AND 64),
    CONSTRAINT ck_fhir_profiles_fhir_version CHECK (fhir_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
    CONSTRAINT ck_fhir_profiles_resource_type CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_fhir_profiles_publisher CHECK (length(btrim(publisher)) BETWEEN 1 AND 200),
    CONSTRAINT ck_fhir_profiles_source_reference CHECK (length(btrim(source_reference)) BETWEEN 1 AND 500),
    CONSTRAINT ck_fhir_profiles_sha256 CHECK (octet_length(artifact_sha256) = 32),
    CONSTRAINT ck_fhir_profiles_status CHECK (status IN ('draft', 'active', 'retired', 'rejected')),
    CONSTRAINT ck_fhir_profiles_status_reason CHECK (length(status_reason) <= 500),
    CONSTRAINT ck_fhir_profiles_approved CHECK ((status IN ('active', 'retired')) = (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL))
);
COMMENT ON TABLE knowledge.fhir_profiles IS 'FHIR profile version used for conformance validation (e.g. SATUSEHAT R4 profiles)';

-- Lifecycle shared with terminology (draft -> approved/active -> retired; draft -> rejected; non-draft rows only
-- change status).
CREATE TRIGGER trg_archetypes_lifecycle BEFORE UPDATE ON knowledge.archetypes
    FOR EACH ROW EXECUTE FUNCTION terminology.guard_lifecycle();
CREATE TRIGGER trg_templates_lifecycle BEFORE UPDATE ON knowledge.templates
    FOR EACH ROW EXECUTE FUNCTION terminology.guard_lifecycle();
CREATE TRIGGER trg_fhir_profiles_lifecycle BEFORE UPDATE ON knowledge.fhir_profiles
    FOR EACH ROW EXECUTE FUNCTION terminology.guard_lifecycle();

-- A template's archetype list and bindings are fixed once the template leaves draft.
CREATE FUNCTION knowledge.guard_template_content() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    t_status text;
BEGIN
    SELECT t.status INTO t_status FROM knowledge.templates t
    WHERE t.id IN (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.template_id END,
                   CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.template_id END)
      AND t.status <> 'draft'
    LIMIT 1;
    IF t_status IS NOT NULL THEN
        RAISE EXCEPTION 'knowledge.%: content of a % template cannot change (publish a new version)', TG_TABLE_NAME, t_status;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER trg_template_archetypes_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge.template_archetypes
    FOR EACH ROW EXECUTE FUNCTION knowledge.guard_template_content();
CREATE TRIGGER trg_template_bindings_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge.template_bindings
    FOR EACH ROW EXECUTE FUNCTION knowledge.guard_template_content();

GRANT USAGE ON SCHEMA knowledge TO hms_terminology_rw, hms_report_read;
GRANT SELECT, INSERT, UPDATE ON knowledge.archetypes, knowledge.templates, knowledge.fhir_profiles TO hms_terminology_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge.template_archetypes, knowledge.template_bindings TO hms_terminology_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA knowledge TO hms_report_read;
