-- layer separation (migration 0021, ADR-ROOT-002): per-domain authority decides whether the legacy bridge or the
-- native layer may write a record; authority moves legacy -> cutover -> native; record origin; bridge issues; the
-- crosswalk and MRN identifiers. Synthetic data; rolled back.
-- Fixed ids: organizations ...0a (A, starts legacy), ...0b (B, no authority), ...0c (C, native); user ...c1 (A),
-- ...c3 (C); patients ...d1 (A, from the bridge), ...d3 (C).
BEGIN;

INSERT INTO platform.organizations (id, code, name) VALUES
    ('00000000-0000-7000-8000-00000000000a', 'TEST-ORG-A', 'Test Organization A'),
    ('00000000-0000-7000-8000-00000000000b', 'TEST-ORG-B', 'Test Organization B'),
    ('00000000-0000-7000-8000-00000000000c', 'TEST-ORG-C', 'Test Organization C');
INSERT INTO iam.users (id, organization_id, display_name) VALUES
    ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-00000000000a', 'Test Clerk A'),
    ('00000000-0000-7000-8000-0000000000c3', '00000000-0000-7000-8000-00000000000c', 'Test Clerk C');
SELECT pg_temp.set_authority('00000000-0000-7000-8000-00000000000a', 'legacy') AS hms_ignored,
       pg_temp.set_authority('00000000-0000-7000-8000-00000000000c', 'native') AS hms_ignored2 \gset

-- Transaction context as hms_services sets it: the native layer acts as a user, the bridge as service legacy-bridge.
CREATE FUNCTION pg_temp.native(p_org text, p_user text, p_reason text DEFAULT '') RETURNS void LANGUAGE sql AS $$
    SELECT set_config('hms.organization_id', p_org, true), set_config('hms.actor_user_id', p_user, true),
           set_config('hms.actor_service', '', true), set_config('hms.change_reason', p_reason, true);
$$;
CREATE FUNCTION pg_temp.bridge(p_org text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('hms.organization_id', p_org, true), set_config('hms.actor_user_id', '', true),
           set_config('hms.actor_service', 'legacy-bridge', true), set_config('hms.change_reason', '', true);
$$;
-- The cutover procedure (RUNBOOK): the owner changes the authority with a reason.
CREATE FUNCTION pg_temp.move(p_org text, p_domain text, p_authority text, p_reason text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('hms.organization_id', p_org, true), set_config('hms.actor_user_id', '', true),
           set_config('hms.actor_service', 'cutover-operator', true), set_config('hms.change_reason', p_reason, true);
    UPDATE integration.domain_authority SET authority = p_authority, decision_reference = 'TEST-CUTOVER-1'
    WHERE organization_id = p_org::uuid AND domain = p_domain;
$$;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    br  text := pg_temp.r('legacy_bridge');
    a   text := '00000000-0000-7000-8000-00000000000a';
    b   text := '00000000-0000-7000-8000-00000000000b';
    c   text := '00000000-0000-7000-8000-00000000000c';
    d1  text := '00000000-0000-7000-8000-0000000000d1';
    eff timestamptz;
BEGIN
    -- No authority assigned: nobody writes.
    PERFORM pg_temp.native(b, '');
    PERFORM set_config('hms.actor_service', 'test-native', true);
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'female')$q$, b),
                                 'HM001', 'native write without an authority is refused');
    PERFORM pg_temp.bridge(b);
    PERFORM pg_temp.expect_error(br, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'female')$q$, b),
                                 'HM001', 'bridge write without an authority is refused');

    -- Legacy authority: only the bridge writes, and only while declaring itself.
    PERFORM pg_temp.native(a, '00000000-0000-7000-8000-0000000000c1');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'female')$q$, a),
                                 'HM001', 'the native layer cannot write a legacy domain');
    PERFORM pg_temp.expect_error(br, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'female')$q$, a),
                                 '42501', 'the bridge must declare actor service legacy-bridge');
    PERFORM pg_temp.bridge(a);
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO patient.patients (organization_id, administrative_gender) VALUES (%L, 'female')$q$, a),
                                 '42501', 'the runtime cannot claim to be the legacy bridge');
    PERFORM pg_temp.exec_as(br, format($q$INSERT INTO patient.patients (id, organization_id, administrative_gender, birth_date)
                                         VALUES (%L, %L, 'female', DATE '1970-02-03')$q$, d1, a));
    PERFORM pg_temp.exec_as(br, format($q$INSERT INTO patient.names (organization_id, patient_id, text) VALUES (%L, %L, 'Test Legacy Patient')$q$, a, d1));
    PERFORM pg_temp.exec_as(br, format($q$INSERT INTO patient.identifiers (organization_id, patient_id, system_uri, value)
                                         VALUES (%L, %L, 'urn:hms:id:mrn', 'TEST001')$q$, a, d1));
    PERFORM pg_temp.ok((SELECT record_origin = 'legacy' FROM patient.patients WHERE id = d1::uuid)
                       AND (SELECT bool_and(record_origin = 'legacy') FROM patient.names WHERE patient_id = d1::uuid),
                       'bridge rows are stamped legacy');
    PERFORM pg_temp.ok((SELECT actor_service = 'legacy-bridge' AND actor_user_id IS NULL FROM patient.resource_versions
                        WHERE resource_type = 'Patient' AND resource_id = d1::uuid AND version = 1),
                       'history attributes bridge writes to legacy-bridge');
    PERFORM pg_temp.expect_error(br, format($q$INSERT INTO patient.identifiers (organization_id, patient_id, system_uri, value)
                                              VALUES (%L, %L, 'urn:hms:id:mrn', 'TEST001')$q$, a, d1), '23505', 'one patient per MRN');
    PERFORM pg_temp.expect_error(br, format($q$INSERT INTO patient.identifiers (organization_id, patient_id, system_uri, value)
                                              VALUES (%L, %L, 'urn:hms:id:mrn', 'TEST 001/x')$q$, a, d1), '23514', 'MRN format');
    PERFORM pg_temp.ok(pg_temp.exec_as(br, format($q$UPDATE patient.patients SET record_origin = 'legacy', birth_place = 'Semarang'
                                                    WHERE id = %L$q$, d1)) = 1, 'the bridge updates a legacy domain');
    PERFORM pg_temp.expect_error(br, format($q$UPDATE patient.patients SET record_origin = 'native' WHERE id = %L$q$, d1),
                                 'P0001', 'record origin never changes');
    -- Another domain of the same organization can already be native (gradual cutover).
    PERFORM pg_temp.ok((SELECT count(*) FROM integration.domain_authority WHERE organization_id = a::uuid AND authority = 'legacy') = 16,
                       'every domain of A starts legacy');

    -- Authority moves only legacy -> cutover -> native, with a reason; runtime and bridge cannot move it.
    PERFORM pg_temp.native(a, '00000000-0000-7000-8000-0000000000c1', 'try');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE integration.domain_authority SET authority = 'cutover' WHERE organization_id = %L$q$, a),
                                 '42501', 'the runtime cannot change authority');
    PERFORM pg_temp.expect_error(br, format($q$UPDATE integration.domain_authority SET authority = 'cutover' WHERE organization_id = %L$q$, a),
                                 '42501', 'the bridge cannot change authority');
    PERFORM pg_temp.expect_error(current_user::text, format($q$SELECT pg_temp.move(%L, 'patient', 'native', 'skip')$q$, a), '23514',
                                 'legacy cannot jump to native');
    PERFORM pg_temp.expect_error(current_user::text, format($q$SELECT pg_temp.move(%L, 'patient', 'cutover', '')$q$, a), 'P0001',
                                 'an authority change needs a reason');
    SELECT effective_at INTO eff FROM integration.domain_authority WHERE organization_id = a::uuid AND domain = 'patient';
    PERFORM pg_temp.move(a, 'patient', 'cutover', 'Final sync and reconciliation of registration');

    -- During cutover nobody writes the domain.
    PERFORM pg_temp.bridge(a);
    PERFORM pg_temp.expect_error(br, format($q$UPDATE patient.patients SET birth_place = 'Solo' WHERE id = %L$q$, d1),
                                 'HM001', 'the bridge cannot write during cutover');
    PERFORM pg_temp.native(a, '00000000-0000-7000-8000-0000000000c1');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE patient.patients SET birth_place = 'Solo' WHERE id = %L$q$, d1),
                                 'HM001', 'the native layer cannot write during cutover');

    PERFORM pg_temp.move(a, 'patient', 'native', 'Registration moves to HMS');
    PERFORM pg_temp.ok((SELECT authority = 'native' AND effective_at >= eff FROM integration.domain_authority
                        WHERE organization_id = a::uuid AND domain = 'patient'), 'authority moved with its effective time');
    PERFORM pg_temp.ok((SELECT count(*) FROM integration.resource_versions
                        WHERE resource_type = 'DomainAuthority' AND organization_id = a::uuid AND change_reason IS NOT NULL) >= 1,
                       'authority history keeps the reasons');
    PERFORM pg_temp.expect_error(current_user::text, format($q$SELECT pg_temp.move(%L, 'patient', 'legacy', 'back')$q$, a), '23514',
                                 'native is final');
    PERFORM pg_temp.expect_error(current_user::text, format($q$SELECT pg_temp.move(%L, 'patient', 'cutover', 'back')$q$, a), '23514',
                                 'native cannot return to cutover');

    -- After cutover the native layer owns the migrated history too; the bridge no longer writes it.
    PERFORM pg_temp.native(a, '00000000-0000-7000-8000-0000000000c1');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$UPDATE patient.patients SET birth_place = 'Solo' WHERE id = %L$q$, d1)) = 1,
                       'the native layer corrects a migrated record');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO patient.names (organization_id, patient_id, use, text) VALUES (%L, %L, 'usual', 'Test Usual')$q$, a, d1));
    PERFORM pg_temp.ok((SELECT record_origin FROM patient.patients WHERE id = d1::uuid) = 'legacy'
                       AND (SELECT record_origin FROM patient.names WHERE patient_id = d1::uuid AND use = 'usual') = 'native',
                       'origin tells migrated from native rows');
    PERFORM pg_temp.bridge(a);
    PERFORM pg_temp.expect_error(br, format($q$UPDATE patient.patients SET birth_place = 'Klaten' WHERE id = %L$q$, d1),
                                 'HM001', 'the bridge cannot write after cutover');
    PERFORM pg_temp.expect_error(br, format($q$INSERT INTO patient.names (organization_id, patient_id, text) VALUES (%L, %L, 'Late Name')$q$, a, d1),
                                 'HM001', 'the bridge cannot add to a native domain');
    -- Domains move independently: encounters of A are still the bridge's.
    PERFORM pg_temp.ok((SELECT authority FROM integration.domain_authority WHERE organization_id = a::uuid AND domain = 'encounter') = 'legacy',
                       'other domains keep their authority');

    -- A fully native organization.
    PERFORM pg_temp.native(c, '00000000-0000-7000-8000-0000000000c3');
    PERFORM pg_temp.exec_as(rt, format($q$INSERT INTO patient.patients (id, organization_id, administrative_gender)
                                         VALUES ('00000000-0000-7000-8000-0000000000d3', %L, 'male')$q$, c));
    PERFORM pg_temp.ok((SELECT record_origin FROM patient.patients WHERE id = '00000000-0000-7000-8000-0000000000d3') = 'native',
                       'native rows are stamped native');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, 'SELECT 1 FROM integration.domain_authority') = 16
                       AND pg_temp.exec_as(rt, format('SELECT 1 FROM integration.domain_authority WHERE organization_id <> %L', c)) = 0,
                       'authority rows are tenant-isolated');

    -- Bridge issues: keys and reason codes; one open issue per key, reason and field; stewards accept with a note.
    PERFORM pg_temp.bridge(a);
    PERFORM pg_temp.exec_as(br, format($q$INSERT INTO integration.bridge_issues (organization_id, source_system, source_entity, source_key,
        source_field, kind, reason_code, mapping_version) VALUES (%L, 'legacy-hms', 'pasien', 'TEST002', 'no_ktp', 'partial',
        'invalid_nik', 'legacy-hms.pasien/1')$q$, a));
    PERFORM pg_temp.expect_error(br, format($q$INSERT INTO integration.bridge_issues (organization_id, source_system, source_entity, source_key,
        source_field, kind, reason_code, mapping_version) VALUES (%L, 'legacy-hms', 'pasien', 'TEST002', 'no_ktp', 'partial',
        'invalid_nik', 'legacy-hms.pasien/1')$q$, a), '23505', 'one open issue per key, reason and field');
    PERFORM pg_temp.ok(pg_temp.exec_as(br, format($q$INSERT INTO integration.bridge_issues AS i (organization_id, source_system, source_entity,
        source_key, source_field, kind, reason_code, mapping_version) VALUES (%L, 'legacy-hms', 'pasien', 'TEST002', 'no_ktp', 'partial',
        'invalid_nik', 'legacy-hms.pasien/1')
        ON CONFLICT (organization_id, source_system, source_entity, source_key, reason_code, source_field) WHERE status = 'open'
        DO UPDATE SET last_seen_at = now(), seen_count = i.seen_count + 1$q$, a)) = 1, 'a repeated issue is counted');
    PERFORM pg_temp.expect_error(br, format($q$INSERT INTO integration.bridge_issues (organization_id, source_system, source_entity, source_key,
        kind, reason_code, mapping_version) VALUES (%L, 'legacy-hms', 'pasien', 'TEST003', 'rejected', 'Bad Code', 'legacy-hms.pasien/1')$q$, a),
                                 '23514', 'reason codes are codes, not messages');
    PERFORM pg_temp.native(a, '00000000-0000-7000-8000-0000000000c1');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO integration.bridge_issues (organization_id, source_system, source_entity, source_key,
        kind, reason_code, mapping_version) VALUES (%L, 'legacy-hms', 'pasien', 'TEST004', 'rejected', 'missing_name', 'legacy-hms.pasien/1')$q$, a),
                                 '42501', 'the native runtime does not raise bridge issues');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE integration.bridge_issues SET status = 'accepted', closed_at = now()
                                       WHERE source_key = 'TEST002'$q$, '23514', 'accepting needs a person and a note');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$UPDATE integration.bridge_issues SET status = 'accepted', closed_at = now(),
        closed_by_user_id = '00000000-0000-7000-8000-0000000000c1', close_note = 'Patient has no NIK; confirmed at registration desk'
        WHERE source_key = 'TEST002'$q$) = 1, 'a steward accepts an issue');
    PERFORM pg_temp.ok((SELECT seen_count FROM integration.bridge_issues WHERE source_key = 'TEST002') = 2, 'repeat count kept');
    PERFORM pg_temp.expect_error(br, $q$DELETE FROM integration.bridge_issues$q$, '42501', 'issues are not deleted');

    -- Crosswalk records the mapping version.
    PERFORM pg_temp.bridge(a);
    PERFORM pg_temp.exec_as(br, format($q$INSERT INTO integration.legacy_record_links (organization_id, source_system, source_entity, source_key,
        resource_type, resource_id, source_row_sha256, mapping_version) VALUES (%L, 'legacy-hms', 'pasien', 'TEST001', 'Patient', %L,
        sha256('row'::bytea), 'legacy-hms.pasien/1')$q$, a, d1));
    PERFORM pg_temp.expect_error(br, format($q$UPDATE integration.legacy_record_links SET mapping_version = 'pasien v2' WHERE source_key = 'TEST001'$q$),
                                 '23514', 'mapping version is name/number');
    -- Legacy keys repeat across organizations (each has its own legacy HMS): the active-link rule is per organization.
    PERFORM pg_temp.bridge(c);
    PERFORM pg_temp.ok(pg_temp.exec_as(br, format($q$INSERT INTO integration.legacy_record_links (organization_id, source_system,
        source_entity, source_key, resource_type, resource_id) VALUES (%L, 'legacy-hms', 'pasien', 'TEST001', 'Patient',
        '00000000-0000-7000-8000-0000000000d3')$q$, c)) = 1, 'the same legacy key links in another organization');
END
$$;

ROLLBACK;
