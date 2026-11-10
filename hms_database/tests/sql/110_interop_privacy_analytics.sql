-- interoperability state, read models, privacy records, audit anchoring and analytics (migrations 0016, 0018-0020).
-- Synthetic data; rolled back.
BEGIN;

INSERT INTO platform.organizations (id, code, name) VALUES ('00000000-0000-7000-8000-00000000000a', 'TEST-ORG-A', 'Test Organization A');
INSERT INTO platform.facilities (id, organization_id, code, name, timezone) VALUES
    ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-00000000000a', 'A1', 'Facility A1', 'Asia/Jakarta');
INSERT INTO iam.users (id, organization_id, display_name) VALUES
    ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-00000000000a', 'Test User');
SELECT set_config('hms.organization_id', '00000000-0000-7000-8000-00000000000a', true) AS hms_ignored,
       set_config('hms.actor_user_id', '00000000-0000-7000-8000-0000000000c1', true) AS hms_ignored2,
       set_config('hms.change_reason', '', true) AS hms_ignored3 \gset
SELECT pg_temp.set_authority('00000000-0000-7000-8000-00000000000a') AS hms_ignored \gset
INSERT INTO patient.patients (id, organization_id, administrative_gender, birth_date) VALUES
    ('00000000-0000-7000-8000-0000000000d1', '00000000-0000-7000-8000-00000000000a', 'female', DATE '1990-05-01');
INSERT INTO patient.names (organization_id, patient_id, text) VALUES
    ('00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000d1', 'Test Patient Name');
INSERT INTO clinical.encounters (id, organization_id, facility_id, patient_id, status, class_code, period_start, period_end) VALUES
    ('00000000-0000-7000-8000-000000000e01', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
     '00000000-0000-7000-8000-0000000000d1', 'finished', 'IMP', TIMESTAMPTZ '2026-11-01 01:00+00', TIMESTAMPTZ '2026-11-03 13:00+00');
INSERT INTO clinical.conditions (id, organization_id, patient_id, encounter_id, clinical_status, verification_status, category,
                                 code_system, code, recorded_at) VALUES
    ('00000000-0000-7000-8000-000000000c01', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000d1',
     '00000000-0000-7000-8000-000000000e01', 'active', 'confirmed', 'encounter-diagnosis', 'http://hl7.org/fhir/sid/icd-10', 'A09',
     TIMESTAMPTZ '2026-11-01 02:00+00');
INSERT INTO clinical.encounter_diagnoses (organization_id, encounter_id, patient_id, condition_id, use_system, use_code, rank) VALUES
    ('00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-000000000e01', '00000000-0000-7000-8000-0000000000d1',
     '00000000-0000-7000-8000-000000000c01', 'http://terminology.hl7.org/CodeSystem/diagnosis-role', 'DD', 1);
INSERT INTO privacy.processing_activities (code, name, purpose, legal_basis, data_categories, includes_specific_data, retention_rule,
                                           dpia_reference, owner) VALUES
    ('satusehat-reporting', 'SATUSEHAT reporting', 'Mandatory health data exchange', 'legal_obligation', ARRAY['health'], true,
     'Per Permenkes 24/2022', 'DPIA-TEST-1', 'Test DPO');

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    br  text := pg_temp.r('legacy_bridge');
    org text := '00000000-0000-7000-8000-00000000000a';
    d1  text := '00000000-0000-7000-8000-0000000000d1';
    sub uuid;
    h   record;
BEGIN
    -- Legacy crosswalk: written by the legacy bridge only (0021); one active link per legacy key and resource type;
    -- never deleted.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO integration.legacy_record_links (organization_id, source_system, source_entity,
        source_key, resource_type, resource_id) VALUES (%L, 'legacy-hms', 'pasien', 'TEST-RM-0009', 'Patient', %L)$q$, org, d1),
                                 '42501', 'the native runtime cannot write the crosswalk');
    PERFORM pg_temp.exec_as(br, format($q$INSERT INTO integration.legacy_record_links (id, organization_id, source_system, source_entity,
        source_key, resource_type, resource_id) VALUES ('00000000-0000-7000-8000-000000000101', %L, 'legacy-hms', 'pasien', 'TEST-RM-0001',
        'Patient', %L)$q$, org, d1));
    PERFORM pg_temp.expect_error(br, format($q$INSERT INTO integration.legacy_record_links (organization_id, source_system, source_entity,
        source_key, resource_type, resource_id) VALUES (%L, 'legacy-hms', 'pasien', 'TEST-RM-0001', 'Patient', %L)$q$, org, d1),
                                 '23505', 'one active link per legacy key');
    PERFORM pg_temp.expect_error(br, $q$UPDATE integration.legacy_record_links SET status = 'superseded'$q$, '23514',
                                 'superseding a link needs a reason');
    PERFORM pg_temp.expect_error(br, $q$DELETE FROM integration.legacy_record_links$q$, '42501', 'legacy links are not deleted');
    PERFORM pg_temp.expect_error(br, format($q$INSERT INTO integration.legacy_record_links (organization_id, source_system, source_entity,
        source_key, resource_type, resource_id) VALUES (%L, 'unknown-system', 'pasien', 'x', 'Patient', %L)$q$, org, d1),
                                 '23503', 'source system must be registered');

    -- SATUSEHAT ids and submissions.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO integration.external_resource_ids (organization_id, external_system, resource_type,
        resource_id, external_id) VALUES (%L, 'satusehat', 'Encounter', '00000000-0000-7000-8000-000000000e01', 'test-ss-encounter-1')$q$, org));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO integration.external_resource_ids (organization_id, external_system, resource_type,
        resource_id, external_id) VALUES (%L, 'satusehat', 'Encounter', '00000000-0000-7000-8000-000000000e01', 'test-ss-encounter-2')$q$, org),
                                 '23505', 'one active external id per record');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO integration.outbound_submissions (submission_id, organization_id, external_system,
        resource_type, resource_id, resource_version, operation, idempotency_key) VALUES ('00000000-0000-7000-8000-000000000102', %L,
        'satusehat', 'Encounter', '00000000-0000-7000-8000-000000000e01', 1, 'create', 'Encounter/e01/v1')$q$, org));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO integration.outbound_submissions (organization_id, external_system, resource_type,
        resource_id, resource_version, operation, idempotency_key) VALUES (%L, 'satusehat', 'Encounter',
        '00000000-0000-7000-8000-000000000e01', 1, 'create', 'Encounter/e01/v1')$q$, org), '23505', 'idempotency key is unique');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE integration.outbound_submissions SET status = 'accepted'$q$, '23514',
                                 'accepted submission records when');
    PERFORM pg_temp.exec_as(rt, $q$UPDATE integration.outbound_submissions SET status = 'accepted', accepted_at = now(),
                                   external_id = 'test-ss-encounter-1', last_http_status = 201$q$);

    -- Disclosure accounting is append-only; an active specific-data activity needs a DPIA reference.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO privacy.disclosures (organization_id, patient_id, processing_activity_code,
        recipient_kind, recipient_system, resource_type, resource_id, resource_version, disclosed_at, actor_service, submission_id)
        VALUES (%L, %L, 'satusehat-reporting', 'external_system', 'satusehat', 'Encounter', '00000000-0000-7000-8000-000000000e01', 1,
        now(), 'satusehat-sync', '00000000-0000-7000-8000-000000000102')$q$, org, d1));
    PERFORM pg_temp.expect_error(rt, $q$UPDATE privacy.disclosures SET de_identified = true$q$, '42501', 'disclosures cannot be edited');
    PERFORM pg_temp.expect_error(pg_temp.r('owner'), $q$INSERT INTO privacy.processing_activities (code, name, purpose, legal_basis,
        data_categories, includes_specific_data, retention_rule, owner) VALUES ('no-dpia', 'x', 'x', 'consent', ARRAY['health'], true, 'x', 'x')$q$,
                                 '23514', 'specific-data processing needs a DPIA reference');

    -- Data subject request lifecycle: decision needs reason; decided requests change only with a reason.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO privacy.data_subject_requests (id, organization_id, patient_id, request_type,
        requester_relationship, received_at, due_at) VALUES ('00000000-0000-7000-8000-000000000103', %L, %L, 'erasure', 'self', now(),
        now() + interval '3 days')$q$, org, d1));
    PERFORM pg_temp.expect_error(rt, $q$UPDATE privacy.data_subject_requests SET status = 'refused', decided_at = now()$q$, '23514',
                                 'refusal needs identity check and reason');
    PERFORM pg_temp.exec_as(rt, $q$UPDATE privacy.data_subject_requests SET status = 'refused', identity_verified_at = now(), decided_at = now(),
        decision_reason = 'Medical record within the 25-year retention period (Permenkes 24/2022 Pasal 39)'$q$);
    PERFORM pg_temp.expect_error(rt, $q$UPDATE privacy.data_subject_requests SET decision_reason = 'changed'$q$, 'P0001',
                                 'a decided request changes only with a reason');

    -- Read model: newer versions replace older ones; older or equal versions are ignored by the consumer's upsert.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO readmodel.clinical_timeline (resource_type, resource_id, resource_version,
        organization_id, patient_id, encounter_id, occurred_at, status, code_system, code, display) VALUES ('Condition',
        '00000000-0000-7000-8000-000000000c01', 2, %L, %L, '00000000-0000-7000-8000-000000000e01', now(), 'active',
        'http://hl7.org/fhir/sid/icd-10', 'A09', 'Diarrhoea')$q$, org, d1));
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$INSERT INTO readmodel.clinical_timeline AS t (resource_type, resource_id,
        resource_version, organization_id, patient_id, status) VALUES ('Condition', '00000000-0000-7000-8000-000000000c01', 1, %L, %L,
        'stale') ON CONFLICT (resource_type, resource_id) DO UPDATE SET resource_version = EXCLUDED.resource_version,
        status = EXCLUDED.status WHERE t.resource_version < EXCLUDED.resource_version$q$, org, d1)) = 0, 'stale event is ignored');

    -- Audit anchoring: the job anchors the real head only; the auditor verifies.
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO audit.audit_events (category, action, outcome, actor_type) VALUES
        ('system', 'test.anchor', 'success', 'system')$q$);
    SET LOCAL ROLE hms_audit_append;
    SELECT * INTO h FROM audit.chain_head();
    RESET ROLE;
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO audit.chain_anchors (anchored_seq, anchored_hash, target, external_reference)
        VALUES (%s, sha256('forged'::bytea), 'offsite_log', 'test')$q$, h.head_seq), '23514', 'anchor must match the chain');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO audit.chain_anchors (anchored_seq, anchored_hash, target, external_reference)
        VALUES (%s, %L::bytea, 'offsite_log', 'test-ref')$q$, h.head_seq, h.head_hash));
    PERFORM pg_temp.ok(pg_temp.exec_as(pg_temp.r('auditor'), 'SELECT * FROM audit.verify_anchors()') = 0, 'anchors match the chain');
    PERFORM pg_temp.expect_error(rt, 'SELECT * FROM audit.chain_anchors', '42501', 'runtime cannot read anchors');

    -- Analytics: pseudonyms are assigned automatically; reporting sees facts, age and codes, never identity.
    PERFORM pg_temp.ok((SELECT count(*) FROM analytics.patient_pseudonyms WHERE patient_id = d1::uuid) = 1, 'patient pseudonym assigned');
    PERFORM pg_temp.ok(pg_temp.exec_as(pg_temp.r('reporting'), $q$SELECT 1 FROM analytics.encounter_facts
        WHERE class_code = 'IMP' AND age_years = 36 AND length_of_stay_hours = 60.0 AND start_date = DATE '2026-11-01'$q$) = 1,
                          'encounter fact with local start date, age and length of stay');
    PERFORM pg_temp.ok(pg_temp.exec_as(pg_temp.r('reporting'), $q$SELECT 1 FROM analytics.diagnosis_facts
        WHERE code = 'A09' AND use_code = 'DD' AND rank = 1$q$) = 1, 'diagnosis fact');
    PERFORM pg_temp.ok((SELECT patient_key <> '00000000-0000-7000-8000-0000000000d1'::uuid FROM analytics.encounter_facts), 'key is a pseudonym');
    PERFORM pg_temp.expect_error(pg_temp.r('reporting'), 'SELECT * FROM patient.names', '42501', 'reporting cannot read names');
END
$$;

ROLLBACK;
