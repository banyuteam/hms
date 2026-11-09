-- 0020 analytics: pseudonymized clinical facts for reporting and clinical analytics (schema analytics, ADR-DB-004).
-- Owner: hms_database (definitions); reads: reporting (hms_report_read). Classification: confidential (pseudonymized;
-- re-identifiable only through the pseudonym tables, which only the owner can read).
-- UU 27/2022 and Permenkes 24/2022 Pasal 35(2): analytics uses data without direct identifiers. The views expose a
-- random pseudonym per patient and per encounter, age in years, administrative gender, coded facts and dates; never
-- names, identifiers, contact data, addresses, free text or internal record ids. Small-cell suppression and output
-- review are reporting-process controls (documentation/standards-traceability.md), not enforced here.
-- The views run with the owner's rights (not security_invoker), so reporting sees pseudonymized facts of every
-- organization without any access to the underlying tables.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA analytics;
COMMENT ON SCHEMA analytics IS 'hms_database: pseudonymized clinical facts for reporting';

CREATE TABLE analytics.patient_pseudonyms (
    patient_id  uuid        NOT NULL,
    pseudonym   uuid        NOT NULL DEFAULT gen_random_uuid(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_patient_pseudonyms PRIMARY KEY (patient_id),
    CONSTRAINT uq_patient_pseudonyms_pseudonym UNIQUE (pseudonym),
    CONSTRAINT fk_patient_pseudonyms_patient_id FOREIGN KEY (patient_id) REFERENCES patient.patients (id)
);
COMMENT ON TABLE analytics.patient_pseudonyms IS 'Random pseudonym per patient (re-identification key: owner only)';

CREATE TABLE analytics.encounter_pseudonyms (
    encounter_id  uuid        NOT NULL,
    pseudonym     uuid        NOT NULL DEFAULT gen_random_uuid(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_encounter_pseudonyms PRIMARY KEY (encounter_id),
    CONSTRAINT uq_encounter_pseudonyms_pseudonym UNIQUE (pseudonym),
    CONSTRAINT fk_encounter_pseudonyms_encounter_id FOREIGN KEY (encounter_id) REFERENCES clinical.encounters (id)
);
COMMENT ON TABLE analytics.encounter_pseudonyms IS 'Random pseudonym per encounter (re-identification key: owner only)';

CREATE FUNCTION analytics.assign_pseudonym() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_TABLE_NAME = 'patients' THEN
        INSERT INTO analytics.patient_pseudonyms (patient_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO analytics.encounter_pseudonyms (encounter_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END
$$;
COMMENT ON FUNCTION analytics.assign_pseudonym() IS 'Creates the analytics pseudonym of a new patient or encounter';
CREATE TRIGGER trg_patients_assign_pseudonym AFTER INSERT ON patient.patients
    FOR EACH ROW EXECUTE FUNCTION analytics.assign_pseudonym();
CREATE TRIGGER trg_encounters_assign_pseudonym AFTER INSERT ON clinical.encounters
    FOR EACH ROW EXECUTE FUNCTION analytics.assign_pseudonym();

CREATE VIEW analytics.encounter_facts AS
SELECT ep.pseudonym                                         AS encounter_key,
       pp.pseudonym                                         AS patient_key,
       e.organization_id,
       e.facility_id,
       e.class_code,
       e.status,
       e.type_system,
       e.type_code,
       (e.period_start AT TIME ZONE f.timezone)::date       AS start_date,
       round(extract(epoch FROM (e.period_end - e.period_start)) / 3600.0, 1) AS length_of_stay_hours,
       CASE WHEN p.birth_date IS NOT NULL AND e.period_start IS NOT NULL
            THEN date_part('year', age((e.period_start AT TIME ZONE f.timezone)::date, p.birth_date))::integer
       END                                                  AS age_years,
       p.administrative_gender,
       e.discharge_disposition_system,
       e.discharge_disposition_code
FROM clinical.encounters e
JOIN platform.facilities f ON f.id = e.facility_id
JOIN patient.patients p ON p.id = e.patient_id
JOIN analytics.encounter_pseudonyms ep ON ep.encounter_id = e.id
JOIN analytics.patient_pseudonyms pp ON pp.patient_id = e.patient_id
WHERE e.status <> 'entered-in-error';
COMMENT ON VIEW analytics.encounter_facts IS 'One row per encounter: pseudonymized keys, class, type, dates, age, gender';

CREATE VIEW analytics.diagnosis_facts AS
SELECT ep.pseudonym                                         AS encounter_key,
       pp.pseudonym                                         AS patient_key,
       e.organization_id,
       e.facility_id,
       d.use_system,
       d.use_code,
       d.rank,
       c.category,
       c.verification_status,
       c.code_system,
       c.code,
       (c.recorded_at AT TIME ZONE f.timezone)::date        AS recorded_date
FROM clinical.encounter_diagnoses d
JOIN clinical.conditions c ON c.id = d.condition_id
JOIN clinical.encounters e ON e.id = d.encounter_id
JOIN platform.facilities f ON f.id = e.facility_id
JOIN analytics.encounter_pseudonyms ep ON ep.encounter_id = e.id
JOIN analytics.patient_pseudonyms pp ON pp.patient_id = e.patient_id
WHERE d.active AND c.verification_status NOT IN ('entered-in-error', 'refuted') AND e.status <> 'entered-in-error';
COMMENT ON VIEW analytics.diagnosis_facts IS 'Coded encounter diagnoses (e.g. ICD-10) with role and rank; pseudonymized';

CREATE VIEW analytics.observation_facts AS
SELECT pp.pseudonym                                         AS patient_key,
       ep.pseudonym                                         AS encounter_key,
       o.organization_id,
       o.status,
       o.category_code,
       o.code_system,
       o.code,
       o.value_quantity,
       o.value_unit_code,
       o.value_code_system,
       o.value_code,
       o.interpretation_code,
       (o.effective_at AT TIME ZONE coalesce(f.timezone, 'UTC'))::date AS effective_date
FROM clinical.observations o
JOIN analytics.patient_pseudonyms pp ON pp.patient_id = o.patient_id
LEFT JOIN clinical.encounters e ON e.id = o.encounter_id
LEFT JOIN platform.facilities f ON f.id = e.facility_id
LEFT JOIN analytics.encounter_pseudonyms ep ON ep.encounter_id = o.encounter_id
WHERE o.status IN ('final', 'amended', 'corrected');
COMMENT ON VIEW analytics.observation_facts IS 'Final coded observations with numeric/coded values; pseudonymized, no free text';

GRANT USAGE ON SCHEMA analytics TO hms_report_read;
GRANT SELECT ON analytics.encounter_facts, analytics.diagnosis_facts, analytics.observation_facts TO hms_report_read;
