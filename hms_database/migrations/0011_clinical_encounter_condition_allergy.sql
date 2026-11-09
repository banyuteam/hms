-- 0011 clinical core: encounters (with status history, participants, locations and diagnoses), conditions and
-- allergies/intolerances (schema clinical, ADR-DB-004). Maps to FHIR R4 Encounter, Condition, AllergyIntolerance as
-- profiled by SATUSEHAT; status codes are the FHIR R4 required bindings.
-- Owner: hms_database (definitions); writes: hms_services clinical modules (hms_clinical_rw); reads: hms_services.
-- Classification: restricted (health data, UU 27/2022 Pasal 4).
-- Clinical meaning is kept apart from technical events: recorder/asserter/performer are practitioners, the
-- transaction actor (resource_versions) is who pressed the button. Nothing here is billing.
-- Integrity: every clinical row carries organization_id and patient_id; composite foreign keys make a row's
-- encounter, patient, facility and practitioners belong to the same organization, and a row's encounter belong to the
-- same patient. Versioned records (ADR-DB-005): history in clinical.resource_versions; no deletes; entered-in-error
-- is terminal; finalized rows change only with a reason; tenant row-level security.
-- Online-safe: creates new objects; adds a nullable column to patient.consents. Rollback: fix forward.

CREATE SCHEMA clinical;
COMMENT ON SCHEMA clinical IS 'hms_database: clinical record (encounters, conditions, observations, medication, procedures, documents)';

SELECT hms_meta.create_version_store('clinical');

CREATE TABLE clinical.encounters (
    id                         uuid        NOT NULL DEFAULT uuidv7(),
    organization_id            uuid        NOT NULL,
    facility_id                uuid        NOT NULL,
    patient_id                 uuid        NOT NULL,
    status                     text        NOT NULL,
    class_code                 text        NOT NULL,
    type_system                text,
    type_code                  text,
    type_display               text,
    priority_code              text,
    period_start               timestamptz,
    period_end                 timestamptz,
    part_of_id                 uuid,
    admit_source_system        text,
    admit_source_code          text,
    discharge_disposition_system text,
    discharge_disposition_code text,
    version                    integer     NOT NULL DEFAULT 1,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    last_xact_id               xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_encounters PRIMARY KEY (id),
    CONSTRAINT uq_encounters_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT uq_encounters_id_patient_id UNIQUE (id, patient_id),
    CONSTRAINT fk_encounters_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_encounters_facility FOREIGN KEY (facility_id, organization_id) REFERENCES platform.facilities (id, organization_id),
    CONSTRAINT fk_encounters_part_of FOREIGN KEY (part_of_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_encounters_type_system FOREIGN KEY (type_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_encounters_admit_source_system FOREIGN KEY (admit_source_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_encounters_discharge_disposition_system FOREIGN KEY (discharge_disposition_system)
        REFERENCES terminology.code_systems (uri),
    -- FHIR R4 EncounterStatus.
    CONSTRAINT ck_encounters_status CHECK (status IN
        ('planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled', 'entered-in-error', 'unknown')),
    -- HL7 v3 ActEncounterCode (FHIR R4 Encounter.class, SATUSEHAT uses AMB, IMP, EMER).
    CONSTRAINT ck_encounters_class_code CHECK (class_code IN
        ('AMB', 'EMER', 'FLD', 'HH', 'IMP', 'ACUTE', 'NONAC', 'OBSENC', 'PRENC', 'SS', 'VR')),
    CONSTRAINT ck_encounters_type CHECK ((type_system IS NULL) = (type_code IS NULL)
                                         AND length(type_code) <= 100 AND length(type_display) <= 500),
    -- HL7 v3 ActPriority subset.
    CONSTRAINT ck_encounters_priority_code CHECK (priority_code IN ('A', 'EL', 'EM', 'R', 'S', 'UR')),
    CONSTRAINT ck_encounters_period CHECK (period_end IS NULL OR (period_start IS NOT NULL AND period_end >= period_start)),
    CONSTRAINT ck_encounters_finished CHECK (status <> 'finished' OR period_end IS NOT NULL),
    CONSTRAINT ck_encounters_part_of CHECK (part_of_id <> id),
    CONSTRAINT ck_encounters_admit_source CHECK ((admit_source_system IS NULL) = (admit_source_code IS NULL)
                                                 AND length(admit_source_code) <= 100),
    CONSTRAINT ck_encounters_discharge_disposition CHECK ((discharge_disposition_system IS NULL) = (discharge_disposition_code IS NULL)
                                                          AND length(discharge_disposition_code) <= 100)
);
COMMENT ON TABLE clinical.encounters IS
    'Encounter (FHIR Encounter): a visit/admission of a patient at a facility; the anchor of episode documentation';
COMMENT ON COLUMN clinical.encounters.period_start IS 'Clinical start instant (stored UTC; render in the facility time zone)';
COMMENT ON COLUMN clinical.encounters.part_of_id IS 'Parent encounter of the same patient (e.g. a consult within an admission)';
CREATE INDEX idx_encounters_patient_id ON clinical.encounters (patient_id, period_start DESC);
CREATE INDEX idx_encounters_facility_open ON clinical.encounters (facility_id, period_start)
    WHERE status IN ('planned', 'arrived', 'triaged', 'in-progress', 'onleave');
CREATE INDEX idx_encounters_part_of_id ON clinical.encounters (part_of_id) WHERE part_of_id IS NOT NULL;

-- Encounter.statusHistory: when each status held (clinical times, not recording times; SATUSEHAT requires it).
CREATE TABLE clinical.encounter_status_history (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    encounter_id     uuid        NOT NULL,
    status           text        NOT NULL,
    period_start     timestamptz NOT NULL,
    period_end       timestamptz,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_encounter_status_history PRIMARY KEY (id),
    CONSTRAINT fk_encounter_status_history_encounter FOREIGN KEY (encounter_id, organization_id)
        REFERENCES clinical.encounters (id, organization_id),
    CONSTRAINT ck_encounter_status_history_status CHECK (status IN
        ('planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled', 'entered-in-error', 'unknown')),
    CONSTRAINT ck_encounter_status_history_period CHECK (period_end IS NULL OR period_end >= period_start)
);
COMMENT ON TABLE clinical.encounter_status_history IS 'Clinical period of each encounter status (FHIR Encounter.statusHistory)';
CREATE INDEX idx_encounter_status_history_encounter_id ON clinical.encounter_status_history (encounter_id, period_start);

CREATE TABLE clinical.encounter_participants (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    encounter_id     uuid        NOT NULL,
    practitioner_id  uuid        NOT NULL,
    type_system      text        NOT NULL,
    type_code        text        NOT NULL,
    period_start     timestamptz,
    period_end       timestamptz,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_encounter_participants PRIMARY KEY (id),
    CONSTRAINT fk_encounter_participants_encounter FOREIGN KEY (encounter_id, organization_id)
        REFERENCES clinical.encounters (id, organization_id),
    CONSTRAINT fk_encounter_participants_practitioner FOREIGN KEY (practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_encounter_participants_type_system FOREIGN KEY (type_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_encounter_participants_type_code CHECK (length(type_code) BETWEEN 1 AND 20),
    CONSTRAINT ck_encounter_participants_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
COMMENT ON TABLE clinical.encounter_participants IS 'Practitioner taking part in an encounter (e.g. v3 ParticipationType ATND attender)';
CREATE INDEX idx_encounter_participants_encounter_id ON clinical.encounter_participants (encounter_id);
CREATE INDEX idx_encounter_participants_practitioner_id ON clinical.encounter_participants (practitioner_id, period_start);

-- Where the patient was during the encounter (clinic room, ward, bed); bed transfers are new rows.
CREATE TABLE clinical.encounter_locations (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    encounter_id     uuid        NOT NULL,
    location_id      uuid        NOT NULL,
    status           text        NOT NULL,
    period_start     timestamptz,
    period_end       timestamptz,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_encounter_locations PRIMARY KEY (id),
    CONSTRAINT fk_encounter_locations_encounter FOREIGN KEY (encounter_id, organization_id)
        REFERENCES clinical.encounters (id, organization_id),
    CONSTRAINT fk_encounter_locations_location FOREIGN KEY (location_id, organization_id)
        REFERENCES platform.locations (id, organization_id),
    -- FHIR R4 EncounterLocationStatus.
    CONSTRAINT ck_encounter_locations_status CHECK (status IN ('planned', 'active', 'reserved', 'completed')),
    CONSTRAINT ck_encounter_locations_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
COMMENT ON TABLE clinical.encounter_locations IS 'Location of the patient during an encounter for a period (FHIR Encounter.location)';
CREATE INDEX idx_encounter_locations_encounter_id ON clinical.encounter_locations (encounter_id);
CREATE INDEX idx_encounter_locations_location_active ON clinical.encounter_locations (location_id) WHERE status = 'active' AND active;

CREATE TABLE clinical.conditions (
    id                        uuid        NOT NULL DEFAULT uuidv7(),
    organization_id           uuid        NOT NULL,
    patient_id                uuid        NOT NULL,
    encounter_id              uuid,
    clinical_status           text,
    verification_status       text        NOT NULL,
    category                  text        NOT NULL,
    severity_system           text,
    severity_code             text,
    code_system               text,
    code                      text,
    code_display              text,
    code_text                 text,
    onset_at                  timestamptz,
    abatement_at              timestamptz,
    recorded_at               timestamptz NOT NULL,
    recorder_practitioner_id  uuid,
    asserter_practitioner_id  uuid,
    note                      text,
    version                   integer     NOT NULL DEFAULT 1,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    last_xact_id              xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_conditions PRIMARY KEY (id),
    CONSTRAINT uq_conditions_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT uq_conditions_id_patient_id UNIQUE (id, patient_id),
    CONSTRAINT fk_conditions_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_conditions_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_conditions_recorder FOREIGN KEY (recorder_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_conditions_asserter FOREIGN KEY (asserter_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_conditions_severity_system FOREIGN KEY (severity_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_conditions_code_system FOREIGN KEY (code_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 condition-clinical / condition-ver-status / condition-category.
    CONSTRAINT ck_conditions_clinical_status CHECK (clinical_status IN
        ('active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved')),
    CONSTRAINT ck_conditions_verification_status CHECK (verification_status IN
        ('unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted', 'entered-in-error')),
    CONSTRAINT ck_conditions_category CHECK (category IN ('problem-list-item', 'encounter-diagnosis')),
    -- con-3/con-5: clinicalStatus absent exactly when entered-in-error (required for problem-list items otherwise).
    CONSTRAINT ck_conditions_con3_con5 CHECK (
        CASE WHEN verification_status = 'entered-in-error' THEN clinical_status IS NULL
             WHEN category = 'problem-list-item' THEN clinical_status IS NOT NULL
             ELSE true END),
    -- con-4: abatement only for inactive, resolved or remission.
    CONSTRAINT ck_conditions_con4 CHECK (abatement_at IS NULL OR clinical_status IN ('inactive', 'resolved', 'remission')),
    CONSTRAINT ck_conditions_severity CHECK ((severity_system IS NULL) = (severity_code IS NULL) AND length(severity_code) <= 100),
    CONSTRAINT ck_conditions_code CHECK ((code_system IS NULL) = (code IS NULL) AND length(code) <= 100
                                         AND length(code_display) <= 500 AND (code IS NOT NULL OR code_text IS NOT NULL)),
    CONSTRAINT ck_conditions_code_text CHECK (length(btrim(code_text)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_conditions_abatement CHECK (abatement_at IS NULL OR onset_at IS NULL OR abatement_at >= onset_at),
    CONSTRAINT ck_conditions_encounter_diagnosis CHECK (category <> 'encounter-diagnosis' OR encounter_id IS NOT NULL),
    CONSTRAINT ck_conditions_note CHECK (length(note) <= 10000)
);
COMMENT ON TABLE clinical.conditions IS
    'Condition (FHIR Condition): problem-list item or encounter diagnosis, coded (e.g. ICD-10) or as text';
COMMENT ON COLUMN clinical.conditions.recorded_at IS 'When the condition was recorded clinically (FHIR recordedDate)';
CREATE INDEX idx_conditions_patient_id ON clinical.conditions (patient_id, recorded_at DESC);
CREATE INDEX idx_conditions_encounter_id ON clinical.conditions (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX idx_conditions_code ON clinical.conditions (code_system, code) WHERE code IS NOT NULL;

-- Encounter.diagnosis: a condition's role in an encounter (admission, discharge, chief complaint, comorbidity) and
-- rank (1 = primary). The condition must be the same patient's.
CREATE TABLE clinical.encounter_diagnoses (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    encounter_id     uuid        NOT NULL,
    patient_id       uuid        NOT NULL,
    condition_id     uuid        NOT NULL,
    use_system       text        NOT NULL,
    use_code         text        NOT NULL,
    rank             smallint,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_encounter_diagnoses PRIMARY KEY (id),
    CONSTRAINT fk_encounter_diagnoses_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_encounter_diagnoses_condition FOREIGN KEY (condition_id, patient_id) REFERENCES clinical.conditions (id, patient_id),
    CONSTRAINT fk_encounter_diagnoses_organization FOREIGN KEY (encounter_id, organization_id)
        REFERENCES clinical.encounters (id, organization_id),
    CONSTRAINT fk_encounter_diagnoses_use_system FOREIGN KEY (use_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_encounter_diagnoses_use_code CHECK (length(use_code) BETWEEN 1 AND 20),
    CONSTRAINT ck_encounter_diagnoses_rank CHECK (rank >= 1)
);
COMMENT ON TABLE clinical.encounter_diagnoses IS 'Diagnosis role and rank of a condition in an encounter (FHIR Encounter.diagnosis)';
CREATE UNIQUE INDEX uq_encounter_diagnoses_active ON clinical.encounter_diagnoses (encounter_id, condition_id, use_code) WHERE active;
CREATE UNIQUE INDEX uq_encounter_diagnoses_primary ON clinical.encounter_diagnoses (encounter_id, use_code) WHERE active AND rank = 1;

CREATE TABLE clinical.allergy_intolerances (
    id                        uuid        NOT NULL DEFAULT uuidv7(),
    organization_id           uuid        NOT NULL,
    patient_id                uuid        NOT NULL,
    encounter_id              uuid,
    clinical_status           text,
    verification_status       text        NOT NULL,
    type                      text,
    categories                text[]      NOT NULL DEFAULT '{}',
    criticality               text,
    code_system               text,
    code                      text,
    code_display              text,
    code_text                 text,
    onset_at                  timestamptz,
    recorded_at               timestamptz NOT NULL,
    recorder_practitioner_id  uuid,
    asserter_practitioner_id  uuid,
    last_occurrence_at        timestamptz,
    note                      text,
    version                   integer     NOT NULL DEFAULT 1,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    last_xact_id              xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_allergy_intolerances PRIMARY KEY (id),
    CONSTRAINT uq_allergy_intolerances_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT fk_allergy_intolerances_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_allergy_intolerances_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_allergy_intolerances_recorder FOREIGN KEY (recorder_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_allergy_intolerances_asserter FOREIGN KEY (asserter_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_allergy_intolerances_code_system FOREIGN KEY (code_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 allergyintolerance-clinical / -verification, AllergyIntoleranceType/Category/Criticality.
    CONSTRAINT ck_allergy_intolerances_clinical_status CHECK (clinical_status IN ('active', 'inactive', 'resolved')),
    CONSTRAINT ck_allergy_intolerances_verification_status CHECK (verification_status IN
        ('unconfirmed', 'confirmed', 'refuted', 'entered-in-error')),
    -- ait-1/ait-2: clinicalStatus present unless entered-in-error, absent if entered-in-error.
    CONSTRAINT ck_allergy_intolerances_ait1_ait2 CHECK ((verification_status = 'entered-in-error') = (clinical_status IS NULL)),
    CONSTRAINT ck_allergy_intolerances_type CHECK (type IN ('allergy', 'intolerance')),
    CONSTRAINT ck_allergy_intolerances_categories CHECK (categories <@ ARRAY['food', 'medication', 'environment', 'biologic']),
    CONSTRAINT ck_allergy_intolerances_criticality CHECK (criticality IN ('low', 'high', 'unable-to-assess')),
    CONSTRAINT ck_allergy_intolerances_code CHECK ((code_system IS NULL) = (code IS NULL) AND length(code) <= 100
                                                   AND length(code_display) <= 500 AND (code IS NOT NULL OR code_text IS NOT NULL)),
    CONSTRAINT ck_allergy_intolerances_code_text CHECK (length(btrim(code_text)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_allergy_intolerances_note CHECK (length(note) <= 10000)
);
COMMENT ON TABLE clinical.allergy_intolerances IS 'Allergy or intolerance (FHIR AllergyIntolerance), coded substance or text';
CREATE INDEX idx_allergy_intolerances_patient_id ON clinical.allergy_intolerances (patient_id, recorded_at DESC);

CREATE TABLE clinical.allergy_reactions (
    id                     uuid        NOT NULL DEFAULT uuidv7(),
    organization_id        uuid        NOT NULL,
    allergy_intolerance_id uuid        NOT NULL,
    manifestation_system   text,
    manifestation_code     text,
    manifestation_display  text,
    manifestation_text     text,
    severity               text,
    onset_at               timestamptz,
    description            text,
    active                 boolean     NOT NULL DEFAULT true,
    version                integer     NOT NULL DEFAULT 1,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    last_xact_id           xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_allergy_reactions PRIMARY KEY (id),
    CONSTRAINT fk_allergy_reactions_allergy FOREIGN KEY (allergy_intolerance_id, organization_id)
        REFERENCES clinical.allergy_intolerances (id, organization_id),
    CONSTRAINT fk_allergy_reactions_manifestation_system FOREIGN KEY (manifestation_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_allergy_reactions_manifestation CHECK ((manifestation_system IS NULL) = (manifestation_code IS NULL)
        AND length(manifestation_code) <= 100 AND length(manifestation_display) <= 500
        AND (manifestation_code IS NOT NULL OR manifestation_text IS NOT NULL)),
    CONSTRAINT ck_allergy_reactions_manifestation_text CHECK (length(btrim(manifestation_text)) BETWEEN 1 AND 1000),
    -- FHIR R4 AllergyIntoleranceSeverity.
    CONSTRAINT ck_allergy_reactions_severity CHECK (severity IN ('mild', 'moderate', 'severe')),
    CONSTRAINT ck_allergy_reactions_description CHECK (length(description) <= 2000)
);
COMMENT ON TABLE clinical.allergy_reactions IS 'Reaction event of an allergy/intolerance (FHIR AllergyIntolerance.reaction)';
CREATE INDEX idx_allergy_reactions_allergy_intolerance_id ON clinical.allergy_reactions (allergy_intolerance_id);

-- Consent may be given for one encounter (general consent at admission).
ALTER TABLE patient.consents ADD COLUMN encounter_id uuid;
ALTER TABLE patient.consents ADD CONSTRAINT fk_consents_encounter FOREIGN KEY (encounter_id, patient_id)
    REFERENCES clinical.encounters (id, patient_id);
COMMENT ON COLUMN patient.consents.encounter_id IS 'Encounter the consent was given for (general consent at registration/admission)';

SELECT hms_meta.enable_versioned_record('clinical.encounters', 'Encounter', 'patient_id',
                                        'id,organization_id,patient_id,facility_id', 'finished,cancelled');
SELECT hms_meta.enable_versioned_record(t.tbl::regclass, t.rtype, '', 'id,organization_id,encounter_id', '',
                                        'clinical.encounters', 'encounter_id')
FROM (VALUES ('clinical.encounter_status_history', 'Encounter.statusHistory'),
             ('clinical.encounter_participants', 'Encounter.participant'),
             ('clinical.encounter_locations', 'Encounter.location')) AS t(tbl, rtype);
SELECT hms_meta.enable_versioned_record('clinical.encounter_diagnoses', 'Encounter.diagnosis', 'patient_id',
                                        'id,organization_id,encounter_id,patient_id,condition_id', '',
                                        'clinical.encounters', 'encounter_id');
SELECT hms_meta.enable_versioned_record('clinical.conditions', 'Condition', 'patient_id',
                                        'id,organization_id,patient_id');
SELECT hms_meta.enable_versioned_record('clinical.allergy_intolerances', 'AllergyIntolerance', 'patient_id',
                                        'id,organization_id,patient_id');
SELECT hms_meta.enable_versioned_record('clinical.allergy_reactions', 'AllergyIntolerance.reaction', '',
                                        'id,organization_id,allergy_intolerance_id', '',
                                        'clinical.allergy_intolerances', 'allergy_intolerance_id');

GRANT USAGE ON SCHEMA clinical TO hms_clinical_rw;
GRANT SELECT, INSERT, UPDATE ON clinical.encounters, clinical.encounter_status_history, clinical.encounter_participants,
    clinical.encounter_locations, clinical.conditions, clinical.encounter_diagnoses, clinical.allergy_intolerances,
    clinical.allergy_reactions TO hms_clinical_rw;
GRANT SELECT ON clinical.resource_versions TO hms_clinical_rw;
