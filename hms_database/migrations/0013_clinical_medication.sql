-- 0013 clinical medication: medication definitions (single product or compounded preparation, "racikan"), requests
-- (prescriptions/orders), dispenses, administrations and patient-reported medication statements (schema clinical,
-- ADR-DB-004). Maps to FHIR R4 Medication, MedicationRequest, MedicationDispense, MedicationAdministration,
-- MedicationStatement; SATUSEHAT codes medications with KFA (http://sys-ids.kemkes.go.id/kfa).
-- Owner: hms_database (definitions); writes: hms_services clinical/pharmacy modules (hms_clinical_rw).
-- Classification: restricted (health data); medication definitions without patient link are internal.
-- The pharmacy domain (formulary, stock, price) is not modeled here and is never the source of clinical facts.
-- Dosage: dosage_text is always kept as written; structured dose/route/timing are filled when known (never derived).
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE TABLE clinical.medications (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    code_system      text,
    code             text,
    code_display     text,
    code_text        text,
    form_system      text,
    form_code        text,
    form_display     text,
    is_compound      boolean     NOT NULL DEFAULT false,
    status           text        NOT NULL DEFAULT 'active',
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_medications PRIMARY KEY (id),
    CONSTRAINT uq_medications_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT fk_medications_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_medications_code_system FOREIGN KEY (code_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_medications_form_system FOREIGN KEY (form_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_medications_code CHECK ((code_system IS NULL) = (code IS NULL) AND length(code) <= 100
                                          AND length(code_display) <= 500 AND (code IS NOT NULL OR code_text IS NOT NULL)),
    CONSTRAINT ck_medications_code_text CHECK (length(btrim(code_text)) BETWEEN 1 AND 500),
    CONSTRAINT ck_medications_form CHECK ((form_system IS NULL) = (form_code IS NULL) AND length(form_code) <= 100
                                          AND length(form_display) <= 500),
    -- FHIR R4 Medication.status.
    CONSTRAINT ck_medications_status CHECK (status IN ('active', 'inactive', 'entered-in-error'))
);
COMMENT ON TABLE clinical.medications IS
    'Medication as prescribed (FHIR Medication): coded product (KFA) or compounded preparation with ingredients';
CREATE INDEX idx_medications_code ON clinical.medications (code_system, code) WHERE code IS NOT NULL;

CREATE TABLE clinical.medication_ingredients (
    id                       uuid        NOT NULL DEFAULT uuidv7(),
    organization_id          uuid        NOT NULL,
    medication_id            uuid        NOT NULL,
    item_system              text,
    item_code                text,
    item_display             text,
    item_text                text,
    is_active_ingredient     boolean,
    strength_numerator       numeric,
    strength_numerator_unit  text,
    strength_numerator_ucum  text,
    strength_denominator     numeric,
    strength_denominator_unit text,
    strength_denominator_ucum text,
    active                   boolean     NOT NULL DEFAULT true,
    version                  integer     NOT NULL DEFAULT 1,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    last_xact_id             xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_medication_ingredients PRIMARY KEY (id),
    CONSTRAINT fk_medication_ingredients_medication FOREIGN KEY (medication_id, organization_id)
        REFERENCES clinical.medications (id, organization_id),
    CONSTRAINT fk_medication_ingredients_item_system FOREIGN KEY (item_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_medication_ingredients_item CHECK ((item_system IS NULL) = (item_code IS NULL) AND length(item_code) <= 100
                                                     AND length(item_display) <= 500 AND (item_code IS NOT NULL OR item_text IS NOT NULL)),
    CONSTRAINT ck_medication_ingredients_item_text CHECK (length(btrim(item_text)) BETWEEN 1 AND 500),
    CONSTRAINT ck_medication_ingredients_strength CHECK (strength_numerator > 0 AND strength_denominator > 0
        AND (strength_numerator IS NOT NULL OR (strength_numerator_unit IS NULL AND strength_numerator_ucum IS NULL))
        AND (strength_denominator IS NOT NULL OR (strength_denominator_unit IS NULL AND strength_denominator_ucum IS NULL))
        AND length(strength_numerator_unit) <= 50 AND length(strength_denominator_unit) <= 50
        AND length(strength_numerator_ucum) <= 50 AND length(strength_denominator_ucum) <= 50)
);
COMMENT ON TABLE clinical.medication_ingredients IS 'Ingredient and strength of a medication (FHIR Medication.ingredient)';
CREATE INDEX idx_medication_ingredients_medication_id ON clinical.medication_ingredients (medication_id);

CREATE TABLE clinical.medication_requests (
    id                        uuid        NOT NULL DEFAULT uuidv7(),
    organization_id           uuid        NOT NULL,
    patient_id                uuid        NOT NULL,
    encounter_id              uuid,
    status                    text        NOT NULL,
    intent                    text        NOT NULL,
    priority                  text,
    medication_id             uuid        NOT NULL,
    authored_at               timestamptz NOT NULL,
    requester_practitioner_id uuid,
    reason_condition_id       uuid,
    prior_request_id          uuid,
    dosage_text               text        NOT NULL,
    dose_value                numeric,
    dose_unit                 text,
    dose_unit_ucum            text,
    route_system              text,
    route_code                text,
    route_display             text,
    timing_frequency          integer,
    timing_period             numeric,
    timing_period_unit        text,
    as_needed                 boolean     NOT NULL DEFAULT false,
    dispense_quantity         numeric,
    dispense_quantity_unit    text,
    supply_days               integer,
    number_of_repeats         integer,
    substitution_allowed      boolean,
    note                      text,
    version                   integer     NOT NULL DEFAULT 1,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    last_xact_id              xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_medication_requests PRIMARY KEY (id),
    CONSTRAINT uq_medication_requests_id_patient_id UNIQUE (id, patient_id),
    CONSTRAINT fk_medication_requests_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_medication_requests_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_medication_requests_medication FOREIGN KEY (medication_id, organization_id)
        REFERENCES clinical.medications (id, organization_id),
    CONSTRAINT fk_medication_requests_requester FOREIGN KEY (requester_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_medication_requests_reason_condition FOREIGN KEY (reason_condition_id, patient_id)
        REFERENCES clinical.conditions (id, patient_id),
    CONSTRAINT fk_medication_requests_prior FOREIGN KEY (prior_request_id, patient_id)
        REFERENCES clinical.medication_requests (id, patient_id),
    CONSTRAINT fk_medication_requests_route_system FOREIGN KEY (route_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 medicationrequest-status / -intent, RequestPriority.
    CONSTRAINT ck_medication_requests_status CHECK (status IN
        ('active', 'on-hold', 'cancelled', 'completed', 'entered-in-error', 'stopped', 'draft', 'unknown')),
    CONSTRAINT ck_medication_requests_intent CHECK (intent IN
        ('proposal', 'plan', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option')),
    CONSTRAINT ck_medication_requests_priority CHECK (priority IN ('routine', 'urgent', 'asap', 'stat')),
    CONSTRAINT ck_medication_requests_prior CHECK (prior_request_id <> id),
    CONSTRAINT ck_medication_requests_dosage_text CHECK (length(btrim(dosage_text)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_medication_requests_dose CHECK (dose_value > 0 AND (dose_value IS NOT NULL OR (dose_unit IS NULL AND dose_unit_ucum IS NULL))
                                                  AND length(dose_unit) <= 50 AND length(dose_unit_ucum) <= 50),
    CONSTRAINT ck_medication_requests_route CHECK ((route_system IS NULL) = (route_code IS NULL) AND length(route_code) <= 100
                                                   AND length(route_display) <= 500),
    -- FHIR UnitsOfTime.
    CONSTRAINT ck_medication_requests_timing CHECK (timing_frequency >= 1 AND timing_period > 0
        AND timing_period_unit IN ('s', 'min', 'h', 'd', 'wk', 'mo', 'a')
        AND (timing_period IS NULL) = (timing_period_unit IS NULL)),
    CONSTRAINT ck_medication_requests_dispense CHECK (dispense_quantity > 0 AND length(dispense_quantity_unit) <= 50
        AND (dispense_quantity IS NOT NULL OR dispense_quantity_unit IS NULL)),
    CONSTRAINT ck_medication_requests_supply CHECK (supply_days >= 1 AND number_of_repeats >= 0),
    CONSTRAINT ck_medication_requests_note CHECK (length(note) <= 5000)
);
COMMENT ON TABLE clinical.medication_requests IS 'Prescription/medication order (FHIR MedicationRequest)';
COMMENT ON COLUMN clinical.medication_requests.dosage_text IS 'Dosage instruction as written by the prescriber (always kept)';
COMMENT ON COLUMN clinical.medication_requests.prior_request_id IS 'Request this one replaces (change of an order keeps the chain)';
CREATE INDEX idx_medication_requests_patient_id ON clinical.medication_requests (patient_id, authored_at DESC);
CREATE INDEX idx_medication_requests_encounter_id ON clinical.medication_requests (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX idx_medication_requests_active ON clinical.medication_requests (patient_id) WHERE status IN ('active', 'on-hold');

CREATE TABLE clinical.medication_dispenses (
    id                        uuid        NOT NULL DEFAULT uuidv7(),
    organization_id           uuid        NOT NULL,
    patient_id                uuid        NOT NULL,
    encounter_id              uuid,
    status                    text        NOT NULL,
    medication_id             uuid        NOT NULL,
    request_id                uuid,
    quantity                  numeric,
    quantity_unit             text,
    days_supply               integer,
    prepared_at               timestamptz,
    handed_over_at            timestamptz,
    performer_practitioner_id uuid,
    location_id               uuid,
    dosage_text               text,
    note                      text,
    version                   integer     NOT NULL DEFAULT 1,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    last_xact_id              xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_medication_dispenses PRIMARY KEY (id),
    CONSTRAINT fk_medication_dispenses_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_medication_dispenses_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_medication_dispenses_medication FOREIGN KEY (medication_id, organization_id)
        REFERENCES clinical.medications (id, organization_id),
    CONSTRAINT fk_medication_dispenses_request FOREIGN KEY (request_id, patient_id)
        REFERENCES clinical.medication_requests (id, patient_id),
    CONSTRAINT fk_medication_dispenses_performer FOREIGN KEY (performer_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_medication_dispenses_location FOREIGN KEY (location_id, organization_id) REFERENCES platform.locations (id, organization_id),
    -- FHIR R4 MedicationDispense status.
    CONSTRAINT ck_medication_dispenses_status CHECK (status IN
        ('preparation', 'in-progress', 'cancelled', 'on-hold', 'completed', 'entered-in-error', 'stopped', 'declined', 'unknown')),
    CONSTRAINT ck_medication_dispenses_quantity CHECK (quantity > 0 AND length(quantity_unit) <= 50
                                                       AND (quantity IS NOT NULL OR quantity_unit IS NULL)),
    CONSTRAINT ck_medication_dispenses_days_supply CHECK (days_supply >= 1),
    CONSTRAINT ck_medication_dispenses_times CHECK (handed_over_at IS NULL OR prepared_at IS NULL OR handed_over_at >= prepared_at),
    CONSTRAINT ck_medication_dispenses_completed CHECK (status <> 'completed' OR handed_over_at IS NOT NULL),
    CONSTRAINT ck_medication_dispenses_dosage_text CHECK (length(btrim(dosage_text)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_medication_dispenses_note CHECK (length(note) <= 5000)
);
COMMENT ON TABLE clinical.medication_dispenses IS 'Medication supplied to a patient (FHIR MedicationDispense)';
CREATE INDEX idx_medication_dispenses_patient_id ON clinical.medication_dispenses (patient_id, handed_over_at DESC);
CREATE INDEX idx_medication_dispenses_request_id ON clinical.medication_dispenses (request_id) WHERE request_id IS NOT NULL;

CREATE TABLE clinical.medication_administrations (
    id                        uuid        NOT NULL DEFAULT uuidv7(),
    organization_id           uuid        NOT NULL,
    patient_id                uuid        NOT NULL,
    encounter_id              uuid,
    status                    text        NOT NULL,
    status_reason_system      text,
    status_reason_code        text,
    medication_id             uuid        NOT NULL,
    request_id                uuid,
    effective_at              timestamptz NOT NULL,
    effective_end             timestamptz,
    performer_practitioner_id uuid,
    dose_value                numeric,
    dose_unit                 text,
    dose_unit_ucum            text,
    route_system              text,
    route_code                text,
    route_display             text,
    note                      text,
    version                   integer     NOT NULL DEFAULT 1,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    last_xact_id              xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_medication_administrations PRIMARY KEY (id),
    CONSTRAINT fk_medication_administrations_patient FOREIGN KEY (patient_id, organization_id)
        REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_medication_administrations_encounter FOREIGN KEY (encounter_id, patient_id)
        REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_medication_administrations_medication FOREIGN KEY (medication_id, organization_id)
        REFERENCES clinical.medications (id, organization_id),
    CONSTRAINT fk_medication_administrations_request FOREIGN KEY (request_id, patient_id)
        REFERENCES clinical.medication_requests (id, patient_id),
    CONSTRAINT fk_medication_administrations_performer FOREIGN KEY (performer_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    CONSTRAINT fk_medication_administrations_status_reason_system FOREIGN KEY (status_reason_system)
        REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_medication_administrations_route_system FOREIGN KEY (route_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 MedicationAdministration status.
    CONSTRAINT ck_medication_administrations_status CHECK (status IN
        ('in-progress', 'not-done', 'on-hold', 'completed', 'entered-in-error', 'stopped', 'unknown')),
    CONSTRAINT ck_medication_administrations_status_reason CHECK ((status_reason_system IS NULL) = (status_reason_code IS NULL)
                                                                  AND length(status_reason_code) <= 100),
    CONSTRAINT ck_medication_administrations_effective CHECK (effective_end IS NULL OR effective_end >= effective_at),
    CONSTRAINT ck_medication_administrations_dose CHECK (dose_value > 0
        AND (dose_value IS NOT NULL OR (dose_unit IS NULL AND dose_unit_ucum IS NULL))
        AND length(dose_unit) <= 50 AND length(dose_unit_ucum) <= 50),
    CONSTRAINT ck_medication_administrations_route CHECK ((route_system IS NULL) = (route_code IS NULL)
                                                          AND length(route_code) <= 100 AND length(route_display) <= 500),
    CONSTRAINT ck_medication_administrations_note CHECK (length(note) <= 5000)
);
COMMENT ON TABLE clinical.medication_administrations IS 'Medication given to a patient (FHIR MedicationAdministration)';
CREATE INDEX idx_medication_administrations_patient_id ON clinical.medication_administrations (patient_id, effective_at DESC);
CREATE INDEX idx_medication_administrations_request_id ON clinical.medication_administrations (request_id) WHERE request_id IS NOT NULL;

-- Medication history reported by the patient, a relative or another provider (anamnesis), distinct from orders.
CREATE TABLE clinical.medication_statements (
    id                        uuid        NOT NULL DEFAULT uuidv7(),
    organization_id           uuid        NOT NULL,
    patient_id                uuid        NOT NULL,
    encounter_id              uuid,
    status                    text        NOT NULL,
    medication_id             uuid        NOT NULL,
    effective_at              timestamptz,
    effective_end             timestamptz,
    asserted_at               timestamptz NOT NULL,
    information_source        text        NOT NULL,
    source_practitioner_id    uuid,
    dosage_text               text,
    note                      text,
    version                   integer     NOT NULL DEFAULT 1,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    last_xact_id              xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_medication_statements PRIMARY KEY (id),
    CONSTRAINT fk_medication_statements_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_medication_statements_encounter FOREIGN KEY (encounter_id, patient_id) REFERENCES clinical.encounters (id, patient_id),
    CONSTRAINT fk_medication_statements_medication FOREIGN KEY (medication_id, organization_id)
        REFERENCES clinical.medications (id, organization_id),
    CONSTRAINT fk_medication_statements_source_practitioner FOREIGN KEY (source_practitioner_id, organization_id)
        REFERENCES workforce.practitioners (id, organization_id),
    -- FHIR R4 medication-statement-status.
    CONSTRAINT ck_medication_statements_status CHECK (status IN
        ('active', 'completed', 'entered-in-error', 'intended', 'stopped', 'on-hold', 'unknown', 'not-taken')),
    CONSTRAINT ck_medication_statements_effective CHECK (effective_end IS NULL OR (effective_at IS NOT NULL AND effective_end >= effective_at)),
    CONSTRAINT ck_medication_statements_information_source CHECK (information_source IN ('patient', 'related_person', 'practitioner')),
    CONSTRAINT ck_medication_statements_source CHECK ((information_source = 'practitioner') = (source_practitioner_id IS NOT NULL)),
    CONSTRAINT ck_medication_statements_dosage_text CHECK (length(btrim(dosage_text)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_medication_statements_note CHECK (length(note) <= 5000)
);
COMMENT ON TABLE clinical.medication_statements IS 'Medication use reported by a source (FHIR MedicationStatement); not an order';
CREATE INDEX idx_medication_statements_patient_id ON clinical.medication_statements (patient_id, asserted_at DESC);

SELECT hms_meta.enable_versioned_record('clinical.medications', 'Medication', NULL, 'id,organization_id');
SELECT hms_meta.enable_versioned_record('clinical.medication_ingredients', 'Medication.ingredient', NULL,
                                        'id,organization_id,medication_id', '', 'clinical.medications', 'medication_id');
SELECT hms_meta.enable_versioned_record('clinical.medication_requests', 'MedicationRequest', 'patient_id',
                                        'id,organization_id,patient_id', 'completed,cancelled,stopped');
SELECT hms_meta.enable_versioned_record('clinical.medication_dispenses', 'MedicationDispense', 'patient_id',
                                        'id,organization_id,patient_id', 'completed,declined');
SELECT hms_meta.enable_versioned_record('clinical.medication_administrations', 'MedicationAdministration', 'patient_id',
                                        'id,organization_id,patient_id', 'completed,not-done');
SELECT hms_meta.enable_versioned_record('clinical.medication_statements', 'MedicationStatement', 'patient_id',
                                        'id,organization_id,patient_id');

GRANT SELECT, INSERT, UPDATE ON clinical.medications, clinical.medication_ingredients, clinical.medication_requests,
    clinical.medication_dispenses, clinical.medication_administrations, clinical.medication_statements TO hms_clinical_rw;
