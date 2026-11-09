-- 0012 clinical results and interventions: observations (vital signs, lab results, exam findings) with components,
-- procedures with performers, and diagnostic reports linking result observations (schema clinical, ADR-DB-004).
-- Maps to FHIR R4 Observation, Procedure, DiagnosticReport. An order (ServiceRequest) is a separate concept owned by
-- the future orders domain; result and report are distinct (a report groups and interprets observations).
-- Owner: hms_database (definitions); writes: hms_services clinical modules (hms_clinical_rw); reads: hms_services.
-- Classification: restricted (health data).
-- Units: quantities carry the human unit and, when coded, a UCUM code; numbers are NUMERIC (no float).
-- Finalized results (final/amended/corrected/appended) change only with hms.change_reason; history keeps every
-- version (ADR-DB-005).
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE TABLE clinical.observations (
    id                     uuid        NOT NULL DEFAULT uuidv7(),
    organization_id        uuid        NOT NULL,
    patient_id             uuid        NOT NULL,
    encounter_id           uuid,
    parent_observation_id  uuid,
    status                 text        NOT NULL,
    category_system        text,
    category_code          text,
    code_system            text        NOT NULL,
    code                   text        NOT NULL,
    code_display           text,
    effective_at           timestamptz,
    effective_end          timestamptz,
    issued_at              timestamptz,
    performer_practitioner_id uuid,
    value_quantity         numeric,
    value_comparator       text,
    value_unit             text,
    value_unit_system      text,
    value_unit_code        text,
    value_code_system      text,
    value_code             text,
    value_code_display     text,
    value_string           text,
    value_boolean          boolean,
    value_integer          bigint,
    value_datetime         timestamptz,
    data_absent_reason     text,
    interpretation_system  text,
    interpretation_code    text,
    reference_low          numeric,
    reference_high         numeric,
    reference_text         text,
    body_site_system       text,
    body_site_code         text,
    body_site_display      text,
    method_system          text,
    method_code            text,
    method_display         text,
    note                   text,
    version                integer     NOT NULL DEFAULT 1,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    last_xact_id           xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_observations PRIMARY KEY (id),
    CONSTRAINT uq_observations_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT uq_observations_id_patient_id UNIQUE (id, patient_id),
    CONSTRAINT fk_observations_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_observations_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_observations_parent FOREIGN KEY (parent_observation_id, patient_id) REFERENCES clinical.observations (id, patient_id),
    CONSTRAINT fk_observations_performer FOREIGN KEY (performer_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_observations_category_system FOREIGN KEY (category_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_observations_code_system FOREIGN KEY (code_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_observations_value_unit_system FOREIGN KEY (value_unit_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_observations_value_code_system FOREIGN KEY (value_code_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_observations_interpretation_system FOREIGN KEY (interpretation_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_observations_body_site_system FOREIGN KEY (body_site_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_observations_method_system FOREIGN KEY (method_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 ObservationStatus.
    CONSTRAINT ck_observations_status CHECK (status IN
        ('registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown')),
    CONSTRAINT ck_observations_category CHECK ((category_system IS NULL) = (category_code IS NULL) AND length(category_code) <= 100),
    CONSTRAINT ck_observations_code CHECK (length(code) BETWEEN 1 AND 100 AND length(code_display) <= 500),
    CONSTRAINT ck_observations_effective CHECK (effective_end IS NULL OR (effective_at IS NOT NULL AND effective_end >= effective_at)),
    CONSTRAINT ck_observations_parent CHECK (parent_observation_id <> id),
    -- One value[x] at most; obs-6: dataAbsentReason only without a value.
    CONSTRAINT ck_observations_one_value CHECK (num_nonnulls(value_quantity, value_code, value_string, value_boolean,
                                                             value_integer, value_datetime) <= 1),
    CONSTRAINT ck_observations_obs6 CHECK (data_absent_reason IS NULL OR num_nonnulls(value_quantity, value_code,
        value_string, value_boolean, value_integer, value_datetime) = 0),
    CONSTRAINT ck_observations_quantity CHECK ((value_quantity IS NOT NULL OR (value_comparator IS NULL AND value_unit IS NULL
                                                AND value_unit_code IS NULL))
                                               AND (value_unit_system IS NULL) = (value_unit_code IS NULL)
                                               AND length(value_unit) <= 50 AND length(value_unit_code) <= 50),
    CONSTRAINT ck_observations_value_comparator CHECK (value_comparator IN ('<', '<=', '>=', '>')),
    CONSTRAINT ck_observations_value_code CHECK ((value_code_system IS NULL) = (value_code IS NULL)
                                                 AND length(value_code) <= 100 AND length(value_code_display) <= 500),
    CONSTRAINT ck_observations_value_string CHECK (length(value_string) <= 10000),
    -- FHIR data-absent-reason codes.
    CONSTRAINT ck_observations_data_absent_reason CHECK (data_absent_reason IN
        ('unknown', 'asked-unknown', 'temp-unknown', 'not-asked', 'asked-declined', 'masked', 'not-applicable',
         'unsupported', 'as-text', 'error', 'not-a-number', 'negative-infinity', 'positive-infinity', 'not-performed',
         'not-permitted')),
    CONSTRAINT ck_observations_interpretation CHECK ((interpretation_system IS NULL) = (interpretation_code IS NULL)
                                                     AND length(interpretation_code) <= 20),
    CONSTRAINT ck_observations_reference CHECK (reference_high IS NULL OR reference_low IS NULL OR reference_high >= reference_low),
    CONSTRAINT ck_observations_reference_text CHECK (length(reference_text) <= 500),
    CONSTRAINT ck_observations_body_site CHECK ((body_site_system IS NULL) = (body_site_code IS NULL) AND length(body_site_code) <= 100
                                                AND length(body_site_display) <= 500),
    CONSTRAINT ck_observations_method CHECK ((method_system IS NULL) = (method_code IS NULL) AND length(method_code) <= 100
                                             AND length(method_display) <= 500),
    CONSTRAINT ck_observations_note CHECK (length(note) <= 10000)
);
COMMENT ON TABLE clinical.observations IS
    'Observation (FHIR Observation): measurement or finding, coded (e.g. LOINC), one typed value or components';
COMMENT ON COLUMN clinical.observations.parent_observation_id IS 'Panel this observation belongs to (FHIR hasMember, inverted)';
COMMENT ON COLUMN clinical.observations.effective_at IS 'Clinically relevant time (or period start with effective_end)';
COMMENT ON COLUMN clinical.observations.issued_at IS 'When this version was made available (e.g. lab result release)';
COMMENT ON COLUMN clinical.observations.value_unit_code IS 'UCUM code when value_unit_system is http://unitsofmeasure.org';
CREATE INDEX idx_observations_patient_code ON clinical.observations (patient_id, code_system, code, effective_at DESC);
CREATE INDEX idx_observations_patient_effective ON clinical.observations (patient_id, effective_at DESC);
CREATE INDEX idx_observations_encounter_id ON clinical.observations (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX idx_observations_parent ON clinical.observations (parent_observation_id) WHERE parent_observation_id IS NOT NULL;

-- Components: parts measured together (blood pressure systolic/diastolic).
CREATE TABLE clinical.observation_components (
    id                    uuid        NOT NULL DEFAULT uuidv7(),
    organization_id       uuid        NOT NULL,
    observation_id        uuid        NOT NULL,
    code_system           text        NOT NULL,
    code                  text        NOT NULL,
    code_display          text,
    value_quantity        numeric,
    value_comparator      text,
    value_unit            text,
    value_unit_system     text,
    value_unit_code       text,
    value_code_system     text,
    value_code            text,
    value_code_display    text,
    value_string          text,
    value_boolean         boolean,
    value_integer         bigint,
    data_absent_reason    text,
    interpretation_system text,
    interpretation_code   text,
    reference_low         numeric,
    reference_high        numeric,
    active                boolean     NOT NULL DEFAULT true,
    version               integer     NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    last_xact_id          xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_observation_components PRIMARY KEY (id),
    CONSTRAINT fk_observation_components_observation FOREIGN KEY (observation_id, organization_id)
        REFERENCES clinical.observations (id, organization_id),
    CONSTRAINT fk_observation_components_code_system FOREIGN KEY (code_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_observation_components_value_unit_system FOREIGN KEY (value_unit_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_observation_components_value_code_system FOREIGN KEY (value_code_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_observation_components_interpretation_system FOREIGN KEY (interpretation_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_observation_components_code CHECK (length(code) BETWEEN 1 AND 100 AND length(code_display) <= 500),
    CONSTRAINT ck_observation_components_one_value CHECK (num_nonnulls(value_quantity, value_code, value_string,
                                                                       value_boolean, value_integer) <= 1),
    CONSTRAINT ck_observation_components_obs6 CHECK (data_absent_reason IS NULL OR num_nonnulls(value_quantity, value_code,
        value_string, value_boolean, value_integer) = 0),
    CONSTRAINT ck_observation_components_quantity CHECK ((value_quantity IS NOT NULL OR (value_comparator IS NULL AND value_unit IS NULL
                                                          AND value_unit_code IS NULL))
                                                         AND (value_unit_system IS NULL) = (value_unit_code IS NULL)
                                                         AND length(value_unit) <= 50 AND length(value_unit_code) <= 50),
    CONSTRAINT ck_observation_components_value_comparator CHECK (value_comparator IN ('<', '<=', '>=', '>')),
    CONSTRAINT ck_observation_components_value_code CHECK ((value_code_system IS NULL) = (value_code IS NULL)
                                                           AND length(value_code) <= 100 AND length(value_code_display) <= 500),
    CONSTRAINT ck_observation_components_value_string CHECK (length(value_string) <= 2000),
    CONSTRAINT ck_observation_components_data_absent_reason CHECK (data_absent_reason IN
        ('unknown', 'asked-unknown', 'temp-unknown', 'not-asked', 'asked-declined', 'masked', 'not-applicable',
         'unsupported', 'as-text', 'error', 'not-a-number', 'negative-infinity', 'positive-infinity', 'not-performed',
         'not-permitted')),
    CONSTRAINT ck_observation_components_interpretation CHECK ((interpretation_system IS NULL) = (interpretation_code IS NULL)
                                                               AND length(interpretation_code) <= 20),
    CONSTRAINT ck_observation_components_reference CHECK (reference_high IS NULL OR reference_low IS NULL OR reference_high >= reference_low)
);
COMMENT ON TABLE clinical.observation_components IS 'Component of an observation (FHIR Observation.component)';
CREATE INDEX idx_observation_components_observation_id ON clinical.observation_components (observation_id);

CREATE TABLE clinical.procedures (
    id                        uuid        NOT NULL DEFAULT uuidv7(),
    organization_id           uuid        NOT NULL,
    patient_id                uuid        NOT NULL,
    encounter_id              uuid,
    status                    text        NOT NULL,
    status_reason_system      text,
    status_reason_code        text,
    category_system           text,
    category_code             text,
    code_system               text,
    code                      text,
    code_display              text,
    code_text                 text,
    performed_at              timestamptz,
    performed_end             timestamptz,
    recorder_practitioner_id  uuid,
    asserter_practitioner_id  uuid,
    location_id               uuid,
    reason_condition_id       uuid,
    outcome_system            text,
    outcome_code              text,
    outcome_display           text,
    body_site_system          text,
    body_site_code            text,
    body_site_display         text,
    note                      text,
    version                   integer     NOT NULL DEFAULT 1,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    last_xact_id              xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_procedures PRIMARY KEY (id),
    CONSTRAINT uq_procedures_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT uq_procedures_id_patient_id UNIQUE (id, patient_id),
    CONSTRAINT fk_procedures_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_procedures_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_procedures_recorder FOREIGN KEY (recorder_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_procedures_asserter FOREIGN KEY (asserter_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_procedures_location FOREIGN KEY (location_id, organization_id) REFERENCES platform.locations (id, organization_id),
    CONSTRAINT fk_procedures_reason_condition FOREIGN KEY (reason_condition_id, patient_id) REFERENCES clinical.conditions (id, patient_id),
    CONSTRAINT fk_procedures_status_reason_system FOREIGN KEY (status_reason_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_procedures_category_system FOREIGN KEY (category_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_procedures_code_system FOREIGN KEY (code_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_procedures_outcome_system FOREIGN KEY (outcome_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_procedures_body_site_system FOREIGN KEY (body_site_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 EventStatus.
    CONSTRAINT ck_procedures_status CHECK (status IN
        ('preparation', 'in-progress', 'not-done', 'on-hold', 'stopped', 'completed', 'entered-in-error', 'unknown')),
    CONSTRAINT ck_procedures_status_reason CHECK ((status_reason_system IS NULL) = (status_reason_code IS NULL)
                                                  AND length(status_reason_code) <= 100),
    CONSTRAINT ck_procedures_category CHECK ((category_system IS NULL) = (category_code IS NULL) AND length(category_code) <= 100),
    CONSTRAINT ck_procedures_code CHECK ((code_system IS NULL) = (code IS NULL) AND length(code) <= 100
                                         AND length(code_display) <= 500 AND (code IS NOT NULL OR code_text IS NOT NULL)),
    CONSTRAINT ck_procedures_code_text CHECK (length(btrim(code_text)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_procedures_performed CHECK (performed_end IS NULL OR (performed_at IS NOT NULL AND performed_end >= performed_at)),
    CONSTRAINT ck_procedures_completed CHECK (status <> 'completed' OR performed_at IS NOT NULL),
    CONSTRAINT ck_procedures_outcome CHECK ((outcome_system IS NULL) = (outcome_code IS NULL) AND length(outcome_code) <= 100
                                            AND length(outcome_display) <= 500),
    CONSTRAINT ck_procedures_body_site CHECK ((body_site_system IS NULL) = (body_site_code IS NULL) AND length(body_site_code) <= 100
                                              AND length(body_site_display) <= 500),
    CONSTRAINT ck_procedures_note CHECK (length(note) <= 10000)
);
COMMENT ON TABLE clinical.procedures IS
    'Procedure performed (FHIR Procedure), coded (e.g. ICD-9-CM, SNOMED CT) or text; not a billing line';
CREATE INDEX idx_procedures_patient_id ON clinical.procedures (patient_id, performed_at DESC);
CREATE INDEX idx_procedures_encounter_id ON clinical.procedures (encounter_id) WHERE encounter_id IS NOT NULL;

CREATE TABLE clinical.procedure_performers (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    procedure_id     uuid        NOT NULL,
    practitioner_id  uuid        NOT NULL,
    function_system  text,
    function_code    text,
    function_display text,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_procedure_performers PRIMARY KEY (id),
    CONSTRAINT fk_procedure_performers_procedure FOREIGN KEY (procedure_id, organization_id)
        REFERENCES clinical.procedures (id, organization_id),
    CONSTRAINT fk_procedure_performers_practitioner FOREIGN KEY (practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_procedure_performers_function_system FOREIGN KEY (function_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_procedure_performers_function CHECK ((function_system IS NULL) = (function_code IS NULL)
                                                       AND length(function_code) <= 100 AND length(function_display) <= 500)
);
COMMENT ON TABLE clinical.procedure_performers IS 'Practitioner who performed a procedure and in which function';
CREATE INDEX idx_procedure_performers_procedure_id ON clinical.procedure_performers (procedure_id);
CREATE INDEX idx_procedure_performers_practitioner_id ON clinical.procedure_performers (practitioner_id);

CREATE TABLE clinical.diagnostic_reports (
    id                       uuid        NOT NULL DEFAULT uuidv7(),
    organization_id          uuid        NOT NULL,
    patient_id               uuid        NOT NULL,
    encounter_id             uuid,
    status                   text        NOT NULL,
    category_system          text,
    category_code            text,
    code_system              text        NOT NULL,
    code                     text        NOT NULL,
    code_display             text,
    effective_at             timestamptz,
    effective_end            timestamptz,
    issued_at                timestamptz,
    performer_practitioner_id uuid,
    interpreter_practitioner_id uuid,
    conclusion               text,
    conclusion_system        text,
    conclusion_code          text,
    conclusion_display       text,
    presented_form_ref       text,
    presented_form_sha256    bytea,
    version                  integer     NOT NULL DEFAULT 1,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    last_xact_id             xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_diagnostic_reports PRIMARY KEY (id),
    CONSTRAINT uq_diagnostic_reports_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT uq_diagnostic_reports_id_patient_id UNIQUE (id, patient_id),
    CONSTRAINT fk_diagnostic_reports_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_diagnostic_reports_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_diagnostic_reports_performer FOREIGN KEY (performer_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_diagnostic_reports_interpreter FOREIGN KEY (interpreter_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_diagnostic_reports_category_system FOREIGN KEY (category_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_diagnostic_reports_code_system FOREIGN KEY (code_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_diagnostic_reports_conclusion_system FOREIGN KEY (conclusion_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 DiagnosticReportStatus.
    CONSTRAINT ck_diagnostic_reports_status CHECK (status IN
        ('registered', 'partial', 'preliminary', 'final', 'amended', 'corrected', 'appended', 'cancelled',
         'entered-in-error', 'unknown')),
    CONSTRAINT ck_diagnostic_reports_category CHECK ((category_system IS NULL) = (category_code IS NULL) AND length(category_code) <= 100),
    CONSTRAINT ck_diagnostic_reports_code CHECK (length(code) BETWEEN 1 AND 100 AND length(code_display) <= 500),
    CONSTRAINT ck_diagnostic_reports_effective CHECK (effective_end IS NULL OR (effective_at IS NOT NULL AND effective_end >= effective_at)),
    CONSTRAINT ck_diagnostic_reports_conclusion CHECK (length(conclusion) <= 20000),
    CONSTRAINT ck_diagnostic_reports_conclusion_code CHECK ((conclusion_system IS NULL) = (conclusion_code IS NULL)
                                                            AND length(conclusion_code) <= 100 AND length(conclusion_display) <= 500),
    CONSTRAINT ck_diagnostic_reports_presented_form CHECK ((presented_form_ref IS NULL) = (presented_form_sha256 IS NULL)
        AND length(presented_form_ref) <= 500 AND octet_length(presented_form_sha256) = 32),
    CONSTRAINT ck_diagnostic_reports_final_issued CHECK (status NOT IN ('final', 'amended', 'corrected', 'appended') OR issued_at IS NOT NULL)
);
COMMENT ON TABLE clinical.diagnostic_reports IS
    'Diagnostic report (FHIR DiagnosticReport): interpreted lab/radiology result grouping observations';
COMMENT ON COLUMN clinical.diagnostic_reports.presented_form_ref IS 'Object-storage key of the rendered report (e.g. PDF); binary kept outside PostgreSQL';
CREATE INDEX idx_diagnostic_reports_patient_id ON clinical.diagnostic_reports (patient_id, effective_at DESC);
CREATE INDEX idx_diagnostic_reports_encounter_id ON clinical.diagnostic_reports (encounter_id) WHERE encounter_id IS NOT NULL;

CREATE TABLE clinical.diagnostic_report_results (
    id                    uuid        NOT NULL DEFAULT uuidv7(),
    organization_id       uuid        NOT NULL,
    diagnostic_report_id  uuid        NOT NULL,
    patient_id            uuid        NOT NULL,
    observation_id        uuid        NOT NULL,
    ordinal               smallint    NOT NULL DEFAULT 1,
    active                boolean     NOT NULL DEFAULT true,
    version               integer     NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    last_xact_id          xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_diagnostic_report_results PRIMARY KEY (id),
    CONSTRAINT fk_diagnostic_report_results_report FOREIGN KEY (diagnostic_report_id, patient_id)
        REFERENCES clinical.diagnostic_reports (id, patient_id),
    CONSTRAINT fk_diagnostic_report_results_organization FOREIGN KEY (diagnostic_report_id, organization_id)
        REFERENCES clinical.diagnostic_reports (id, organization_id),
    CONSTRAINT fk_diagnostic_report_results_observation FOREIGN KEY (observation_id, patient_id)
        REFERENCES clinical.observations (id, patient_id),
    CONSTRAINT ck_diagnostic_report_results_ordinal CHECK (ordinal >= 1)
);
COMMENT ON TABLE clinical.diagnostic_report_results IS 'Observation reported in a diagnostic report (same patient)';
CREATE UNIQUE INDEX uq_diagnostic_report_results_active ON clinical.diagnostic_report_results (diagnostic_report_id, observation_id) WHERE active;
CREATE INDEX idx_diagnostic_report_results_observation_id ON clinical.diagnostic_report_results (observation_id);

SELECT hms_meta.enable_versioned_record('clinical.observations', 'Observation', 'patient_id',
                                        'id,organization_id,patient_id', 'final,amended,corrected');
SELECT hms_meta.enable_versioned_record('clinical.observation_components', 'Observation.component', '',
                                        'id,organization_id,observation_id', '', 'clinical.observations', 'observation_id');
SELECT hms_meta.enable_versioned_record('clinical.procedures', 'Procedure', 'patient_id',
                                        'id,organization_id,patient_id', 'completed,not-done');
SELECT hms_meta.enable_versioned_record('clinical.procedure_performers', 'Procedure.performer', '',
                                        'id,organization_id,procedure_id', '', 'clinical.procedures', 'procedure_id');
SELECT hms_meta.enable_versioned_record('clinical.diagnostic_reports', 'DiagnosticReport', 'patient_id',
                                        'id,organization_id,patient_id', 'final,amended,corrected,appended');
SELECT hms_meta.enable_versioned_record('clinical.diagnostic_report_results', 'DiagnosticReport.result', 'patient_id',
                                        'id,organization_id,diagnostic_report_id,patient_id,observation_id', '',
                                        'clinical.diagnostic_reports', 'diagnostic_report_id');

GRANT SELECT, INSERT, UPDATE ON clinical.observations, clinical.observation_components, clinical.procedures,
    clinical.procedure_performers, clinical.diagnostic_reports, clinical.diagnostic_report_results TO hms_clinical_rw;
