-- 0023 document attachments: files from outside HMS (scanned letters, outside results, certificates) attached to a
-- patient, to one of the patient's encounters, or to a staff member, to complete the record (ADR-SVC-013).
--   categories   what a file is (external laboratory result, referral letter, professional license, ...), per scope:
--                clinical (patient and encounter files) or staff
--   files        one stored file: its key on the hms_services document volume, verified media type, size, page count,
--                SHA-256 and the malware scan that passed it. Immutable. The bytes are never in the database
--                (CLAUDE.md: binary clinical documents do not belong in relational tables).
--   attachments  the link of one file to its subject, with category, title and status (FHIR DocumentReference).
--                Versioned record: history in document.resource_versions, no delete; entered-in-error is terminal
--                and needs a reason.
-- Encounters exist only in the legacy HMS for now: an encounter file stores the Khanza visit number (no_rawat),
-- checked by hms_services against the legacy HMS at upload, together with the canonical patient. It is relinked to a
-- canonical encounter once encounters are bridged (ADR-SVC-013 rollout).
-- Owner: hms_database (definitions); writer: hms_services runtime (hms_document_rw); every upload, read and status
-- change is audited by hms_services. Classification: restricted (health data, UU 27/2022 Pasal 4: titles and files may
-- describe a patient's health); staff files confidential. No original file name is stored (names often carry a
-- patient's name or NIK).
-- Native only: the legacy bridge has no access, and the tables are in no record domain (nothing in the legacy HMS is
-- taken over by them). Retention: files are never deleted here; the retention period is an owner decision.
-- Requires group role hms_document_rw (bootstrap). Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA document;
COMMENT ON SCHEMA document IS 'hms_database: files from outside HMS attached to patients, encounters and staff (metadata only)';

SELECT hms_meta.create_version_store('document');

-- Categories -----------------------------------------------------------------------------------------------------

CREATE TABLE document.categories (
    code        text        NOT NULL,
    scope       text        NOT NULL,
    name        text        NOT NULL,
    status      text        NOT NULL DEFAULT 'active',
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_categories PRIMARY KEY (code),
    CONSTRAINT uq_categories_code_scope UNIQUE (code, scope),
    CONSTRAINT ck_categories_code CHECK (code ~ '^[a-z][a-z0-9-]{1,39}$'),
    CONSTRAINT ck_categories_scope CHECK (scope IN ('clinical', 'staff')),
    CONSTRAINT ck_categories_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_categories_status CHECK (status IN ('active', 'retired'))
);
COMMENT ON TABLE document.categories IS
    'What an attached file is; clinical categories apply to patient and encounter files, staff categories to staff files';
COMMENT ON COLUMN document.categories.name IS 'English name; clients show localized names by code';

-- Local categories (not a national code list); more are added by migration, retired ones stay for old attachments.
INSERT INTO document.categories (code, scope, name) VALUES
    ('external-lab-result',     'clinical', 'Laboratory result from another facility'),
    ('external-imaging-result', 'clinical', 'Imaging result or report from another facility'),
    ('referral-letter',         'clinical', 'Referral letter'),
    ('external-medical-summary','clinical', 'Medical summary or discharge letter from another facility'),
    ('medical-certificate',     'clinical', 'Medical certificate'),
    ('signed-form',             'clinical', 'Signed form (scanned)'),
    ('payer-document',          'clinical', 'Insurer or guarantor document'),
    ('clinical-other',          'clinical', 'Other clinical document'),
    ('professional-license',    'staff',    'Professional registration or practice license (STR, SIP)'),
    ('certificate',             'staff',    'Certificate of competence or qualification'),
    ('training-record',         'staff',    'Training or continuing education record'),
    ('employment-document',     'staff',    'Employment document'),
    ('staff-other',             'staff',    'Other staff document');

-- Files ----------------------------------------------------------------------------------------------------------

CREATE TABLE document.files (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    organization_id      uuid        NOT NULL,
    facility_id          uuid        NOT NULL,
    media_type           text        NOT NULL,
    size_bytes           bigint      NOT NULL,
    page_count           integer,
    sha256               bytea       NOT NULL,
    storage_key          text        NOT NULL,
    scan_engine          text        NOT NULL,
    scanned_at           timestamptz NOT NULL,
    uploaded_by_user_id  uuid        NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_files PRIMARY KEY (id),
    CONSTRAINT uq_files_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT uq_files_storage_key UNIQUE (storage_key),
    CONSTRAINT fk_files_facility FOREIGN KEY (facility_id, organization_id)
        REFERENCES platform.facilities (id, organization_id),
    CONSTRAINT fk_files_uploaded_by FOREIGN KEY (uploaded_by_user_id, organization_id)
        REFERENCES iam.users (id, organization_id),
    -- Verified from the content by hms_services; images are stored re-encoded (metadata such as GPS removed).
    CONSTRAINT ck_files_media_type CHECK (media_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    CONSTRAINT ck_files_size_bytes CHECK (size_bytes BETWEEN 1 AND 20971520),
    CONSTRAINT ck_files_page_count CHECK (
        (media_type = 'application/pdf' AND page_count IS NOT NULL AND page_count BETWEEN 1 AND 500)
        OR (media_type <> 'application/pdf' AND page_count IS NULL)),
    CONSTRAINT ck_files_sha256 CHECK (octet_length(sha256) = 32),
    CONSTRAINT ck_files_storage_key CHECK (
        storage_key ~ '^documents/[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    CONSTRAINT ck_files_scan_engine CHECK (length(btrim(scan_engine)) BETWEEN 1 AND 128),
    CONSTRAINT ck_files_scanned_at CHECK (scanned_at <= created_at + interval '1 hour')
);
COMMENT ON TABLE document.files IS
    'One stored file (metadata only: no bytes, no original file name); immutable';
COMMENT ON COLUMN document.files.storage_key IS 'Path on the hms_services document volume, generated by hms-services';
COMMENT ON COLUMN document.files.sha256 IS 'SHA-256 of the stored bytes; hms-services verifies it on every read';
COMMENT ON COLUMN document.files.scan_engine IS 'Malware scanner and signature version that passed the file';

CREATE TRIGGER trg_files_immutable BEFORE UPDATE OR DELETE ON document.files
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
CREATE TRIGGER trg_files_no_truncate BEFORE TRUNCATE ON document.files
    FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change();
SELECT hms_meta.enable_tenant_rls('document.files');
CREATE INDEX idx_files_uploaded_by_user_id ON document.files (uploaded_by_user_id, created_at);

-- Attachments ----------------------------------------------------------------------------------------------------

CREATE TABLE document.attachments (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    organization_id      uuid        NOT NULL,
    facility_id          uuid        NOT NULL,
    file_id              uuid        NOT NULL,
    subject_kind         text        NOT NULL,
    patient_id           uuid,
    legacy_visit_number  text,
    staff_user_id        uuid,
    category_code        text        NOT NULL,
    category_scope       text        NOT NULL GENERATED ALWAYS AS
                                         (CASE WHEN subject_kind = 'staff' THEN 'staff' ELSE 'clinical' END) STORED,
    title                text        NOT NULL,
    description          text,
    document_date        date,
    source_organization  text,
    status               text        NOT NULL DEFAULT 'current',
    status_reason        text,
    created_by_user_id   uuid        NOT NULL,
    version              integer     NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    last_xact_id         xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_attachments PRIMARY KEY (id),
    CONSTRAINT uq_attachments_file_id UNIQUE (file_id),
    CONSTRAINT fk_attachments_file FOREIGN KEY (file_id, organization_id) REFERENCES document.files (id, organization_id),
    CONSTRAINT fk_attachments_facility FOREIGN KEY (facility_id, organization_id)
        REFERENCES platform.facilities (id, organization_id),
    CONSTRAINT fk_attachments_patient FOREIGN KEY (patient_id, organization_id)
        REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_attachments_staff_user FOREIGN KEY (staff_user_id, organization_id)
        REFERENCES iam.users (id, organization_id),
    CONSTRAINT fk_attachments_created_by FOREIGN KEY (created_by_user_id, organization_id)
        REFERENCES iam.users (id, organization_id),
    -- A clinical category for a patient or encounter file, a staff category for a staff file.
    CONSTRAINT fk_attachments_category FOREIGN KEY (category_code, category_scope)
        REFERENCES document.categories (code, scope),
    CONSTRAINT ck_attachments_subject_kind CHECK (subject_kind IN ('patient', 'encounter', 'staff')),
    CONSTRAINT ck_attachments_subject CHECK (
        (subject_kind = 'patient'   AND patient_id IS NOT NULL AND legacy_visit_number IS NULL AND staff_user_id IS NULL)
        OR (subject_kind = 'encounter' AND patient_id IS NOT NULL AND legacy_visit_number IS NOT NULL AND staff_user_id IS NULL)
        OR (subject_kind = 'staff'     AND patient_id IS NULL AND legacy_visit_number IS NULL AND staff_user_id IS NOT NULL)),
    -- Khanza reg_periksa.no_rawat, e.g. 2026/11/11/000123.
    CONSTRAINT ck_attachments_legacy_visit_number CHECK (legacy_visit_number ~ '^[0-9/]{1,17}$'),
    CONSTRAINT ck_attachments_title CHECK (length(btrim(title)) BETWEEN 1 AND 200 AND title = btrim(title)),
    CONSTRAINT ck_attachments_description CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
    CONSTRAINT ck_attachments_document_date CHECK (document_date IS NULL OR document_date >= DATE '1900-01-01'),
    CONSTRAINT ck_attachments_source_organization CHECK (
        source_organization IS NULL OR length(btrim(source_organization)) BETWEEN 1 AND 200),
    CONSTRAINT ck_attachments_status CHECK (status IN ('current', 'entered-in-error')),
    CONSTRAINT ck_attachments_status_reason CHECK (
        (status = 'current' AND status_reason IS NULL)
        OR (status = 'entered-in-error' AND status_reason IS NOT NULL AND length(btrim(status_reason)) BETWEEN 1 AND 500))
);
COMMENT ON TABLE document.attachments IS
    'A file attached to a patient, an encounter (legacy visit number) or a staff member (FHIR DocumentReference)';
COMMENT ON COLUMN document.attachments.legacy_visit_number IS
    'Khanza reg_periksa.no_rawat of the encounter, checked against the legacy HMS at upload (encounters are not yet canonical)';
COMMENT ON COLUMN document.attachments.document_date IS 'Date written on the document itself (not the upload date)';
COMMENT ON COLUMN document.attachments.source_organization IS 'Facility or body the document comes from, as typed';
COMMENT ON COLUMN document.attachments.created_by_user_id IS 'Who attached it: the uploader''s work reference';

SELECT hms_meta.enable_versioned_record('document.attachments', 'DocumentReference', 'patient_id',
    'id,organization_id,facility_id,file_id,subject_kind,patient_id,legacy_visit_number,staff_user_id,created_by_user_id');

-- Lists are newest first by id (uuidv7 is time ordered).
CREATE INDEX idx_attachments_patient_id ON document.attachments (organization_id, patient_id, id DESC)
    WHERE patient_id IS NOT NULL;
CREATE INDEX idx_attachments_legacy_visit_number ON document.attachments (organization_id, legacy_visit_number, id DESC)
    WHERE legacy_visit_number IS NOT NULL;
CREATE INDEX idx_attachments_staff_user_id ON document.attachments (organization_id, staff_user_id, id DESC)
    WHERE staff_user_id IS NOT NULL;
CREATE INDEX idx_attachments_created_by_user_id ON document.attachments (organization_id, created_by_user_id, id DESC);
CREATE INDEX idx_attachments_category_code ON document.attachments (category_code);

-- Privileges -----------------------------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA document TO hms_document_rw;
GRANT SELECT ON document.categories, document.resource_versions TO hms_document_rw;
GRANT SELECT, INSERT ON document.files, document.attachments TO hms_document_rw;
-- v1 changes only the status (entered-in-error with a reason); everything else is fixed or corrected by a new file.
GRANT UPDATE (status, status_reason) ON document.attachments TO hms_document_rw;
