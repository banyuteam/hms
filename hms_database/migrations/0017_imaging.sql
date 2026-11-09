-- 0017 imaging: DICOM study and series references held by PACS (schema imaging, ADR-DB-004). Maps to FHIR R4
-- ImagingStudy (StudyInstanceUID as identifier system urn:dicom:uid, value urn:oid:<uid>).
-- Owner: hms_database (definitions); writes: hms_services imaging integration (hms_clinical_rw), e.g. from DICOMweb
-- QIDO-RS queries or modality worklist results; reads: hms_services. Classification: restricted (health data).
-- Pixel data, DICOM instances and their metadata stay in PACS; retrieval (WADO-RS) goes through hms_services using
-- the PACS registered in integration.external_systems. No binaries, no endpoints, no credentials here.
-- Versioned records (ADR-DB-005), tenant row-level security.
-- Online-safe: creates new objects; adds a nullable column to clinical.diagnostic_reports. Rollback: fix forward.

CREATE SCHEMA imaging;
COMMENT ON SCHEMA imaging IS 'hms_database: DICOM imaging study/series references (images stay in PACS)';

SELECT hms_meta.create_version_store('imaging');

CREATE TABLE imaging.studies (
    id                        uuid        NOT NULL DEFAULT uuidv7(),
    organization_id           uuid        NOT NULL,
    patient_id                uuid        NOT NULL,
    encounter_id              uuid,
    procedure_id              uuid,
    study_instance_uid        text        NOT NULL,
    accession_number          text,
    status                    text        NOT NULL,
    modalities                text[]      NOT NULL DEFAULT '{}',
    started_at                timestamptz,
    description               text,
    number_of_series          integer,
    number_of_instances       integer,
    referrer_practitioner_id  uuid,
    location_id               uuid,
    pacs_system               text        NOT NULL,
    version                   integer     NOT NULL DEFAULT 1,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    last_xact_id              xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_studies PRIMARY KEY (id),
    CONSTRAINT uq_studies_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT uq_studies_id_patient_id UNIQUE (id, patient_id),
    CONSTRAINT uq_studies_study_instance_uid UNIQUE (organization_id, study_instance_uid),
    CONSTRAINT fk_studies_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_studies_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_studies_procedure FOREIGN KEY (procedure_id, patient_id) REFERENCES clinical.procedures (id, patient_id),
    CONSTRAINT fk_studies_referrer FOREIGN KEY (referrer_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_studies_location FOREIGN KEY (location_id, organization_id) REFERENCES platform.locations (id, organization_id),
    CONSTRAINT fk_studies_pacs_system FOREIGN KEY (pacs_system) REFERENCES integration.external_systems (code),
    -- DICOM UID: digits and dots, components without leading zeros, at most 64 characters.
    CONSTRAINT ck_studies_study_instance_uid CHECK (study_instance_uid ~ '^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))+$'
                                                    AND length(study_instance_uid) <= 64),
    CONSTRAINT ck_studies_accession_number CHECK (length(accession_number) BETWEEN 1 AND 16),
    -- FHIR R4 ImagingStudyStatus.
    CONSTRAINT ck_studies_status CHECK (status IN ('registered', 'available', 'cancelled', 'entered-in-error', 'unknown')),
    -- DICOM modality codes (DCM), e.g. CR, CT, MR, US, DX, MG, XA, NM, PT.
    CONSTRAINT ck_studies_modalities CHECK (array_position(modalities, NULL) IS NULL
        AND array_to_string(modalities, ',') ~ '^([A-Z0-9]{2,16}(,[A-Z0-9]{2,16})*)?$'),
    CONSTRAINT ck_studies_description CHECK (length(description) <= 1000),
    CONSTRAINT ck_studies_counts CHECK (number_of_series >= 0 AND number_of_instances >= 0)
);
COMMENT ON TABLE imaging.studies IS 'DICOM imaging study held in PACS (FHIR ImagingStudy); metadata and references only';
COMMENT ON COLUMN imaging.studies.study_instance_uid IS 'DICOM StudyInstanceUID (0020,000D); exchanged as urn:oid:<uid>';
COMMENT ON COLUMN imaging.studies.accession_number IS 'RIS/PACS accession number linking the order to the study';
CREATE INDEX idx_studies_patient_id ON imaging.studies (patient_id, started_at DESC);
CREATE INDEX idx_studies_accession_number ON imaging.studies (organization_id, accession_number) WHERE accession_number IS NOT NULL;

CREATE TABLE imaging.series (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    organization_id      uuid        NOT NULL,
    study_id             uuid        NOT NULL,
    series_instance_uid  text        NOT NULL,
    series_number        integer,
    modality             text        NOT NULL,
    description          text,
    number_of_instances  integer,
    body_site_system     text,
    body_site_code       text,
    body_site_display    text,
    laterality_code      text,
    started_at           timestamptz,
    performer_practitioner_id uuid,
    active               boolean     NOT NULL DEFAULT true,
    version              integer     NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    last_xact_id         xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_series PRIMARY KEY (id),
    CONSTRAINT uq_series_series_instance_uid UNIQUE (organization_id, series_instance_uid),
    CONSTRAINT fk_series_study FOREIGN KEY (study_id, organization_id) REFERENCES imaging.studies (id, organization_id),
    CONSTRAINT fk_series_performer FOREIGN KEY (performer_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_series_body_site_system FOREIGN KEY (body_site_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_series_series_instance_uid CHECK (series_instance_uid ~ '^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))+$'
                                                    AND length(series_instance_uid) <= 64),
    CONSTRAINT ck_series_series_number CHECK (series_number >= 0),
    CONSTRAINT ck_series_modality CHECK (modality ~ '^[A-Z0-9]{2,16}$'),
    CONSTRAINT ck_series_description CHECK (length(description) <= 1000),
    CONSTRAINT ck_series_number_of_instances CHECK (number_of_instances >= 0),
    CONSTRAINT ck_series_body_site CHECK ((body_site_system IS NULL) = (body_site_code IS NULL) AND length(body_site_code) <= 100
                                          AND length(body_site_display) <= 500),
    -- DICOM laterality (0020,0060): R right, L left, B both, U unpaired (FHIR R4 uses SNOMED for display; code kept as recorded).
    CONSTRAINT ck_series_laterality_code CHECK (laterality_code IN ('R', 'L', 'B', 'U'))
);
COMMENT ON TABLE imaging.series IS 'DICOM series of a study (FHIR ImagingStudy.series); instances stay in PACS';
CREATE INDEX idx_series_study_id ON imaging.series (study_id);

ALTER TABLE clinical.diagnostic_reports ADD COLUMN imaging_study_id uuid;
ALTER TABLE clinical.diagnostic_reports ADD CONSTRAINT fk_diagnostic_reports_imaging_study
    FOREIGN KEY (imaging_study_id, patient_id) REFERENCES imaging.studies (id, patient_id);
COMMENT ON COLUMN clinical.diagnostic_reports.imaging_study_id IS 'Imaging study a radiology report interprets (same patient)';
CREATE INDEX idx_diagnostic_reports_imaging_study_id ON clinical.diagnostic_reports (imaging_study_id) WHERE imaging_study_id IS NOT NULL;

INSERT INTO integration.external_systems (code, kind, name) VALUES ('pacs', 'pacs', 'Hospital PACS (DICOMweb)');

SELECT hms_meta.enable_versioned_record('imaging.studies', 'ImagingStudy', 'patient_id',
                                        'id,organization_id,patient_id,study_instance_uid');
SELECT hms_meta.enable_versioned_record('imaging.series', 'ImagingStudy.series', '',
                                        'id,organization_id,study_id,series_instance_uid', '', 'imaging.studies', 'study_id');

GRANT USAGE ON SCHEMA imaging TO hms_clinical_rw;
GRANT SELECT, INSERT, UPDATE ON imaging.studies, imaging.series TO hms_clinical_rw;
GRANT SELECT ON imaging.resource_versions TO hms_clinical_rw;
