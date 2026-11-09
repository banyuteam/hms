-- 0018 readmodel: Clinical Read Model projections for the longitudinal patient record (schema readmodel, ADR-DB-004).
--   patient_summaries   one row per patient: banner data and counts for the chart header
--   clinical_timeline   one row per clinical resource (latest version): the patient's history across encounters
--   projection_checkpoints  progress of each projection consumer
-- Owner: hms_database (definitions); writes: hms_services projection consumers fed by eventing.outbox_events
-- (hms_readmodel_rw); reads: hms_services query endpoints. Classification: restricted (derived health data).
-- Projections are derived and rebuildable: the canonical record (patient, clinical, imaging) stays the source of
-- truth, rows may be deleted and rebuilt, and consumers are idempotent (apply a version only if newer:
--   INSERT ... ON CONFLICT (resource_type, resource_id) DO UPDATE SET ...
--   WHERE readmodel.clinical_timeline.resource_version < EXCLUDED.resource_version).
-- summary is short structured text built from coded data; free-text notes are not copied.
-- Online-safe: creates new objects only. Rollback: fix forward (drop and rebuild projections if needed).

CREATE SCHEMA readmodel;
COMMENT ON SCHEMA readmodel IS 'hms_database: derived, rebuildable clinical read models';

CREATE TABLE readmodel.projection_checkpoints (
    projection_name          text        NOT NULL,
    status                   text        NOT NULL DEFAULT 'running',
    last_event_recorded_at   timestamptz,
    events_applied           bigint      NOT NULL DEFAULT 0,
    rebuild_started_at       timestamptz,
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_projection_checkpoints PRIMARY KEY (projection_name),
    CONSTRAINT ck_projection_checkpoints_name CHECK (projection_name ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    CONSTRAINT ck_projection_checkpoints_status CHECK (status IN ('running', 'rebuilding', 'paused')),
    CONSTRAINT ck_projection_checkpoints_events_applied CHECK (events_applied >= 0),
    CONSTRAINT ck_projection_checkpoints_rebuild CHECK ((status = 'rebuilding') = (rebuild_started_at IS NOT NULL))
);
COMMENT ON TABLE readmodel.projection_checkpoints IS 'Progress and state of each projection consumer (no PHI)';

CREATE TABLE readmodel.patient_summaries (
    patient_id               uuid        NOT NULL,
    organization_id          uuid        NOT NULL,
    patient_version          integer     NOT NULL,
    display_name             text        NOT NULL,
    administrative_gender    text        NOT NULL,
    birth_date               date,
    deceased                 boolean     NOT NULL DEFAULT false,
    active                   boolean     NOT NULL,
    active_problem_count     integer     NOT NULL DEFAULT 0,
    active_allergy_count     integer     NOT NULL DEFAULT 0,
    active_medication_count  integer     NOT NULL DEFAULT 0,
    last_encounter_id        uuid,
    last_encounter_at        timestamptz,
    projected_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_patient_summaries PRIMARY KEY (patient_id),
    CONSTRAINT fk_patient_summaries_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT ck_patient_summaries_patient_version CHECK (patient_version >= 1),
    CONSTRAINT ck_patient_summaries_display_name CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_patient_summaries_counts CHECK (active_problem_count >= 0 AND active_allergy_count >= 0
                                                  AND active_medication_count >= 0)
);
COMMENT ON TABLE readmodel.patient_summaries IS 'Chart banner projection per patient (derived; rebuildable)';

CREATE TABLE readmodel.clinical_timeline (
    resource_type     text        NOT NULL,
    resource_id       uuid        NOT NULL,
    resource_version  integer     NOT NULL,
    organization_id   uuid        NOT NULL,
    patient_id        uuid        NOT NULL,
    encounter_id      uuid,
    facility_id       uuid,
    occurred_at       timestamptz,
    status            text        NOT NULL,
    code_system       text,
    code              text,
    display           text,
    summary           text,
    projected_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_clinical_timeline PRIMARY KEY (resource_type, resource_id),
    CONSTRAINT fk_clinical_timeline_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT ck_clinical_timeline_resource_type CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
    CONSTRAINT ck_clinical_timeline_resource_version CHECK (resource_version >= 1),
    CONSTRAINT ck_clinical_timeline_status CHECK (length(status) BETWEEN 1 AND 40),
    CONSTRAINT ck_clinical_timeline_code CHECK ((code_system IS NULL) = (code IS NULL) AND length(code) <= 100),
    CONSTRAINT ck_clinical_timeline_display CHECK (length(display) <= 500),
    CONSTRAINT ck_clinical_timeline_summary CHECK (length(summary) <= 500)
);
COMMENT ON TABLE readmodel.clinical_timeline IS
    'Longitudinal patient timeline: latest version of each clinical resource (derived; rebuildable)';
COMMENT ON COLUMN readmodel.clinical_timeline.summary IS 'Short text built from coded values (e.g. "BP 120/80 mm[Hg]"); no free-text notes';
CREATE INDEX idx_clinical_timeline_patient ON readmodel.clinical_timeline (patient_id, occurred_at DESC);
CREATE INDEX idx_clinical_timeline_encounter ON readmodel.clinical_timeline (encounter_id, occurred_at) WHERE encounter_id IS NOT NULL;

SELECT hms_meta.enable_tenant_rls(t::regclass)
FROM unnest(ARRAY['readmodel.patient_summaries', 'readmodel.clinical_timeline']) AS t;

GRANT USAGE ON SCHEMA readmodel TO hms_readmodel_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON readmodel.projection_checkpoints, readmodel.patient_summaries,
    readmodel.clinical_timeline TO hms_readmodel_rw;
