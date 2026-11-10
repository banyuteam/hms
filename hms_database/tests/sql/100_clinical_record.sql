-- clinical record (migrations 0011-0015, 0017): FHIR invariants, same-patient integrity, finalized-record rules,
-- entered-in-error, documents, attestations, signatures, provenance and imaging. Synthetic data; rolled back.
-- Fixed ids: organization ...0a, facility ...a1, user ...c1, practitioners ...f1 (user c1) / ...f2, patients ...d1/...d2.
BEGIN;

INSERT INTO platform.organizations (id, code, name) VALUES ('00000000-0000-7000-8000-00000000000a', 'TEST-ORG-A', 'Test Organization A');
INSERT INTO platform.facilities (id, organization_id, code, name, timezone) VALUES
    ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-00000000000a', 'A1', 'Facility A1', 'Asia/Jakarta');
INSERT INTO iam.users (id, organization_id, display_name) VALUES
    ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-00000000000a', 'dr. Test One');
SELECT set_config('hms.organization_id', '00000000-0000-7000-8000-00000000000a', true) AS hms_ignored,
       set_config('hms.actor_user_id', '00000000-0000-7000-8000-0000000000c1', true) AS hms_ignored2,
       set_config('hms.change_reason', '', true) AS hms_ignored3 \gset
SELECT pg_temp.set_authority('00000000-0000-7000-8000-00000000000a') AS hms_ignored \gset
INSERT INTO workforce.practitioners (id, organization_id, user_id, display_name) VALUES
    ('00000000-0000-7000-8000-0000000000f1', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000c1', 'dr. Test One'),
    ('00000000-0000-7000-8000-0000000000f2', '00000000-0000-7000-8000-00000000000a', NULL, 'dr. Test Two');
INSERT INTO patient.patients (id, organization_id, administrative_gender, birth_date) VALUES
    ('00000000-0000-7000-8000-0000000000d1', '00000000-0000-7000-8000-00000000000a', 'female', DATE '1990-05-01'),
    ('00000000-0000-7000-8000-0000000000d2', '00000000-0000-7000-8000-00000000000a', 'male', DATE '1985-01-01');
INSERT INTO knowledge.templates (id, template_id, version, name, rm_release, source_reference, artifact_sha256, status,
                                 approved_at, approved_by_user_id) VALUES
    ('00000000-0000-7000-8000-0000000000b1', 'hms.test.note', '1.0.0', 'Test note', '1.1.0', 'test', sha256('n'::bytea), 'active',
     now(), '00000000-0000-7000-8000-0000000000c1'),
    ('00000000-0000-7000-8000-0000000000b2', 'hms.test.draft', '1.0.0', 'Test draft', '1.1.0', 'test', sha256('d'::bytea), 'draft',
     NULL, NULL);

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    org text := '00000000-0000-7000-8000-00000000000a';
    fac text := '00000000-0000-7000-8000-0000000000a1';
    d1  text := '00000000-0000-7000-8000-0000000000d1';
    d2  text := '00000000-0000-7000-8000-0000000000d2';
BEGIN
    -- Encounters.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.encounters (organization_id, facility_id, patient_id, status, class_code,
        period_start) VALUES (%L, %L, %L, 'finished', 'AMB', now())$q$, org, fac, d1), '23514', 'finished encounter needs an end');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.encounters (organization_id, facility_id, patient_id, status, class_code)
        VALUES (%L, %L, %L, 'in-progress', 'OUTPATIENT')$q$, org, fac, d1), '23514', 'class is a v3 ActEncounterCode');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.encounters (id, organization_id, facility_id, patient_id, status, class_code,
        period_start) VALUES ('00000000-0000-7000-8000-000000000e01', %L, %L, %L, 'in-progress', 'AMB', now() - interval '1 hour'),
                             ('00000000-0000-7000-8000-000000000e02', %L, %L, %L, 'in-progress', 'AMB', now())$q$, org, fac, d1, org, fac, d2));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.encounters (organization_id, facility_id, patient_id, status, class_code,
        part_of_id) VALUES (%L, %L, %L, 'planned', 'AMB', '00000000-0000-7000-8000-000000000e02')$q$, org, fac, d1),
                                 '23503', 'part-of encounter must be the same patient''s');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.encounter_participants (organization_id, encounter_id, practitioner_id,
        type_system, type_code) VALUES (%L, '00000000-0000-7000-8000-000000000e01', '00000000-0000-7000-8000-0000000000f1',
        'http://terminology.hl7.org/CodeSystem/v3-ParticipationType', 'ATND')$q$, org));

    -- Conditions: FHIR invariants and same-patient encounter.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.conditions (organization_id, patient_id, clinical_status,
        verification_status, category, code_text, recorded_at) VALUES (%L, %L, 'active', 'entered-in-error', 'problem-list-item', 'x', now())$q$,
        org, d1), '23514', 'con-5: no clinical status when entered-in-error');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.conditions (organization_id, patient_id, clinical_status,
        verification_status, category, code_text, recorded_at, abatement_at) VALUES (%L, %L, 'active', 'confirmed', 'problem-list-item',
        'x', now(), now())$q$, org, d1), '23514', 'con-4: abatement only when inactive/resolved/remission');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.conditions (organization_id, patient_id, verification_status, category,
        code_text, recorded_at) VALUES (%L, %L, 'confirmed', 'problem-list-item', 'x', now())$q$, org, d1),
                                 '23514', 'con-3: problem-list item needs a clinical status');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.conditions (organization_id, patient_id, encounter_id, clinical_status,
        verification_status, category, code_system, code, recorded_at) VALUES (%L, %L, '00000000-0000-7000-8000-000000000e02', 'active',
        'confirmed', 'encounter-diagnosis', 'http://hl7.org/fhir/sid/icd-10', 'J06.9', now())$q$, org, d1),
                                 '23503', 'condition cannot point at another patient''s encounter');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.conditions (organization_id, patient_id, clinical_status,
        verification_status, category, code_system, code, recorded_at) VALUES (%L, %L, 'active', 'confirmed', 'problem-list-item',
        'urn:unregistered:system', 'X', now())$q$, org, d1), '23503', 'code system must be registered');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.conditions (id, organization_id, patient_id, encounter_id, clinical_status,
        verification_status, category, code_system, code, code_display, recorded_at, recorder_practitioner_id) VALUES
        ('00000000-0000-7000-8000-000000000c01', %L, %L, '00000000-0000-7000-8000-000000000e01', 'active', 'confirmed',
         'encounter-diagnosis', 'http://hl7.org/fhir/sid/icd-10', 'J06.9', 'Acute upper respiratory infection, unspecified', now(),
         '00000000-0000-7000-8000-0000000000f1'),
        ('00000000-0000-7000-8000-000000000c02', %L, %L, '00000000-0000-7000-8000-000000000e02', 'active', 'confirmed',
         'encounter-diagnosis', 'http://hl7.org/fhir/sid/icd-10', 'I10', NULL, now(), NULL)$q$, org, d1, org, d2));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.encounter_diagnoses (organization_id, encounter_id, patient_id,
        condition_id, use_system, use_code, rank) VALUES (%L, '00000000-0000-7000-8000-000000000e01', %L,
        '00000000-0000-7000-8000-000000000c02', 'http://terminology.hl7.org/CodeSystem/diagnosis-role', 'DD', 1)$q$, org, d1),
                                 '23503', 'encounter diagnosis cannot use another patient''s condition');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.encounter_diagnoses (organization_id, encounter_id, patient_id, condition_id,
        use_system, use_code, rank) VALUES (%L, '00000000-0000-7000-8000-000000000e01', %L, '00000000-0000-7000-8000-000000000c01',
        'http://terminology.hl7.org/CodeSystem/diagnosis-role', 'DD', 1)$q$, org, d1));

    -- Allergy invariants.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.allergy_intolerances (organization_id, patient_id, verification_status,
        code_text, recorded_at) VALUES (%L, %L, 'confirmed', 'Penicillin', now())$q$, org, d1), '23514', 'ait-1: clinical status required');

    -- Observations: one value, data-absent-reason rule, panel members of the same patient.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.observations (organization_id, patient_id, status, code_system, code,
        value_quantity, value_string) VALUES (%L, %L, 'final', 'http://loinc.org', '8867-4', 80, 'eighty')$q$, org, d1),
                                 '23514', 'one value[x] only');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.observations (organization_id, patient_id, status, code_system, code,
        value_quantity, data_absent_reason) VALUES (%L, %L, 'final', 'http://loinc.org', '8867-4', 80, 'unknown')$q$, org, d1),
                                 '23514', 'obs-6: no data-absent-reason with a value');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.observations (id, organization_id, patient_id, encounter_id, status,
        category_system, category_code, code_system, code, code_display, effective_at, issued_at, performer_practitioner_id) VALUES
        ('00000000-0000-7000-8000-000000000b01', %L, %L, '00000000-0000-7000-8000-000000000e01', 'final',
         'http://terminology.hl7.org/CodeSystem/observation-category', 'vital-signs', 'http://loinc.org', '85354-9',
         'Blood pressure panel', now(), now(), '00000000-0000-7000-8000-0000000000f1')$q$, org, d1));
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.observation_components (organization_id, observation_id, code_system, code,
        value_quantity, value_unit, value_unit_system, value_unit_code) VALUES
        (%L, '00000000-0000-7000-8000-000000000b01', 'http://loinc.org', '8480-6', 120, 'mmHg', 'http://unitsofmeasure.org', 'mm[Hg]'),
        (%L, '00000000-0000-7000-8000-000000000b01', 'http://loinc.org', '8462-4', 80, 'mmHg', 'http://unitsofmeasure.org', 'mm[Hg]')$q$,
        org, org));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.observations (organization_id, patient_id, parent_observation_id, status,
        code_system, code) VALUES (%L, %L, '00000000-0000-7000-8000-000000000b01', 'final', 'http://loinc.org', '8480-6')$q$, org, d2),
                                 '23503', 'panel member must be the same patient''s');

    -- Finalized result: correction in a later transaction needs a reason (also through a component), and the reason
    -- is kept. Tests share one transaction, so mark the result as written by an earlier one (triggers off).
    PERFORM set_config('session_replication_role', 'replica', true);
    UPDATE clinical.observations SET last_xact_id = '1'::xid8 WHERE id = '00000000-0000-7000-8000-000000000b01';
    UPDATE clinical.observation_components SET last_xact_id = '1'::xid8 WHERE observation_id = '00000000-0000-7000-8000-000000000b01';
    PERFORM set_config('session_replication_role', 'origin', true);
    PERFORM pg_temp.expect_error(rt, $q$UPDATE clinical.observations SET status = 'amended' WHERE id = '00000000-0000-7000-8000-000000000b01'$q$,
                                 'P0001', 'final observation changes only with a reason');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE clinical.observation_components SET value_quantity = 125 WHERE code = '8480-6'$q$,
                                 'P0001', 'component of a final observation changes only with a reason');
    PERFORM set_config('hms.change_reason', 'Transcription error corrected (test)', true);
    PERFORM pg_temp.exec_as(rt, $q$UPDATE clinical.observations SET status = 'amended' WHERE id = '00000000-0000-7000-8000-000000000b01'$q$);
    PERFORM pg_temp.ok((SELECT change_reason FROM clinical.resource_versions WHERE resource_id = '00000000-0000-7000-8000-000000000b01'
                           ORDER BY version DESC LIMIT 1) = 'Transcription error corrected (test)', 'correction reason is in the history');
    PERFORM pg_temp.exec_as(rt, $q$UPDATE clinical.observations SET status = 'entered-in-error' WHERE id = '00000000-0000-7000-8000-000000000b01'$q$);
    PERFORM pg_temp.expect_error(rt, $q$UPDATE clinical.observations SET status = 'final' WHERE id = '00000000-0000-7000-8000-000000000b01'$q$,
                                 'P0001', 'entered-in-error is terminal');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE clinical.observations SET patient_id = '00000000-0000-7000-8000-0000000000d2'
                                       WHERE id = '00000000-0000-7000-8000-000000000b01'$q$, 'P0001', 'patient of a record never changes');
    PERFORM set_config('hms.change_reason', '', true);
    PERFORM pg_temp.expect_error(rt, $q$DELETE FROM clinical.observations$q$, '42501', 'no deletes of clinical records');

    -- Medication: dispense must reference the same patient's request.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.medications (id, organization_id, code_system, code, code_display) VALUES
        ('00000000-0000-7000-8000-000000000a11', %L, 'http://sys-ids.kemkes.go.id/kfa', '93000000', 'Test product')$q$, org));
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.medication_requests (id, organization_id, patient_id, encounter_id, status,
        intent, medication_id, authored_at, requester_practitioner_id, dosage_text, dose_value, dose_unit, timing_frequency, timing_period,
        timing_period_unit) VALUES ('00000000-0000-7000-8000-000000000a12', %L, %L, '00000000-0000-7000-8000-000000000e01', 'active', 'order',
        '00000000-0000-7000-8000-000000000a11', now(), '00000000-0000-7000-8000-0000000000f1', '3 x 1 tablet sesudah makan', 1, 'tablet',
        3, 1, 'd')$q$, org, d1));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.medication_dispenses (organization_id, patient_id, status, medication_id,
        request_id) VALUES (%L, %L, 'preparation', '00000000-0000-7000-8000-000000000a11', '00000000-0000-7000-8000-000000000a12')$q$, org, d2),
                                 '23503', 'dispense cannot fill another patient''s prescription');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.medication_requests (organization_id, patient_id, status, intent,
        medication_id, authored_at, dosage_text, timing_period) VALUES (%L, %L, 'active', 'order', '00000000-0000-7000-8000-000000000a11',
        now(), 'x', 1)$q$, org, d1), '23514', 'timing period needs a unit');
END
$$;

-- Documents, attestations, signatures, provenance, imaging.
DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    org text := '00000000-0000-7000-8000-00000000000a';
    d1  text := '00000000-0000-7000-8000-0000000000d1';
    d2  text := '00000000-0000-7000-8000-0000000000d2';
BEGIN
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.compositions (organization_id, patient_id, status, type_system, type_code,
        title, document_date, content_format, content) VALUES (%L, %L, 'preliminary', 'http://loinc.org', '11506-3', 'x', now(),
        'openehr_flat_json', '{}')$q$, org, d1), '23514', 'structured content needs a template');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.compositions (organization_id, patient_id, status, type_system, type_code,
        title, document_date, template_id, content_format, content) VALUES (%L, %L, 'preliminary', 'http://loinc.org', '11506-3', 'x', now(),
        '00000000-0000-7000-8000-0000000000b2', 'openehr_flat_json', '{}')$q$, org, d1), '23514', 'template must be active');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.compositions (id, organization_id, patient_id, encounter_id, status, type_system,
        type_code, type_display, title, document_date, template_id, content_format, content) VALUES ('00000000-0000-7000-8000-000000000d01',
        %L, %L, '00000000-0000-7000-8000-000000000e01', 'preliminary', 'http://loinc.org', '11506-3', 'Progress note', 'CPPT', now(),
        '00000000-0000-7000-8000-0000000000b1', 'openehr_flat_json', '{"hms.test.note/subjective": "test"}')$q$, org, d1));
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.composition_sections (id, organization_id, composition_id, ordinal, title,
        narrative, narrative_status) VALUES ('00000000-0000-7000-8000-000000000d02', %L, '00000000-0000-7000-8000-000000000d01', 1,
        'Assessment', 'Test narrative', 'additional')$q$, org));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.composition_section_entries (organization_id, composition_id, section_id,
        resource_type, resource_id) VALUES (%L, '00000000-0000-7000-8000-000000000d01', '00000000-0000-7000-8000-000000000d02', 'Condition',
        '00000000-0000-7000-8000-000000000c02')$q$, org), '23503', 'document cannot reference another patient''s record');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$INSERT INTO clinical.composition_section_entries (organization_id, composition_id,
        section_id, resource_type, resource_id) VALUES (%L, '00000000-0000-7000-8000-000000000d01', '00000000-0000-7000-8000-000000000d02',
        'Condition', '00000000-0000-7000-8000-000000000c01')$q$, org)) = 1, 'document references the patient''s own condition');

    -- Attestation only of a final version; signature must be by the practitioner's own user and cover that version.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.composition_attestations (organization_id, composition_id,
        composition_version, mode, attester_practitioner_id, attested_at) VALUES (%L, '00000000-0000-7000-8000-000000000d01', 1, 'legal',
        '00000000-0000-7000-8000-0000000000f1', now())$q$, org), '23514', 'a preliminary version cannot be attested');
    PERFORM pg_temp.exec_as(rt, $q$UPDATE clinical.compositions SET status = 'final' WHERE id = '00000000-0000-7000-8000-000000000d01'$q$);
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.signatures (organization_id, patient_id, target_resource_type,
        target_resource_id, target_version, content_sha256, signer_practitioner_id, signer_user_id, signed_at, signature_format, provider,
        certificate_serial, certificate_issuer, certificate_sha256, signature_object_ref) VALUES (%L, %L, 'Composition',
        '00000000-0000-7000-8000-000000000d01', 1, sha256('c'::bytea), '00000000-0000-7000-8000-0000000000f2',
        '00000000-0000-7000-8000-0000000000c1', now(), 'pades', 'test-signer', '01', 'CN=Test CA', sha256('cert'::bytea), 'sig/test')$q$,
        org, d1), '23514', 'a user cannot sign as another practitioner');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.signatures (id, organization_id, patient_id, target_resource_type,
        target_resource_id, target_version, content_sha256, signer_practitioner_id, signer_user_id, signed_at, signature_format, provider,
        certificate_serial, certificate_issuer, certificate_sha256, signature_object_ref) VALUES ('00000000-0000-7000-8000-000000000d03',
        %L, %L, 'Composition', '00000000-0000-7000-8000-000000000d01', 1, sha256('c'::bytea), '00000000-0000-7000-8000-0000000000f1',
        '00000000-0000-7000-8000-0000000000c1', now(), 'pades', 'test-signer', '01', 'CN=Test CA', sha256('cert'::bytea), 'sig/test')$q$,
        org, d1));
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$INSERT INTO clinical.composition_attestations (organization_id, composition_id,
        composition_version, mode, attester_practitioner_id, attested_at, signature_id) VALUES (%L, '00000000-0000-7000-8000-000000000d01',
        1, 'legal', '00000000-0000-7000-8000-0000000000f1', now(), '00000000-0000-7000-8000-000000000d03')$q$, org)) = 1,
                          'final version attested with its signature');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE clinical.composition_attestations SET mode = 'personal'$q$, '42501', 'attestations are append-only');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE clinical.signatures SET content_sha256 = sha256('x'::bytea)$q$, '42501',
                                 'signed content hash cannot change');
    PERFORM set_config('session_replication_role', 'replica', true);  -- as if finalized by an earlier transaction
    UPDATE clinical.compositions SET last_xact_id = '1'::xid8 WHERE id = '00000000-0000-7000-8000-000000000d01';
    PERFORM set_config('session_replication_role', 'origin', true);
    PERFORM pg_temp.expect_error(rt, $q$UPDATE clinical.composition_sections SET narrative = 'changed'$q$, 'P0001',
                                 'a final document changes only with a reason');

    -- Provenance is append-only.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.provenances (id, organization_id, patient_id, target_resource_type,
        target_resource_id, target_version, activity_system, activity_code) VALUES ('00000000-0000-7000-8000-000000000d04', %L, %L,
        'Composition', '00000000-0000-7000-8000-000000000d01', 1, 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', 'CREATE')$q$, org, d1));
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO clinical.provenance_agents (organization_id, provenance_id, type_code, practitioner_id,
        user_id) VALUES (%L, '00000000-0000-7000-8000-000000000d04', 'author', '00000000-0000-7000-8000-0000000000f1',
        '00000000-0000-7000-8000-0000000000c1')$q$, org));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.provenance_entities (organization_id, provenance_id, role, resource_type,
        resource_id, external_reference) VALUES (%L, '00000000-0000-7000-8000-000000000d04', 'source', 'Observation',
        '00000000-0000-7000-8000-000000000b01', 'legacy-link:x')$q$, org), '23514', 'entity is a resource or an external reference, not both');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE clinical.provenances SET reason_text = 'x'$q$, '42501', 'provenance cannot be edited');

    -- Imaging: DICOM UID format; a report's study must be the same patient's.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO imaging.studies (organization_id, patient_id, study_instance_uid, status, pacs_system)
        VALUES (%L, %L, '1.2.03.4', 'available', 'pacs')$q$, org, d1), '23514', 'UID components have no leading zero');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO imaging.studies (id, organization_id, patient_id, study_instance_uid, status, modalities,
        pacs_system) VALUES ('00000000-0000-7000-8000-000000000f01', %L, %L, '1.2.826.0.1.3680043.2.1125.1', 'available', ARRAY['CR'],
        'pacs')$q$, org, d2));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO imaging.studies (organization_id, patient_id, study_instance_uid, status, modalities,
        pacs_system) VALUES (%L, %L, '1.2.3', 'available', ARRAY['cr'], 'pacs')$q$, org, d1), '23514', 'modality codes are upper case');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.diagnostic_reports (organization_id, patient_id, status, code_system, code,
        imaging_study_id) VALUES (%L, %L, 'preliminary', 'http://loinc.org', '18748-4', '00000000-0000-7000-8000-000000000f01')$q$, org, d1),
                                 '23503', 'radiology report cannot interpret another patient''s study');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO clinical.diagnostic_reports (organization_id, patient_id, status, code_system, code)
        VALUES (%L, %L, 'final', 'http://loinc.org', '18748-4')$q$, org, d1), '23514', 'a final report has an issued time');

    -- History of every clinical change carries the acting user.
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM clinical.resource_versions WHERE actor_user_id IS DISTINCT FROM
                                      '00000000-0000-7000-8000-0000000000c1'::uuid), 'all clinical history is attributed');
END
$$;

ROLLBACK;
