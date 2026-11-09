-- 0015 clinical documents and provenance (schema clinical, ADR-DB-004/005):
--   compositions (clinical documents: resume medis, CPPT, discharge summary, operative report) with authors,
--   sections, narrative and references to the clinical resources they contain, optional openEHR structured content
--   conforming to an active template; attestations; electronic-signature metadata; FHIR Provenance.
-- Owner: hms_database (definitions); writes: hms_services documents/signature workflow (hms_clinical_rw).
-- Classification: restricted (health data).
-- Permenkes 24/2022 Pasal 16(2): each entry carries the provider's name, time and signature; Pasal 31: an electronic
-- signature may be added to verify content and signer. Signature creation and verification run in hms_services with
-- an external signing provider; this schema stores the signed-content hash, signer, certificate fingerprint and an
-- object-storage reference to the signature, never a private key or signing credential.
-- Documents: preliminary -> final -> amended (with reason) or entered-in-error. Every version is kept; an attestation
-- binds to the exact version it attests. Provenance and attestations are append-only.
-- Online-safe: creates new objects only. Rollback: fix forward.

-- Electronic signature over a hash of a specific resource version (detached signature kept in object storage).
CREATE TABLE clinical.signatures (
    id                       uuid        NOT NULL DEFAULT uuidv7(),
    organization_id          uuid        NOT NULL,
    patient_id               uuid,
    target_resource_type     text        NOT NULL,
    target_resource_id       uuid        NOT NULL,
    target_version           integer     NOT NULL,
    content_sha256           bytea       NOT NULL,
    signer_practitioner_id   uuid        NOT NULL,
    signer_user_id           uuid        NOT NULL,
    signed_at                timestamptz NOT NULL,
    signature_format         text        NOT NULL,
    provider                 text        NOT NULL,
    certificate_serial       text        NOT NULL,
    certificate_issuer       text        NOT NULL,
    certificate_sha256       bytea       NOT NULL,
    signature_object_ref     text        NOT NULL,
    verification_status      text        NOT NULL DEFAULT 'not_verified',
    verified_at              timestamptz,
    verification_code        text,
    recorded_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_signatures PRIMARY KEY (id),
    CONSTRAINT uq_signatures_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT fk_signatures_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_signatures_signer_practitioner FOREIGN KEY (signer_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_signatures_signer_user FOREIGN KEY (signer_user_id, organization_id) REFERENCES iam.users (id, organization_id),
    CONSTRAINT ck_signatures_target_resource_type CHECK (target_resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_signatures_target_version CHECK (target_version >= 1),
    CONSTRAINT ck_signatures_content_sha256 CHECK (octet_length(content_sha256) = 32),
    CONSTRAINT ck_signatures_format CHECK (signature_format IN ('cades', 'pades', 'xades', 'jades', 'jws')),
    CONSTRAINT ck_signatures_provider CHECK (provider ~ '^[a-z][a-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_signatures_certificate CHECK (length(btrim(certificate_serial)) BETWEEN 1 AND 128
                                                AND length(btrim(certificate_issuer)) BETWEEN 1 AND 500
                                                AND octet_length(certificate_sha256) = 32),
    CONSTRAINT ck_signatures_object_ref CHECK (length(btrim(signature_object_ref)) BETWEEN 1 AND 500),
    CONSTRAINT ck_signatures_verification_status CHECK (verification_status IN ('not_verified', 'valid', 'invalid', 'indeterminate')),
    CONSTRAINT ck_signatures_verified CHECK ((verification_status = 'not_verified') = (verified_at IS NULL)),
    CONSTRAINT ck_signatures_verification_code CHECK (verification_code ~ '^[a-z][a-z0-9_.-]{0,63}$')
);
COMMENT ON TABLE clinical.signatures IS
    'Electronic signature metadata over the SHA-256 of one resource version; signature bytes in object storage, no keys';
COMMENT ON COLUMN clinical.signatures.content_sha256 IS 'Hash of the canonical signed content of target_resource_type/id/version';
COMMENT ON COLUMN clinical.signatures.signer_user_id IS 'Signed-in user who invoked signing (must be the practitioner''s user)';
CREATE INDEX idx_signatures_target ON clinical.signatures (target_resource_type, target_resource_id, target_version);

-- The signer is the practitioner acting through their own sign-in identity.
CREATE FUNCTION clinical.check_signature_signer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM workforce.practitioners p
                   WHERE p.id = NEW.signer_practitioner_id AND p.user_id = NEW.signer_user_id AND p.active) THEN
        RAISE EXCEPTION 'signer user % is not the active practitioner %', NEW.signer_user_id, NEW.signer_practitioner_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER trg_signatures_check_signer BEFORE INSERT ON clinical.signatures
    FOR EACH ROW EXECUTE FUNCTION clinical.check_signature_signer();

CREATE TABLE clinical.compositions (
    id                       uuid        NOT NULL DEFAULT uuidv7(),
    organization_id          uuid        NOT NULL,
    patient_id               uuid        NOT NULL,
    encounter_id             uuid,
    status                   text        NOT NULL,
    type_system              text        NOT NULL,
    type_code                text        NOT NULL,
    type_display             text,
    category_system          text,
    category_code            text,
    title                    text        NOT NULL,
    document_date            timestamptz NOT NULL,
    confidentiality          text        NOT NULL DEFAULT 'N',
    template_id              uuid,
    content_format           text,
    content                  jsonb,
    replaces_composition_id  uuid,
    version                  integer     NOT NULL DEFAULT 1,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    last_xact_id             xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_compositions PRIMARY KEY (id),
    CONSTRAINT uq_compositions_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT uq_compositions_id_patient_id UNIQUE (id, patient_id),
    CONSTRAINT fk_compositions_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_compositions_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_compositions_template_id FOREIGN KEY (template_id) REFERENCES knowledge.templates (id),
    CONSTRAINT fk_compositions_replaces FOREIGN KEY (replaces_composition_id, patient_id) REFERENCES clinical.compositions (id, patient_id),
    CONSTRAINT fk_compositions_type_system FOREIGN KEY (type_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_compositions_category_system FOREIGN KEY (category_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 CompositionStatus.
    CONSTRAINT ck_compositions_status CHECK (status IN ('preliminary', 'final', 'amended', 'entered-in-error')),
    CONSTRAINT ck_compositions_type CHECK (length(type_code) BETWEEN 1 AND 100 AND length(type_display) <= 500),
    CONSTRAINT ck_compositions_category CHECK ((category_system IS NULL) = (category_code IS NULL) AND length(category_code) <= 100),
    CONSTRAINT ck_compositions_title CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    -- HL7 v3 Confidentiality.
    CONSTRAINT ck_compositions_confidentiality CHECK (confidentiality IN ('U', 'L', 'M', 'N', 'R', 'V')),
    CONSTRAINT ck_compositions_content CHECK (
        (content IS NULL AND content_format IS NULL)
        OR (content IS NOT NULL AND template_id IS NOT NULL
            AND content_format IN ('openehr_canonical_json', 'openehr_flat_json')
            AND jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1048576)),
    CONSTRAINT ck_compositions_replaces CHECK (replaces_composition_id <> id)
);
COMMENT ON TABLE clinical.compositions IS
    'Clinical document (FHIR Composition / openEHR COMPOSITION): narrative sections, entry references, optional structured content';
COMMENT ON COLUMN clinical.compositions.document_date IS 'Clinical date of the document (FHIR Composition.date)';
COMMENT ON COLUMN clinical.compositions.content IS
    'Structured openEHR content conforming to template_id (validated by hms_services); max 1 MiB, no binaries';
COMMENT ON COLUMN clinical.compositions.replaces_composition_id IS 'Earlier document this one replaces (FHIR relatesTo replaces)';
CREATE INDEX idx_compositions_patient_id ON clinical.compositions (patient_id, document_date DESC);
CREATE INDEX idx_compositions_encounter_id ON clinical.compositions (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX idx_compositions_template_id ON clinical.compositions (template_id) WHERE template_id IS NOT NULL;

-- Structured content may only reference an active template.
CREATE FUNCTION clinical.check_composition_template() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.template_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.content IS DISTINCT FROM OLD.content)
       AND NOT EXISTS (SELECT 1 FROM knowledge.templates t WHERE t.id = NEW.template_id AND t.status = 'active') THEN
        RAISE EXCEPTION 'composition content must conform to an active template' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER trg_compositions_check_template BEFORE INSERT OR UPDATE ON clinical.compositions
    FOR EACH ROW EXECUTE FUNCTION clinical.check_composition_template();

CREATE TABLE clinical.composition_authors (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    composition_id   uuid        NOT NULL,
    practitioner_id  uuid        NOT NULL,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_composition_authors PRIMARY KEY (id),
    CONSTRAINT fk_composition_authors_composition FOREIGN KEY (composition_id, organization_id)
        REFERENCES clinical.compositions (id, organization_id),
    CONSTRAINT fk_composition_authors_practitioner FOREIGN KEY (practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id)
);
COMMENT ON TABLE clinical.composition_authors IS 'Author of a clinical document (FHIR Composition.author)';
CREATE UNIQUE INDEX uq_composition_authors_active ON clinical.composition_authors (composition_id, practitioner_id) WHERE active;
CREATE INDEX idx_composition_authors_practitioner_id ON clinical.composition_authors (practitioner_id);

CREATE TABLE clinical.composition_sections (
    id                 uuid        NOT NULL DEFAULT uuidv7(),
    organization_id    uuid        NOT NULL,
    composition_id     uuid        NOT NULL,
    parent_section_id  uuid,
    ordinal            smallint    NOT NULL,
    title              text,
    code_system        text,
    code               text,
    code_display       text,
    narrative          text,
    narrative_status   text,
    active             boolean     NOT NULL DEFAULT true,
    version            integer     NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    last_xact_id       xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_composition_sections PRIMARY KEY (id),
    CONSTRAINT uq_composition_sections_id_composition_id UNIQUE (id, composition_id),
    CONSTRAINT fk_composition_sections_composition FOREIGN KEY (composition_id, organization_id)
        REFERENCES clinical.compositions (id, organization_id),
    CONSTRAINT fk_composition_sections_parent FOREIGN KEY (parent_section_id, composition_id)
        REFERENCES clinical.composition_sections (id, composition_id),
    CONSTRAINT fk_composition_sections_code_system FOREIGN KEY (code_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_composition_sections_ordinal CHECK (ordinal >= 1),
    CONSTRAINT ck_composition_sections_title CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    CONSTRAINT ck_composition_sections_code CHECK ((code_system IS NULL) = (code IS NULL) AND length(code) <= 100
                                                   AND length(code_display) <= 500),
    CONSTRAINT ck_composition_sections_narrative CHECK (length(narrative) <= 200000),
    -- FHIR R4 NarrativeStatus.
    CONSTRAINT ck_composition_sections_narrative_status CHECK (narrative_status IN ('generated', 'extensions', 'additional', 'empty')
        AND (narrative IS NULL) = (narrative_status IS NULL OR narrative_status = 'empty')),
    CONSTRAINT ck_composition_sections_parent CHECK (parent_section_id <> id)
);
COMMENT ON TABLE clinical.composition_sections IS 'Section of a clinical document (e.g. S/O/A/P), narrative as written';
COMMENT ON COLUMN clinical.composition_sections.narrative IS 'Section text as authored (plain text/Markdown; rendered safely by clients)';
CREATE INDEX idx_composition_sections_composition_id ON clinical.composition_sections (composition_id, ordinal);

-- Clinical resource referenced by a section. The referenced record must belong to the document's patient (trigger).
CREATE TABLE clinical.composition_section_entries (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    composition_id   uuid        NOT NULL,
    section_id       uuid        NOT NULL,
    resource_type    text        NOT NULL,
    resource_id      uuid        NOT NULL,
    ordinal          smallint    NOT NULL DEFAULT 1,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_composition_section_entries PRIMARY KEY (id),
    CONSTRAINT fk_composition_section_entries_section FOREIGN KEY (section_id, composition_id)
        REFERENCES clinical.composition_sections (id, composition_id),
    CONSTRAINT fk_composition_section_entries_composition FOREIGN KEY (composition_id, organization_id)
        REFERENCES clinical.compositions (id, organization_id),
    CONSTRAINT ck_composition_section_entries_resource_type CHECK (resource_type IN
        ('Encounter', 'Condition', 'AllergyIntolerance', 'Observation', 'Procedure', 'DiagnosticReport',
         'MedicationRequest', 'MedicationDispense', 'MedicationAdministration', 'MedicationStatement', 'ImagingStudy')),
    CONSTRAINT ck_composition_section_entries_ordinal CHECK (ordinal >= 1)
);
COMMENT ON TABLE clinical.composition_section_entries IS 'Clinical resource referenced from a document section (same patient)';
CREATE UNIQUE INDEX uq_composition_section_entries_active ON clinical.composition_section_entries (section_id, resource_type, resource_id)
    WHERE active;
CREATE INDEX idx_composition_section_entries_resource ON clinical.composition_section_entries (resource_type, resource_id);

-- Patient of any referenceable clinical resource (NULL when not found). Imaging studies are added by 0017.
CREATE FUNCTION clinical.resource_patient_id(p_resource_type text, p_resource_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    t text := CASE p_resource_type
        WHEN 'Encounter' THEN 'clinical.encounters'
        WHEN 'Condition' THEN 'clinical.conditions'
        WHEN 'AllergyIntolerance' THEN 'clinical.allergy_intolerances'
        WHEN 'Observation' THEN 'clinical.observations'
        WHEN 'Procedure' THEN 'clinical.procedures'
        WHEN 'DiagnosticReport' THEN 'clinical.diagnostic_reports'
        WHEN 'MedicationRequest' THEN 'clinical.medication_requests'
        WHEN 'MedicationDispense' THEN 'clinical.medication_dispenses'
        WHEN 'MedicationAdministration' THEN 'clinical.medication_administrations'
        WHEN 'MedicationStatement' THEN 'clinical.medication_statements'
        WHEN 'Composition' THEN 'clinical.compositions'
        WHEN 'ImagingStudy' THEN 'imaging.studies'
        ELSE NULL END;
    result uuid;
BEGIN
    IF t IS NULL OR to_regclass(t) IS NULL THEN
        RETURN NULL;
    END IF;
    EXECUTE format('SELECT patient_id FROM %s WHERE id = $1', t) INTO result USING p_resource_id;
    RETURN result;
END
$$;
COMMENT ON FUNCTION clinical.resource_patient_id(text, uuid) IS 'Patient of a clinical resource by type and id (integrity checks)';

CREATE FUNCTION clinical.check_entry_patient() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    doc_patient uuid;
BEGIN
    SELECT c.patient_id INTO doc_patient FROM clinical.compositions c WHERE c.id = NEW.composition_id;
    IF clinical.resource_patient_id(NEW.resource_type, NEW.resource_id) IS DISTINCT FROM doc_patient THEN
        RAISE EXCEPTION 'referenced % % does not exist or belongs to another patient', NEW.resource_type, NEW.resource_id
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER trg_composition_section_entries_check_patient BEFORE INSERT OR UPDATE ON clinical.composition_section_entries
    FOR EACH ROW EXECUTE FUNCTION clinical.check_entry_patient();

-- Attestation of one document version (FHIR Composition.attester), optionally with an electronic signature.
CREATE TABLE clinical.composition_attestations (
    id                       uuid        NOT NULL DEFAULT uuidv7(),
    organization_id          uuid        NOT NULL,
    composition_id           uuid        NOT NULL,
    composition_version      integer     NOT NULL,
    mode                     text        NOT NULL,
    attester_practitioner_id uuid        NOT NULL,
    attested_at              timestamptz NOT NULL,
    signature_id             uuid,
    recorded_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_composition_attestations PRIMARY KEY (id),
    CONSTRAINT fk_composition_attestations_composition FOREIGN KEY (composition_id, organization_id)
        REFERENCES clinical.compositions (id, organization_id),
    CONSTRAINT fk_composition_attestations_attester FOREIGN KEY (attester_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_composition_attestations_signature FOREIGN KEY (signature_id, organization_id)
        REFERENCES clinical.signatures (id, organization_id),
    CONSTRAINT ck_composition_attestations_version CHECK (composition_version >= 1),
    -- FHIR R4 CompositionAttestationMode.
    CONSTRAINT ck_composition_attestations_mode CHECK (mode IN ('personal', 'professional', 'legal', 'official'))
);
COMMENT ON TABLE clinical.composition_attestations IS 'Attestation of one composition version; append-only';
CREATE INDEX idx_composition_attestations_composition_id ON clinical.composition_attestations (composition_id, composition_version);

-- The attested version must exist and not be entered-in-error; a signature must cover exactly that version.
CREATE FUNCTION clinical.check_attestation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM clinical.resource_versions v
                   WHERE v.resource_type = 'Composition' AND v.resource_id = NEW.composition_id
                     AND v.version = NEW.composition_version
                     AND v.snapshot->>'status' IN ('final', 'amended')) THEN
        RAISE EXCEPTION 'composition % version % is not a final or amended version', NEW.composition_id, NEW.composition_version
            USING ERRCODE = '23514';
    END IF;
    IF NEW.signature_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM clinical.signatures s
        WHERE s.id = NEW.signature_id AND s.target_resource_type = 'Composition'
          AND s.target_resource_id = NEW.composition_id AND s.target_version = NEW.composition_version
          AND s.signer_practitioner_id = NEW.attester_practitioner_id) THEN
        RAISE EXCEPTION 'signature % does not cover composition % version % by this attester',
            NEW.signature_id, NEW.composition_id, NEW.composition_version USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER trg_composition_attestations_check BEFORE INSERT ON clinical.composition_attestations
    FOR EACH ROW EXECUTE FUNCTION clinical.check_attestation();

-- FHIR Provenance: who did what to which resource version, when, why, on whose behalf and from what source.
CREATE TABLE clinical.provenances (
    id                    uuid        NOT NULL DEFAULT uuidv7(),
    organization_id       uuid        NOT NULL,
    patient_id            uuid,
    target_resource_type  text        NOT NULL,
    target_resource_id    uuid        NOT NULL,
    target_version        integer,
    recorded_at           timestamptz NOT NULL DEFAULT now(),
    occurred_start        timestamptz,
    occurred_end          timestamptz,
    activity_system       text,
    activity_code         text,
    reason_text           text,
    location_id           uuid,
    signature_id          uuid,
    CONSTRAINT pk_provenances PRIMARY KEY (id),
    CONSTRAINT uq_provenances_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT fk_provenances_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_provenances_location FOREIGN KEY (location_id, organization_id) REFERENCES platform.locations (id, organization_id),
    CONSTRAINT fk_provenances_signature FOREIGN KEY (signature_id, organization_id) REFERENCES clinical.signatures (id, organization_id),
    CONSTRAINT fk_provenances_activity_system FOREIGN KEY (activity_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_provenances_target_resource_type CHECK (target_resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_provenances_target_version CHECK (target_version >= 1),
    CONSTRAINT ck_provenances_occurred CHECK (occurred_end IS NULL OR (occurred_start IS NOT NULL AND occurred_end >= occurred_start)),
    CONSTRAINT ck_provenances_activity CHECK ((activity_system IS NULL) = (activity_code IS NULL) AND length(activity_code) <= 100),
    CONSTRAINT ck_provenances_reason_text CHECK (length(btrim(reason_text)) BETWEEN 1 AND 1000)
);
COMMENT ON TABLE clinical.provenances IS 'Provenance of a resource version (FHIR Provenance); append-only';
COMMENT ON COLUMN clinical.provenances.occurred_start IS 'Evidence-backed time of the activity; never a polling/import time';
CREATE INDEX idx_provenances_target ON clinical.provenances (target_resource_type, target_resource_id, target_version);
CREATE INDEX idx_provenances_patient_id ON clinical.provenances (patient_id, recorded_at) WHERE patient_id IS NOT NULL;

CREATE TABLE clinical.provenance_agents (
    id                           bigint GENERATED ALWAYS AS IDENTITY,
    organization_id              uuid   NOT NULL,
    provenance_id                uuid   NOT NULL,
    type_code                    text   NOT NULL,
    practitioner_id              uuid,
    user_id                      uuid,
    service_name                 text,
    on_behalf_of_organization_id uuid,
    CONSTRAINT pk_provenance_agents PRIMARY KEY (id),
    CONSTRAINT fk_provenance_agents_provenance FOREIGN KEY (provenance_id, organization_id)
        REFERENCES clinical.provenances (id, organization_id),
    CONSTRAINT fk_provenance_agents_practitioner FOREIGN KEY (practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_provenance_agents_user FOREIGN KEY (user_id, organization_id) REFERENCES iam.users (id, organization_id),
    CONSTRAINT fk_provenance_agents_on_behalf_of FOREIGN KEY (on_behalf_of_organization_id) REFERENCES platform.organizations (id),
    -- HL7 provenance-participant-type.
    CONSTRAINT ck_provenance_agents_type_code CHECK (type_code IN
        ('enterer', 'performer', 'author', 'verifier', 'legal', 'attester', 'informant', 'custodian', 'assembler', 'composer')),
    CONSTRAINT ck_provenance_agents_who CHECK (num_nonnulls(practitioner_id, user_id, service_name) >= 1),
    CONSTRAINT ck_provenance_agents_service_name CHECK (service_name ~ '^[a-z][a-z0-9_.-]{0,63}$')
);
COMMENT ON TABLE clinical.provenance_agents IS 'Agent of a provenance record (practitioner, user and/or service); append-only';
CREATE INDEX idx_provenance_agents_provenance_id ON clinical.provenance_agents (provenance_id);

CREATE TABLE clinical.provenance_entities (
    id                  bigint GENERATED ALWAYS AS IDENTITY,
    organization_id     uuid   NOT NULL,
    provenance_id       uuid   NOT NULL,
    role                text   NOT NULL,
    resource_type       text,
    resource_id         uuid,
    resource_version    integer,
    external_reference  text,
    CONSTRAINT pk_provenance_entities PRIMARY KEY (id),
    CONSTRAINT fk_provenance_entities_provenance FOREIGN KEY (provenance_id, organization_id)
        REFERENCES clinical.provenances (id, organization_id),
    -- FHIR R4 ProvenanceEntityRole.
    CONSTRAINT ck_provenance_entities_role CHECK (role IN ('derivation', 'revision', 'quotation', 'source', 'removal')),
    CONSTRAINT ck_provenance_entities_what CHECK ((resource_type IS NOT NULL AND resource_id IS NOT NULL) <> (external_reference IS NOT NULL)),
    CONSTRAINT ck_provenance_entities_resource_type CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_provenance_entities_resource_version CHECK (resource_version >= 1),
    CONSTRAINT ck_provenance_entities_external_reference CHECK (external_reference ~ '^[a-z][a-z0-9_.-]{0,63}:[^[:space:]]+$'
                                                              AND length(external_reference) <= 500)
);
COMMENT ON TABLE clinical.provenance_entities IS 'Source used: earlier resource version or external reference (e.g. legacy-link:<id>); append-only';
COMMENT ON COLUMN clinical.provenance_entities.external_reference IS
    '<namespace>:<id>, e.g. legacy-link:<integration.legacy_record_links.id>; never raw PHI';
CREATE INDEX idx_provenance_entities_provenance_id ON clinical.provenance_entities (provenance_id);

-- Versioned documents.
SELECT hms_meta.enable_versioned_record('clinical.compositions', 'Composition', 'patient_id',
                                        'id,organization_id,patient_id', 'final,amended');
SELECT hms_meta.enable_versioned_record(t.tbl::regclass, t.rtype, '', 'id,organization_id,composition_id', '',
                                        'clinical.compositions', 'composition_id')
FROM (VALUES ('clinical.composition_authors', 'Composition.author'),
             ('clinical.composition_sections', 'Composition.section'),
             ('clinical.composition_section_entries', 'Composition.entry')) AS t(tbl, rtype);

-- Append-only: attestations, provenance (UPDATE, DELETE and TRUNCATE refused); signatures (no DELETE/TRUNCATE;
-- only verification columns are granted for UPDATE).
CREATE TRIGGER trg_composition_attestations_append_only BEFORE UPDATE OR DELETE ON clinical.composition_attestations
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_provenances_append_only BEFORE UPDATE OR DELETE ON clinical.provenances
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_provenance_agents_append_only BEFORE UPDATE OR DELETE ON clinical.provenance_agents
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_provenance_entities_append_only BEFORE UPDATE OR DELETE ON clinical.provenance_entities
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_signatures_no_delete BEFORE DELETE ON clinical.signatures
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_composition_attestations_no_truncate BEFORE TRUNCATE ON clinical.composition_attestations
    FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_provenances_no_truncate BEFORE TRUNCATE ON clinical.provenances
    FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_provenance_agents_no_truncate BEFORE TRUNCATE ON clinical.provenance_agents
    FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_provenance_entities_no_truncate BEFORE TRUNCATE ON clinical.provenance_entities
    FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_signatures_no_truncate BEFORE TRUNCATE ON clinical.signatures
    FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change();

SELECT hms_meta.enable_tenant_rls(t::regclass)
FROM unnest(ARRAY['clinical.signatures', 'clinical.composition_attestations', 'clinical.provenances',
                  'clinical.provenance_agents', 'clinical.provenance_entities']) AS t;

GRANT SELECT, INSERT, UPDATE ON clinical.compositions, clinical.composition_authors, clinical.composition_sections,
    clinical.composition_section_entries TO hms_clinical_rw;
GRANT SELECT, INSERT ON clinical.signatures, clinical.composition_attestations, clinical.provenances,
    clinical.provenance_agents, clinical.provenance_entities TO hms_clinical_rw;
GRANT UPDATE (verification_status, verified_at, verification_code) ON clinical.signatures TO hms_clinical_rw;
