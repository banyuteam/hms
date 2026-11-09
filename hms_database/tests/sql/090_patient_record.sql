-- patient and workforce records (migrations 0006, 0009, 0010): actor attribution, tenant row-level security,
-- versioning and history, fixed columns, no deletes, identifier rules, links and consent. Synthetic data; rolled back.
-- Fixed ids: organizations ...0a/0b; users ...c1 (A, active), ...c2 (B, active), ...c3 (A, suspended);
-- patients ...d1, ...d2 (A), ...d9 (B).
BEGIN;

INSERT INTO platform.organizations (id, code, name) VALUES
    ('00000000-0000-7000-8000-00000000000a', 'TEST-ORG-A', 'Test Organization A'),
    ('00000000-0000-7000-8000-00000000000b', 'TEST-ORG-B', 'Test Organization B');
INSERT INTO iam.users (id, organization_id, display_name, status) VALUES
    ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-00000000000a', 'Test Clerk A', 'active'),
    ('00000000-0000-7000-8000-0000000000c2', '00000000-0000-7000-8000-00000000000b', 'Test Clerk B', 'active'),
    ('00000000-0000-7000-8000-0000000000c3', '00000000-0000-7000-8000-00000000000a', 'Test Suspended A', 'suspended');
INSERT INTO terminology.code_systems (uri, name, publisher, scope) VALUES ('urn:hms:test:religion', 'Test religion', 'Test', 'local');

-- Transaction context as hms_services sets it.
CREATE FUNCTION pg_temp.ctx(p_org text, p_user text, p_reason text DEFAULT '') RETURNS void LANGUAGE sql AS $$
    SELECT set_config('hms.organization_id', p_org, true), set_config('hms.actor_user_id', p_user, true),
           set_config('hms.actor_service', '', true), set_config('hms.change_reason', p_reason, true);
$$;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    a   text := '00000000-0000-7000-8000-00000000000a';
    b   text := '00000000-0000-7000-8000-00000000000b';
BEGIN
    -- Attribution: no actor, an inactive actor or an actor of another organization cannot write.
    PERFORM pg_temp.ctx(a, '');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'female')$q$, a),
                                 'P0001', 'write without actor is refused');
    PERFORM pg_temp.ctx(a, '00000000-0000-7000-8000-0000000000c3');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'female')$q$, a),
                                 'P0001', 'suspended user cannot write');
    PERFORM pg_temp.ctx(a, '00000000-0000-7000-8000-0000000000c2');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'female')$q$, a),
                                 'P0001', 'user of another organization cannot write');
    PERFORM set_config('hms.actor_service', 'legacy-import', true);
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'female')$q$, a),
                                 'P0001', 'user and service actor together are ambiguous');

    -- Tenant isolation: a row of another organization cannot be written.
    PERFORM pg_temp.ctx(a, '00000000-0000-7000-8000-0000000000c1');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'male')$q$, b),
                                 '42501', 'insert into another tenant is refused by row-level security');

    -- Registration in one transaction: patient, name, identifiers, address, contact.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO patient.patients (id, organization_id, administrative_gender, birth_date,
        religion_system, religion_code) VALUES ('00000000-0000-7000-8000-0000000000d1', %L, 'female', DATE '1990-05-01',
        'urn:hms:test:religion', '1')$q$, a));
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO patient.names (organization_id, patient_id, text, given)
        VALUES (%L, '00000000-0000-7000-8000-0000000000d1', 'Siti Aminah', ARRAY['Siti', 'Aminah'])$q$, a));
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO patient.identifiers (organization_id, patient_id, system_uri, value)
        VALUES (%L, '00000000-0000-7000-8000-0000000000d1', 'https://fhir.kemkes.go.id/id/nik', '3374010101900001')$q$, a));
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO patient.addresses (organization_id, patient_id, line, province_code, city_code,
        district_code, village_code, rt, rw) VALUES (%L, '00000000-0000-7000-8000-0000000000d1', 'Jl. Contoh 1', '33', '3374',
        '337401', '3374011001', '001', '002')$q$, a));
    PERFORM pg_temp.ok((SELECT version FROM patient.patients WHERE id = '00000000-0000-7000-8000-0000000000d1') = 1,
                          'registration in one transaction is version 1');
    PERFORM pg_temp.ok((SELECT count(*) FROM patient.resource_versions
                           WHERE patient_id = '00000000-0000-7000-8000-0000000000d1'
                             AND actor_user_id = '00000000-0000-7000-8000-0000000000c1') = 4,
                          'every created part is in the history with its actor');
END
$$;

-- Tests run in one rolled-back transaction. To simulate a later transaction, mark the patient as last changed by
-- another transaction id (triggers off for this one fixture statement).
SET LOCAL session_replication_role = replica;
UPDATE patient.patients SET last_xact_id = '1'::xid8 WHERE id = '00000000-0000-7000-8000-0000000000d1';
UPDATE patient.names SET last_xact_id = '1'::xid8 WHERE patient_id = '00000000-0000-7000-8000-0000000000d1';
UPDATE patient.identifiers SET last_xact_id = '1'::xid8 WHERE patient_id = '00000000-0000-7000-8000-0000000000d1';
SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    a   text := '00000000-0000-7000-8000-00000000000a';
    b   text := '00000000-0000-7000-8000-00000000000b';
    d1  text := '00000000-0000-7000-8000-0000000000d1';
BEGIN
    PERFORM pg_temp.ctx(a, '00000000-0000-7000-8000-0000000000c1');

    -- A change in a later transaction is a new version of the patient, recorded once even when several parts change.
    PERFORM pg_temp.exec_as(rt, format($q$UPDATE patient.names SET active = false WHERE patient_id = %L$q$, d1));
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO patient.names (organization_id, patient_id, text) VALUES (%L, %L, 'Siti Aminah Putri')$q$, a, d1));
    PERFORM pg_temp.ok((SELECT version FROM patient.patients WHERE id = d1::uuid) = 2, 'a later change makes version 2');
    PERFORM pg_temp.ok((SELECT count(*) FROM patient.resource_versions WHERE resource_type = 'Patient' AND resource_id = d1::uuid) = 2,
                          'patient history has both versions');
    PERFORM pg_temp.ok((SELECT snapshot->>'text' FROM patient.resource_versions
                           WHERE resource_type = 'Patient.name' AND patient_id = d1::uuid AND version = 2) = 'Siti Aminah',
                          'the corrected name is kept in history, not overwritten');

    -- Fixed columns and no deletes.
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE patient.identifiers SET value = '3374010101900002' WHERE patient_id = %L$q$, d1),
                                 'P0001', 'identifier value cannot be edited (deactivate and add)');
    PERFORM pg_temp.exec_as(rt, format($q$UPDATE patient.identifiers SET unique_value = false WHERE patient_id = %L$q$, d1));
    PERFORM pg_temp.ok((SELECT bool_and(unique_value) FROM patient.identifiers WHERE patient_id = d1::uuid),
                          'uniqueness cannot be switched off by an update');
    PERFORM pg_temp.expect_error(rt, format($q$DELETE FROM patient.patients WHERE id = %L$q$, d1), '42501', 'runtime cannot delete patients');
    PERFORM pg_temp.expect_error(rt, format($q$DELETE FROM patient.resource_versions WHERE patient_id = %L$q$, d1), '42501',
                                 'runtime cannot delete history');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE patient.resource_versions SET change_reason = 'x' WHERE patient_id = %L$q$, d1), '42501',
                                 'runtime cannot edit history');

    -- Identifier rules.
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO patient.patients (id, organization_id, administrative_gender)
        VALUES ('00000000-0000-7000-8000-0000000000d2', %L, 'male')$q$, a));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.identifiers (organization_id, patient_id, system_uri, value)
        VALUES (%L, '00000000-0000-7000-8000-0000000000d2', 'https://fhir.kemkes.go.id/id/nik', '3374010101900001')$q$, a),
                                 '23505', 'one NIK identifies one active patient');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.identifiers (organization_id, patient_id, system_uri, value)
        VALUES (%L, '00000000-0000-7000-8000-0000000000d2', 'https://fhir.kemkes.go.id/id/nik', '12345')$q$, a),
                                 '23514', 'NIK must be 16 digits');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.identifiers (organization_id, patient_id, system_uri, value)
        VALUES (%L, '00000000-0000-7000-8000-0000000000d2', 'https://fhir.kemkes.go.id/id/nik', '9999999999999999')$q$, a),
                                 '23514', 'NIK placeholder 9999999999999999 is not stored');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$INSERT INTO patient.identifiers (organization_id, patient_id, system_uri, value)
        VALUES (%L, %L, 'https://fhir.kemkes.go.id/id/nik-ibu', '3374010101900001'),
               (%L, '00000000-0000-7000-8000-0000000000d2', 'https://fhir.kemkes.go.id/id/nik-ibu', '3374010101900001')$q$, a, d1, a)) = 2,
                          'siblings may share the mother''s NIK');

    -- Composite keys: parts and links stay inside one organization.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.names (organization_id, patient_id, text) VALUES (%L, %L, 'x')$q$, b, d1),
                                 '42501', 'part with another tenant is refused');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.links (organization_id, patient_id, other_patient_id, link_type)
        VALUES (%L, %L, %L, 'replaced-by')$q$, a, d1, d1), '23514', 'a patient cannot link to itself');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$INSERT INTO patient.links (organization_id, patient_id, other_patient_id, link_type)
        VALUES (%L, '00000000-0000-7000-8000-0000000000d2', %L, 'replaced-by')$q$, a, d1)) = 1, 'duplicate linked replaced-by survivor');

    -- Consent: grantor rule; changing an active consent needs a reason.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.consents (organization_id, patient_id, status, scope, category_system,
        category_code, decided_at, grantor_kind, provision) VALUES (%L, %L, 'active', 'treatment',
        'http://terminology.hl7.org/CodeSystem/consentcategorycodes', 'test', now(), 'related_person', 'permit')$q$, a, d1),
                                 '23514', 'consent by a related person names the contact');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO patient.consents (id, organization_id, patient_id, status, scope, category_system,
        category_code, decided_at, grantor_kind, provision) VALUES ('00000000-0000-7000-8000-0000000000e1', %L, %L, 'active', 'treatment',
        'http://terminology.hl7.org/CodeSystem/consentcategorycodes', 'test', now(), 'patient', 'permit')$q$, a, d1));
END
$$;

SET LOCAL session_replication_role = replica;
UPDATE patient.consents SET last_xact_id = '1'::xid8 WHERE id = '00000000-0000-7000-8000-0000000000e1';
SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    a   text := '00000000-0000-7000-8000-00000000000a';
    b   text := '00000000-0000-7000-8000-00000000000b';
BEGIN
    PERFORM pg_temp.ctx(a, '00000000-0000-7000-8000-0000000000c1');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE patient.consents SET status = 'inactive' WHERE id = '00000000-0000-7000-8000-0000000000e1'$q$,
                                 'P0001', 'withdrawing an active consent needs a reason');
    PERFORM pg_temp.ctx(a, '00000000-0000-7000-8000-0000000000c1', 'Patient withdrew consent (test)');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$UPDATE patient.consents SET status = 'inactive' WHERE id = '00000000-0000-7000-8000-0000000000e1'$q$) = 1,
                          'withdrawal with a reason');
    PERFORM pg_temp.ok((SELECT change_reason FROM patient.resource_versions WHERE resource_id = '00000000-0000-7000-8000-0000000000e1'
                           AND version = 2) = 'Patient withdrew consent (test)', 'the reason is in the history');

    -- After a logical restore transaction ids repeat: a row stamped with this transaction's id but an earlier time is
    -- from another transaction, so a change makes a new version instead of overwriting that version's history.
    PERFORM set_config('session_replication_role', 'replica', true);
    UPDATE patient.patients SET last_xact_id = pg_current_xact_id(), updated_at = now() - interval '1 day'
    WHERE id = '00000000-0000-7000-8000-0000000000d2';
    PERFORM set_config('session_replication_role', 'origin', true);
    PERFORM pg_temp.exec_as(rt, $q$UPDATE patient.patients SET birth_date = DATE '1980-01-01' WHERE id = '00000000-0000-7000-8000-0000000000d2'$q$);
    PERFORM pg_temp.ok((SELECT version FROM patient.patients WHERE id = '00000000-0000-7000-8000-0000000000d2') = 2,
                          'a repeated transaction id from a restore does not merge versions');

    -- Another tenant sees nothing of tenant A; no tenant sees nothing at all.
    PERFORM pg_temp.ctx(b, '00000000-0000-7000-8000-0000000000c2');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, 'SELECT 1 FROM patient.patients') = 0, 'tenant B sees no patients of A');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, 'SELECT 1 FROM patient.resource_versions') = 0, 'tenant B sees no history of A');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$UPDATE patient.patients SET active = false$q$) = 0, 'tenant B cannot update A''s rows');
    PERFORM set_config('hms.organization_id', '', true);
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, 'SELECT 1 FROM patient.identifiers') = 0, 'without tenant context nothing is visible');
    PERFORM pg_temp.ctx(a, '00000000-0000-7000-8000-0000000000c1');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, 'SELECT 1 FROM patient.patients') = 2, 'tenant A sees its patients');

    -- Even the owner cannot delete records or history.
    BEGIN
        DELETE FROM patient.names WHERE patient_id = '00000000-0000-7000-8000-0000000000d1';
        RAISE EXCEPTION 'FAIL: owner deleted a patient name';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    END;
    BEGIN
        DELETE FROM patient.resource_versions;
        RAISE EXCEPTION 'FAIL: owner deleted history';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    END;

    -- Workforce: the linked sign-in identity and a role's licence must belong to the same practitioner/organization.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO workforce.practitioners (organization_id, user_id, display_name)
        VALUES (%L, '00000000-0000-7000-8000-0000000000c2', 'x')$q$, a), '23503', 'practitioner cannot link a user of another organization');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO workforce.practitioners (id, organization_id, user_id, display_name) VALUES
        ('00000000-0000-7000-8000-0000000000f1', %L, '00000000-0000-7000-8000-0000000000c1', 'dr. Test'),
        ('00000000-0000-7000-8000-0000000000f2', %L, NULL, 'dr. Other')$q$, a, a));
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO workforce.practitioner_identifiers (id, organization_id, practitioner_id, system_uri, value)
        VALUES ('00000000-0000-7000-8000-0000000000f3', %L, '00000000-0000-7000-8000-0000000000f2', 'https://fhir.kemkes.go.id/id/nik',
                '3374010101800001')$q$, a));
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO workforce.practitioner_identifiers (organization_id, practitioner_id, system_uri, value)
        VALUES (%L, '00000000-0000-7000-8000-0000000000f1', 'https://fhir.kemkes.go.id/id/nik-ibu', '3374010101800001')$q$, a),
                                 '23514', 'NIK ibu does not apply to practitioners');
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO platform.facilities (id, organization_id, code, name, timezone) VALUES
        ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-00000000000a', 'A1', 'Facility A1', 'Asia/Jakarta')$q$);
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO workforce.practitioner_roles (organization_id, practitioner_id, facility_id,
        role_system, role_code, licence_identifier_id, period_start) VALUES (%L, '00000000-0000-7000-8000-0000000000f1',
        '00000000-0000-7000-8000-0000000000a1', 'http://terminology.hl7.org/CodeSystem/v3-RoleCode', 'TEST',
        '00000000-0000-7000-8000-0000000000f3', DATE '2026-01-01')$q$, a), '23503', 'a role cannot cite another practitioner''s licence');
END
$$;

ROLLBACK;
