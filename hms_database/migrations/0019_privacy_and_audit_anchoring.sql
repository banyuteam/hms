-- 0019 privacy records (schema privacy) and external anchoring of the audit hash chain (schema audit), ADR-DB-004.
-- UU 27/2022 (Pelindungan Data Pribadi): health data is specific personal data (Pasal 4); data subjects' requests are
-- recorded (Pasal 14) and answered within deadlines; high-risk processing needs a DPIA (Pasal 34). Permenkes 24/2022
-- Pasal 33-37: disclosure of medical record content is governed, and disclosure without the patient's consent must be
-- de-identified (Pasal 35(2)).
--   privacy.processing_activities  register of processing activities: purpose, legal basis, data categories,
--                                  recipients, retention, DPIA reference (no PHI)
--   privacy.disclosures            accounting of disclosures of a patient's data outside HMS (append-only)
--   privacy.data_subject_requests  access/rectification/erasure/restriction/... requests and decisions (versioned)
--   audit.chain_anchors            records that the audit chain head was anchored outside the database
-- Owner: hms_database (definitions); writes: hms_services privacy module (hms_privacy_rw), audit anchoring job
-- (hms_audit_append); reads: hms_services, audit reviewers/DPO (hms_audit_read). Classification: restricted
-- (disclosures and requests identify patients); processing_activities and anchors are internal.
-- Erasure requests do not delete medical records inside the retention period (Permenkes 24/2022 Pasal 39: at least
-- 25 years from the last visit); the decision and its legal basis are recorded instead.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA privacy;
COMMENT ON SCHEMA privacy IS 'hms_database: processing register, disclosure accounting, data subject requests';

SELECT hms_meta.create_version_store('privacy');

CREATE TABLE privacy.processing_activities (
    code                    text        NOT NULL,
    name                    text        NOT NULL,
    purpose                 text        NOT NULL,
    legal_basis             text        NOT NULL,
    data_categories         text[]      NOT NULL,
    includes_specific_data  boolean     NOT NULL,
    recipients              text,
    retention_rule          text        NOT NULL,
    dpia_reference          text,
    owner                   text        NOT NULL,
    status                  text        NOT NULL DEFAULT 'active',
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_processing_activities PRIMARY KEY (code),
    CONSTRAINT ck_processing_activities_code CHECK (code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
    CONSTRAINT ck_processing_activities_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_processing_activities_purpose CHECK (length(btrim(purpose)) BETWEEN 1 AND 2000),
    CONSTRAINT ck_processing_activities_legal_basis CHECK (legal_basis IN
        ('consent', 'contract', 'legal_obligation', 'vital_interest', 'public_task', 'legitimate_interest')),
    CONSTRAINT ck_processing_activities_data_categories CHECK (cardinality(data_categories) >= 1),
    CONSTRAINT ck_processing_activities_recipients CHECK (length(recipients) <= 2000),
    CONSTRAINT ck_processing_activities_retention_rule CHECK (length(btrim(retention_rule)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_processing_activities_dpia CHECK (NOT includes_specific_data OR status <> 'active' OR dpia_reference IS NOT NULL),
    CONSTRAINT ck_processing_activities_dpia_reference CHECK (length(btrim(dpia_reference)) BETWEEN 1 AND 500),
    CONSTRAINT ck_processing_activities_owner CHECK (length(btrim(owner)) BETWEEN 1 AND 200),
    CONSTRAINT ck_processing_activities_status CHECK (status IN ('draft', 'active', 'retired'))
);
COMMENT ON TABLE privacy.processing_activities IS
    'Register of processing activities (purpose, legal basis, categories, recipients, retention); active specific-data processing needs a DPIA reference';
COMMENT ON COLUMN privacy.processing_activities.legal_basis IS 'Lawful basis for processing personal data (UU 27/2022); confirm with the DPO';

CREATE TABLE privacy.disclosures (
    id                        uuid        NOT NULL DEFAULT uuidv7(),
    organization_id           uuid        NOT NULL,
    patient_id                uuid        NOT NULL,
    processing_activity_code  text        NOT NULL,
    recipient_kind            text        NOT NULL,
    recipient_system          text,
    recipient_description     text,
    resource_type             text,
    resource_id               uuid,
    resource_version          integer,
    scope_description         text,
    de_identified             boolean     NOT NULL DEFAULT false,
    disclosed_at              timestamptz NOT NULL,
    actor_user_id             uuid,
    actor_service             text,
    submission_id             uuid,
    request_id                text,
    recorded_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_disclosures PRIMARY KEY (id),
    CONSTRAINT fk_disclosures_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_disclosures_processing_activity_code FOREIGN KEY (processing_activity_code)
        REFERENCES privacy.processing_activities (code),
    CONSTRAINT fk_disclosures_recipient_system FOREIGN KEY (recipient_system) REFERENCES integration.external_systems (code),
    CONSTRAINT fk_disclosures_actor_user FOREIGN KEY (actor_user_id, organization_id) REFERENCES iam.users (id, organization_id),
    CONSTRAINT fk_disclosures_submission_id FOREIGN KEY (submission_id) REFERENCES integration.outbound_submissions (submission_id),
    CONSTRAINT ck_disclosures_recipient_kind CHECK (recipient_kind IN ('external_system', 'organization', 'person', 'patient')),
    CONSTRAINT ck_disclosures_recipient CHECK ((recipient_kind = 'external_system') = (recipient_system IS NOT NULL)
                                               AND (recipient_system IS NOT NULL OR recipient_description IS NOT NULL)),
    CONSTRAINT ck_disclosures_recipient_description CHECK (length(btrim(recipient_description)) BETWEEN 1 AND 500),
    CONSTRAINT ck_disclosures_resource CHECK ((resource_type IS NULL) = (resource_id IS NULL)
                                              AND (resource_id IS NOT NULL OR scope_description IS NOT NULL)),
    CONSTRAINT ck_disclosures_resource_type CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_disclosures_resource_version CHECK (resource_version >= 1),
    CONSTRAINT ck_disclosures_scope_description CHECK (length(btrim(scope_description)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_disclosures_actor CHECK ((actor_user_id IS NULL) <> (actor_service IS NULL)),
    CONSTRAINT ck_disclosures_actor_service CHECK (actor_service ~ '^[a-z][a-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_disclosures_request_id CHECK (length(request_id) <= 128)
);
COMMENT ON TABLE privacy.disclosures IS
    'Accounting of disclosures of a patient''s data outside HMS (to SATUSEHAT, insurers, other providers, the patient); append-only';
COMMENT ON COLUMN privacy.disclosures.scope_description IS 'What was disclosed when not one resource (e.g. "resume medis, visit of 2026-11-02"); no values';
CREATE INDEX idx_disclosures_patient_id ON privacy.disclosures (patient_id, disclosed_at DESC);
CREATE INDEX idx_disclosures_recipient_system ON privacy.disclosures (recipient_system, disclosed_at) WHERE recipient_system IS NOT NULL;

CREATE TABLE privacy.data_subject_requests (
    id                      uuid        NOT NULL DEFAULT uuidv7(),
    organization_id         uuid        NOT NULL,
    patient_id              uuid        NOT NULL,
    request_type            text        NOT NULL,
    requester_relationship  text        NOT NULL,
    received_at             timestamptz NOT NULL,
    due_at                  timestamptz NOT NULL,
    identity_verified_at    timestamptz,
    status                  text        NOT NULL DEFAULT 'received',
    decided_at              timestamptz,
    decision_reason         text,
    handled_by_user_id      uuid,
    evidence_ref            text,
    version                 integer     NOT NULL DEFAULT 1,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    last_xact_id            xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_data_subject_requests PRIMARY KEY (id),
    CONSTRAINT fk_data_subject_requests_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_data_subject_requests_handled_by FOREIGN KEY (handled_by_user_id, organization_id) REFERENCES iam.users (id, organization_id),
    CONSTRAINT ck_data_subject_requests_request_type CHECK (request_type IN
        ('access', 'rectification', 'erasure', 'restriction', 'objection', 'portability', 'consent_withdrawal')),
    CONSTRAINT ck_data_subject_requests_requester CHECK (requester_relationship IN ('self', 'guardian', 'legal_representative')),
    CONSTRAINT ck_data_subject_requests_due CHECK (due_at > received_at),
    CONSTRAINT ck_data_subject_requests_status CHECK (status IN
        ('received', 'identity_verified', 'in_progress', 'fulfilled', 'partially_fulfilled', 'refused', 'withdrawn')),
    CONSTRAINT ck_data_subject_requests_verified CHECK (status IN ('received', 'withdrawn') OR identity_verified_at IS NOT NULL),
    CONSTRAINT ck_data_subject_requests_decided CHECK (
        (status IN ('fulfilled', 'partially_fulfilled', 'refused')) = (decided_at IS NOT NULL AND decision_reason IS NOT NULL)
        OR status = 'withdrawn'),
    CONSTRAINT ck_data_subject_requests_decision_reason CHECK (length(btrim(decision_reason)) BETWEEN 1 AND 2000),
    CONSTRAINT ck_data_subject_requests_evidence_ref CHECK (length(evidence_ref) <= 500)
);
COMMENT ON TABLE privacy.data_subject_requests IS
    'Recorded data subject request (UU 27/2022 Pasal 14) with deadline, identity check and decision; versioned';
COMMENT ON COLUMN privacy.data_subject_requests.due_at IS 'Response deadline computed by hms_services from the request type and policy';
CREATE INDEX idx_data_subject_requests_open ON privacy.data_subject_requests (due_at)
    WHERE status IN ('received', 'identity_verified', 'in_progress');
CREATE INDEX idx_data_subject_requests_patient_id ON privacy.data_subject_requests (patient_id);

CREATE TRIGGER trg_processing_activities_touch_updated_at BEFORE UPDATE ON privacy.processing_activities
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();
CREATE TRIGGER trg_disclosures_append_only BEFORE UPDATE OR DELETE ON privacy.disclosures
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_disclosures_no_truncate BEFORE TRUNCATE ON privacy.disclosures
    FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change();
SELECT hms_meta.enable_tenant_rls('privacy.disclosures');
SELECT hms_meta.enable_versioned_record('privacy.data_subject_requests', 'DataSubjectRequest', 'patient_id',
                                        'id,organization_id,patient_id,request_type,received_at',
                                        'fulfilled,partially_fulfilled,refused,withdrawn');

GRANT USAGE ON SCHEMA privacy TO hms_privacy_rw, hms_audit_read;
GRANT SELECT ON privacy.processing_activities TO hms_privacy_rw;
GRANT SELECT, INSERT ON privacy.disclosures TO hms_privacy_rw;
GRANT SELECT, INSERT, UPDATE ON privacy.data_subject_requests TO hms_privacy_rw;
GRANT SELECT ON privacy.resource_versions TO hms_privacy_rw;
-- The register is maintained by the DPO through a reviewed change (owner/migration or a governed admin path), and is
-- readable by audit reviewers together with disclosures and requests.
GRANT SELECT ON privacy.processing_activities, privacy.disclosures, privacy.data_subject_requests,
    privacy.resource_versions TO hms_audit_read;

-- Audit chain anchoring. A job reads the chain head, stores (seq, hash) outside the database (WORM storage, RFC 3161
-- time-stamp authority or an off-site log), then records the anchor here; verify_anchors() detects any later
-- rewrite or truncation of the anchored part of the chain.
CREATE TABLE audit.chain_anchors (
    id                  uuid        NOT NULL DEFAULT uuidv7(),
    anchored_seq        bigint      NOT NULL,
    anchored_hash       bytea       NOT NULL,
    target              text        NOT NULL,
    external_reference  text        NOT NULL,
    recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT pk_chain_anchors PRIMARY KEY (id),
    CONSTRAINT ck_chain_anchors_seq CHECK (anchored_seq >= 1),
    CONSTRAINT ck_chain_anchors_hash CHECK (octet_length(anchored_hash) = 32),
    CONSTRAINT ck_chain_anchors_target CHECK (target IN ('object_lock_storage', 'timestamp_authority', 'offsite_log')),
    CONSTRAINT ck_chain_anchors_external_reference CHECK (length(btrim(external_reference)) BETWEEN 1 AND 500)
);
COMMENT ON TABLE audit.chain_anchors IS 'Audit chain heads anchored outside the database (append-only)';
CREATE INDEX idx_chain_anchors_anchored_seq ON audit.chain_anchors (anchored_seq);

CREATE TRIGGER trg_chain_anchors_append_only BEFORE UPDATE OR DELETE ON audit.chain_anchors
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_chain_anchors_no_truncate BEFORE TRUNCATE ON audit.chain_anchors
    FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change();

-- An anchor must name an existing chain position and its exact hash.
CREATE FUNCTION audit.check_anchor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM audit.audit_events a WHERE a.seq = NEW.anchored_seq AND a.hash = NEW.anchored_hash) THEN
        RAISE EXCEPTION 'anchor (seq %) does not match the audit chain', NEW.anchored_seq USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER trg_chain_anchors_check BEFORE INSERT ON audit.chain_anchors
    FOR EACH ROW EXECUTE FUNCTION audit.check_anchor();

-- Current head of the audit chain for the anchoring job, which cannot read the trail itself.
CREATE FUNCTION audit.chain_head(OUT head_seq bigint, OUT head_hash bytea)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT a.seq, a.hash FROM audit.audit_events a ORDER BY a.seq DESC LIMIT 1
$$;
COMMENT ON FUNCTION audit.chain_head() IS 'Latest (seq, hash) of the audit chain, for external anchoring';

-- Anchors whose recorded hash no longer matches the chain (row rewritten or removed). Empty result = consistent.
CREATE FUNCTION audit.verify_anchors()
RETURNS TABLE (anchor_id uuid, anchored_seq bigint, problem text)
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT c.id, c.anchored_seq,
           CASE WHEN a.seq IS NULL THEN 'anchored row missing' ELSE 'hash differs from anchored hash' END
    FROM audit.chain_anchors c
    LEFT JOIN audit.audit_events a ON a.seq = c.anchored_seq
    WHERE a.hash IS DISTINCT FROM c.anchored_hash
    ORDER BY c.anchored_seq
$$;
COMMENT ON FUNCTION audit.verify_anchors() IS 'Lists anchors that no longer match the audit chain (tampering or truncation)';

GRANT INSERT (anchored_seq, anchored_hash, target, external_reference) ON audit.chain_anchors TO hms_audit_append;
GRANT EXECUTE ON FUNCTION audit.chain_head() TO hms_audit_append;
GRANT SELECT ON audit.chain_anchors TO hms_audit_read;
GRANT EXECUTE ON FUNCTION audit.verify_anchors() TO hms_audit_read;
