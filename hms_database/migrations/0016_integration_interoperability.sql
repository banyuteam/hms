-- 0016 interoperability state (schema integration, ADR-DB-004):
--   external_systems        registry of systems HMS exchanges with (legacy Khanza, SATUSEHAT, PACS, ...)
--   legacy_record_links     crosswalk legacy source row -> canonical HMS record (Khanza stays read-only and separate)
--   external_resource_ids   identifiers an external platform assigned to HMS records (SATUSEHAT resource ids)
--   outbound_submissions    queue and history of resource submissions (no payloads; regenerated from versions)
--   validation_results      FHIR profile conformance results per resource version
-- Owner: hms_database (definitions); writes: hms_services integration adapters (hms_integration_rw); reads:
-- hms_services. Classification: confidential (identifiers and legacy business keys; no clinical values).
-- Endpoints, credentials and certificates are deployment configuration/secret manager material, never rows here.
-- Tenant row-level security as for clinical records: workers set hms.organization_id per batch.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE TABLE integration.external_systems (
    code        text        NOT NULL,
    kind        text        NOT NULL,
    name        text        NOT NULL,
    status      text        NOT NULL DEFAULT 'active',
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_external_systems PRIMARY KEY (code),
    CONSTRAINT ck_external_systems_code CHECK (code ~ '^[a-z][a-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_external_systems_kind CHECK (kind IN
        ('legacy_source', 'national_platform', 'payer', 'pacs', 'laboratory', 'other')),
    CONSTRAINT ck_external_systems_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_external_systems_status CHECK (status IN ('active', 'retired'))
);
COMMENT ON TABLE integration.external_systems IS 'Systems HMS exchanges data with; no endpoints or credentials';

INSERT INTO integration.external_systems (code, kind, name) VALUES
    ('legacy-hms', 'legacy_source', 'SIMRS Khanza (legacy HMS, read-only source)'),
    ('satusehat', 'national_platform', 'SATUSEHAT (Kementerian Kesehatan RI)');

-- Crosswalk from an observed legacy row to the canonical record created or matched from it. The legacy database is
-- never written; observation time here is not business-event time.
CREATE TABLE integration.legacy_record_links (
    id                 uuid        NOT NULL DEFAULT uuidv7(),
    organization_id    uuid        NOT NULL,
    source_system      text        NOT NULL,
    source_entity      text        NOT NULL,
    source_key         text        NOT NULL,
    resource_type      text        NOT NULL,
    resource_id        uuid        NOT NULL,
    first_observed_at  timestamptz NOT NULL DEFAULT now(),
    last_observed_at   timestamptz NOT NULL DEFAULT now(),
    source_row_sha256  bytea,
    status             text        NOT NULL DEFAULT 'linked',
    status_reason      text,
    CONSTRAINT pk_legacy_record_links PRIMARY KEY (id),
    CONSTRAINT fk_legacy_record_links_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_legacy_record_links_source_system FOREIGN KEY (source_system) REFERENCES integration.external_systems (code),
    CONSTRAINT ck_legacy_record_links_source_entity CHECK (source_entity ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_legacy_record_links_source_key CHECK (length(source_key) BETWEEN 1 AND 200),
    CONSTRAINT ck_legacy_record_links_resource_type CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_legacy_record_links_observed CHECK (last_observed_at >= first_observed_at),
    CONSTRAINT ck_legacy_record_links_sha256 CHECK (octet_length(source_row_sha256) = 32),
    CONSTRAINT ck_legacy_record_links_status CHECK (status IN ('linked', 'superseded', 'rejected')),
    CONSTRAINT ck_legacy_record_links_status_reason CHECK ((status = 'linked') = (status_reason IS NULL) AND length(status_reason) <= 500)
);
COMMENT ON TABLE integration.legacy_record_links IS
    'Legacy source row (e.g. legacy-hms pasien/no_rkm_medis) -> canonical record; the legacy source is never written';
COMMENT ON COLUMN integration.legacy_record_links.source_key IS 'Legacy business key as text (composite keys joined by |); confidential';
COMMENT ON COLUMN integration.legacy_record_links.source_row_sha256 IS 'Hash of the normalized source row last observed (change detection)';
CREATE UNIQUE INDEX uq_legacy_record_links_active ON integration.legacy_record_links (source_system, source_entity, source_key, resource_type)
    WHERE status = 'linked';
CREATE INDEX idx_legacy_record_links_resource ON integration.legacy_record_links (resource_type, resource_id);

CREATE TABLE integration.external_resource_ids (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    external_system  text        NOT NULL,
    resource_type    text        NOT NULL,
    resource_id      uuid        NOT NULL,
    external_id      text        NOT NULL,
    assigned_at      timestamptz NOT NULL DEFAULT now(),
    status           text        NOT NULL DEFAULT 'active',
    CONSTRAINT pk_external_resource_ids PRIMARY KEY (id),
    CONSTRAINT fk_external_resource_ids_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_external_resource_ids_external_system FOREIGN KEY (external_system) REFERENCES integration.external_systems (code),
    CONSTRAINT ck_external_resource_ids_resource_type CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_external_resource_ids_external_id CHECK (length(external_id) BETWEEN 1 AND 128 AND external_id = btrim(external_id)),
    CONSTRAINT ck_external_resource_ids_status CHECK (status IN ('active', 'retired'))
);
COMMENT ON TABLE integration.external_resource_ids IS 'Id an external platform assigned to an HMS record (e.g. SATUSEHAT Encounter id)';
CREATE UNIQUE INDEX uq_external_resource_ids_resource ON integration.external_resource_ids (external_system, resource_type, resource_id)
    WHERE status = 'active';
CREATE UNIQUE INDEX uq_external_resource_ids_external ON integration.external_resource_ids (external_system, resource_type, external_id)
    WHERE status = 'active';

-- One submission of one resource version to an external system. Idempotency key prevents double submission across
-- retries; at-least-once delivery with the external platform's own duplicate handling.
CREATE TABLE integration.outbound_submissions (
    id                bigint      GENERATED ALWAYS AS IDENTITY,
    submission_id     uuid        NOT NULL DEFAULT uuidv7(),
    organization_id   uuid        NOT NULL,
    external_system   text        NOT NULL,
    resource_type     text        NOT NULL,
    resource_id       uuid        NOT NULL,
    resource_version  integer     NOT NULL,
    operation         text        NOT NULL,
    profile_id        uuid,
    idempotency_key   text        NOT NULL,
    status            text        NOT NULL DEFAULT 'pending',
    attempt_count     integer     NOT NULL DEFAULT 0,
    next_attempt_at   timestamptz NOT NULL DEFAULT now(),
    last_attempt_at   timestamptz,
    last_http_status  smallint,
    last_error_code   text,
    payload_sha256    bytea,
    external_id       text,
    accepted_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_outbound_submissions PRIMARY KEY (id),
    CONSTRAINT uq_outbound_submissions_submission_id UNIQUE (submission_id),
    CONSTRAINT uq_outbound_submissions_idempotency_key UNIQUE (external_system, idempotency_key),
    CONSTRAINT fk_outbound_submissions_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_outbound_submissions_external_system FOREIGN KEY (external_system) REFERENCES integration.external_systems (code),
    CONSTRAINT fk_outbound_submissions_profile_id FOREIGN KEY (profile_id) REFERENCES knowledge.fhir_profiles (id),
    CONSTRAINT ck_outbound_submissions_resource_type CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_outbound_submissions_resource_version CHECK (resource_version >= 1),
    CONSTRAINT ck_outbound_submissions_operation CHECK (operation IN ('create', 'update')),
    CONSTRAINT ck_outbound_submissions_idempotency_key CHECK (length(idempotency_key) BETWEEN 8 AND 200),
    CONSTRAINT ck_outbound_submissions_status CHECK (status IN
        ('pending', 'in_flight', 'accepted', 'rejected', 'failed', 'superseded')),
    CONSTRAINT ck_outbound_submissions_attempt_count CHECK (attempt_count >= 0),
    CONSTRAINT ck_outbound_submissions_http_status CHECK (last_http_status BETWEEN 100 AND 599),
    CONSTRAINT ck_outbound_submissions_error_code CHECK (last_error_code ~ '^[a-z][a-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_outbound_submissions_payload_sha256 CHECK (octet_length(payload_sha256) = 32),
    CONSTRAINT ck_outbound_submissions_external_id CHECK (length(external_id) BETWEEN 1 AND 128),
    CONSTRAINT ck_outbound_submissions_accepted CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);
COMMENT ON TABLE integration.outbound_submissions IS
    'Submission of a resource version to an external system (e.g. SATUSEHAT); payload never stored, only its hash';
COMMENT ON COLUMN integration.outbound_submissions.last_error_code IS 'Error class (e.g. http.4xx, validation.profile); no response bodies';
CREATE INDEX idx_outbound_submissions_due ON integration.outbound_submissions (next_attempt_at, id) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_outbound_submissions_resource ON integration.outbound_submissions (resource_type, resource_id, resource_version);

-- Conformance of a resource version to a FHIR profile. issues holds severity/code/expression only, never values.
CREATE TABLE integration.validation_results (
    id                bigint      GENERATED ALWAYS AS IDENTITY,
    organization_id   uuid        NOT NULL,
    resource_type     text        NOT NULL,
    resource_id       uuid        NOT NULL,
    resource_version  integer     NOT NULL,
    profile_id        uuid        NOT NULL,
    validator         text        NOT NULL,
    outcome           text        NOT NULL,
    error_count       integer     NOT NULL DEFAULT 0,
    warning_count     integer     NOT NULL DEFAULT 0,
    issues            jsonb       NOT NULL DEFAULT '[]'::jsonb,
    validated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_validation_results PRIMARY KEY (id),
    CONSTRAINT fk_validation_results_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_validation_results_profile_id FOREIGN KEY (profile_id) REFERENCES knowledge.fhir_profiles (id),
    CONSTRAINT ck_validation_results_resource_type CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_validation_results_resource_version CHECK (resource_version >= 1),
    CONSTRAINT ck_validation_results_validator CHECK (length(btrim(validator)) BETWEEN 1 AND 100),
    CONSTRAINT ck_validation_results_outcome CHECK (outcome IN ('pass', 'warning', 'fail')),
    CONSTRAINT ck_validation_results_counts CHECK (error_count >= 0 AND warning_count >= 0
        AND (outcome = 'fail') = (error_count > 0)),
    CONSTRAINT ck_validation_results_issues CHECK (jsonb_typeof(issues) = 'array' AND octet_length(issues::text) <= 65536)
);
COMMENT ON TABLE integration.validation_results IS 'FHIR profile validation outcome per resource version; append-only';
COMMENT ON COLUMN integration.validation_results.issues IS 'Array of {severity, code, expression}; no element values';
CREATE INDEX idx_validation_results_resource ON integration.validation_results (resource_type, resource_id, resource_version);

CREATE TRIGGER trg_legacy_record_links_no_delete BEFORE DELETE ON integration.legacy_record_links
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_external_resource_ids_no_delete BEFORE DELETE ON integration.external_resource_ids
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_validation_results_append_only BEFORE UPDATE OR DELETE ON integration.validation_results
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();

SELECT hms_meta.enable_tenant_rls(t::regclass)
FROM unnest(ARRAY['integration.legacy_record_links', 'integration.external_resource_ids',
                  'integration.outbound_submissions', 'integration.validation_results']) AS t;

GRANT SELECT ON integration.external_systems TO hms_integration_rw;
GRANT SELECT, INSERT ON integration.legacy_record_links, integration.external_resource_ids,
    integration.outbound_submissions, integration.validation_results TO hms_integration_rw;
GRANT UPDATE (last_observed_at, source_row_sha256, status, status_reason) ON integration.legacy_record_links TO hms_integration_rw;
GRANT UPDATE (status) ON integration.external_resource_ids TO hms_integration_rw;
GRANT UPDATE (status, attempt_count, next_attempt_at, last_attempt_at, last_http_status, last_error_code,
              payload_sha256, external_id, accepted_at) ON integration.outbound_submissions TO hms_integration_rw;
