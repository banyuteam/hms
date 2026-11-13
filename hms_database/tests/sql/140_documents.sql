-- document attachments (migration 0023, ADR-SVC-013): subjects (patient, encounter by legacy visit number, staff),
-- category scope, immutable files, versioned attachments with terminal entered-in-error, tenant isolation, and who
-- may read or write. Synthetic data; rolled back.
-- Fixed ids: organizations ...0a (A), ...0b (B); facilities ...fa (A), ...fb (B); users ...c1 (A clerk),
-- ...c2 (B clerk), ...c4 (A staff member); patient ...d1 (A); files ...e1-...e9; attachments ...a1-...a9.
BEGIN;

INSERT INTO platform.organizations (id, code, name) VALUES
    ('00000000-0000-7000-8000-00000000000a', 'TEST-ORG-A', 'Test Organization A'),
    ('00000000-0000-7000-8000-00000000000b', 'TEST-ORG-B', 'Test Organization B');
INSERT INTO platform.facilities (id, organization_id, code, name, timezone) VALUES
    ('00000000-0000-7000-8000-0000000000fa', '00000000-0000-7000-8000-00000000000a', 'TEST-FAC-A', 'Test Facility A', 'Asia/Jakarta'),
    ('00000000-0000-7000-8000-0000000000fb', '00000000-0000-7000-8000-00000000000b', 'TEST-FAC-B', 'Test Facility B', 'Asia/Jakarta');
INSERT INTO iam.users (id, organization_id, display_name, status) VALUES
    ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-00000000000a', 'Test Clerk A', 'active'),
    ('00000000-0000-7000-8000-0000000000c2', '00000000-0000-7000-8000-00000000000b', 'Test Clerk B', 'active'),
    ('00000000-0000-7000-8000-0000000000c4', '00000000-0000-7000-8000-00000000000a', 'Test Nurse A', 'active');
SELECT pg_temp.set_authority('00000000-0000-7000-8000-00000000000a') AS hms_ignored \gset
SELECT set_config('hms.organization_id', '00000000-0000-7000-8000-00000000000a', true),
       set_config('hms.actor_user_id', '00000000-0000-7000-8000-0000000000c1', true),
       set_config('hms.actor_service', '', true) AS hms_ignored \gset
INSERT INTO patient.patients (id, organization_id, administrative_gender)
VALUES ('00000000-0000-7000-8000-0000000000d1', '00000000-0000-7000-8000-00000000000a', 'female');

CREATE FUNCTION pg_temp.ctx(p_org text, p_user text, p_reason text DEFAULT '') RETURNS void LANGUAGE sql AS $$
    SELECT set_config('hms.organization_id', p_org, true), set_config('hms.actor_user_id', p_user, true),
           set_config('hms.actor_service', '', true), set_config('hms.change_reason', p_reason, true);
$$;

-- INSERT of one stored file of organization A (facility A, uploaded by c1) with overridable columns.
CREATE FUNCTION pg_temp.file_sql(p_id text, p_media text DEFAULT 'application/pdf', p_pages text DEFAULT '3',
                                 p_key text DEFAULT NULL, p_org text DEFAULT '00000000-0000-7000-8000-00000000000a',
                                 p_fac text DEFAULT '00000000-0000-7000-8000-0000000000fa',
                                 p_user text DEFAULT '00000000-0000-7000-8000-0000000000c1') RETURNS text LANGUAGE sql AS $$
    SELECT format($q$INSERT INTO document.files (id, organization_id, facility_id, media_type, size_bytes, page_count,
                       sha256, storage_key, scan_engine, scanned_at, uploaded_by_user_id)
                     VALUES (%L, %L, %L, %L, 1024, %s, decode(repeat('ab', 32), 'hex'), %L, 'ClamAV 1.4.3/27800', now(), %L)$q$,
                  p_id, p_org, p_fac, p_media, p_pages, coalesce(p_key, 'documents/2026/11/' || p_id), p_user);
$$;

-- INSERT of one attachment of organization A by c1.
CREATE FUNCTION pg_temp.att_sql(p_id text, p_file text, p_kind text, p_patient text, p_visit text, p_staff text,
                                p_category text, p_org text DEFAULT '00000000-0000-7000-8000-00000000000a') RETURNS text
LANGUAGE sql AS $$
    SELECT format($q$INSERT INTO document.attachments (id, organization_id, facility_id, file_id, subject_kind, patient_id,
                       legacy_visit_number, staff_user_id, category_code, title, created_by_user_id)
                     VALUES (%L, %L, '00000000-0000-7000-8000-0000000000fa', %L, %L, %L, %L, %L, %L, 'Test document',
                             '00000000-0000-7000-8000-0000000000c1')$q$,
                  p_id, p_org, p_file, p_kind, p_patient, p_visit, p_staff, p_category);
$$;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    br  text := pg_temp.r('legacy_bridge');
    rp  text := pg_temp.r('reporting');
    ow  text := pg_temp.r('owner');
    a   text := '00000000-0000-7000-8000-00000000000a';
    b   text := '00000000-0000-7000-8000-00000000000b';
    c1  text := '00000000-0000-7000-8000-0000000000c1';
    c2  text := '00000000-0000-7000-8000-0000000000c2';
    c4  text := '00000000-0000-7000-8000-0000000000c4';
    d1  text := '00000000-0000-7000-8000-0000000000d1';
    e   text := '00000000-0000-7000-8000-0000000000e';
    t   text := '00000000-0000-7000-8000-0000000000a';
BEGIN
    PERFORM pg_temp.ctx(a, c1);

    -- The runtime stores a file and attaches it to each kind of subject.
    PERFORM pg_temp.exec_as(rt, pg_temp.file_sql(e || '1'));
    PERFORM pg_temp.exec_as(rt, pg_temp.att_sql(t || '1', e || '1', 'patient', d1, NULL, NULL, 'external-lab-result'));
    PERFORM pg_temp.exec_as(rt, pg_temp.file_sql(e || '2', 'image/jpeg', 'NULL'));
    PERFORM pg_temp.exec_as(rt, pg_temp.att_sql(t || '2', e || '2', 'encounter', d1, '2026/11/11/000123', NULL, 'referral-letter'));
    PERFORM pg_temp.exec_as(rt, pg_temp.file_sql(e || '3', 'image/png', 'NULL'));
    PERFORM pg_temp.exec_as(rt, pg_temp.att_sql(t || '3', e || '3', 'staff', NULL, NULL, c4, 'professional-license'));
    PERFORM pg_temp.ok((SELECT count(*) FROM document.attachments WHERE organization_id = a::uuid) = 3, 'three attachments stored');
    PERFORM pg_temp.ok((SELECT category_scope FROM document.attachments WHERE id = (t || '3')::uuid) = 'staff',
                       'a staff file has staff scope');
    PERFORM pg_temp.ok((SELECT count(*) FROM document.resource_versions
                        WHERE resource_type = 'DocumentReference' AND resource_id = (t || '1')::uuid
                          AND version = 1 AND actor_user_id = c1::uuid AND patient_id = d1::uuid) = 1,
                       'version 1 is in the history with actor and patient');

    -- Subject shape, category scope and file rules.
    PERFORM pg_temp.exec_as(rt, pg_temp.file_sql(e || '4'));
    PERFORM pg_temp.expect_error(rt, pg_temp.att_sql(t || '4', e || '4', 'patient', d1, '2026/11/11/000123', NULL, 'external-lab-result'),
                                 '23514', 'a patient file has no visit number');
    PERFORM pg_temp.expect_error(rt, pg_temp.att_sql(t || '4', e || '4', 'encounter', d1, NULL, NULL, 'external-lab-result'),
                                 '23514', 'an encounter file needs its visit number');
    PERFORM pg_temp.expect_error(rt, pg_temp.att_sql(t || '4', e || '4', 'staff', d1, NULL, c4, 'certificate'),
                                 '23514', 'a staff file has no patient');
    PERFORM pg_temp.expect_error(rt, pg_temp.att_sql(t || '4', e || '4', 'encounter', d1, '2026-11-11; DROP', NULL, 'referral-letter'),
                                 '23514', 'visit number format');
    PERFORM pg_temp.expect_error(rt, pg_temp.att_sql(t || '4', e || '4', 'patient', d1, NULL, NULL, 'certificate'),
                                 '23503', 'a staff category cannot describe a patient file');
    PERFORM pg_temp.expect_error(rt, pg_temp.att_sql(t || '4', e || '4', 'staff', NULL, NULL, c4, 'referral-letter'),
                                 '23503', 'a clinical category cannot describe a staff file');
    PERFORM pg_temp.expect_error(rt, pg_temp.att_sql(t || '4', e || '1', 'patient', d1, NULL, NULL, 'external-lab-result'),
                                 '23505', 'one attachment per file');
    PERFORM pg_temp.expect_error(rt, pg_temp.file_sql(e || '5', 'text/html', 'NULL'), '23514', 'only PDF, JPEG and PNG');
    PERFORM pg_temp.expect_error(rt, pg_temp.file_sql(e || '5', 'application/pdf', 'NULL'), '23514', 'a PDF has a page count');
    PERFORM pg_temp.expect_error(rt, pg_temp.file_sql(e || '5', 'image/png', '1'), '23514', 'an image has no page count');
    PERFORM pg_temp.expect_error(rt, pg_temp.file_sql(e || '5', p_key => '../../etc/passwd'), '23514', 'storage key format');
    PERFORM pg_temp.expect_error(rt, pg_temp.file_sql(e || '5', p_key => 'documents/2026/11/' || e || '1'),
                                 '23505', 'storage keys are unique');
    PERFORM pg_temp.expect_error(rt, pg_temp.file_sql(e || '5', p_fac => '00000000-0000-7000-8000-0000000000fb'),
                                 '23503', 'a file belongs to a facility of its organization');

    -- Files are immutable, attachments are never deleted, and the runtime changes only the status.
    PERFORM pg_temp.expect_error(rt, format('UPDATE document.files SET size_bytes = 2 WHERE id = %L', e || '1'),
                                 '42501', 'runtime cannot update a file');
    PERFORM pg_temp.expect_error(rt, format('DELETE FROM document.files WHERE id = %L', e || '1'),
                                 '42501', 'runtime cannot delete a file');
    PERFORM pg_temp.expect_error(ow, format('UPDATE document.files SET size_bytes = 2 WHERE id = %L', e || '1'),
                                 'P0001', 'even the owner cannot change a file');
    PERFORM pg_temp.expect_error(rt, format('DELETE FROM document.attachments WHERE id = %L', t || '1'),
                                 '42501', 'runtime cannot delete an attachment');
    PERFORM pg_temp.expect_error(ow, format('DELETE FROM document.attachments WHERE id = %L', t || '1'),
                                 'P0001', 'even the owner cannot delete an attachment');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE document.attachments SET title = 'Changed' WHERE id = %L$q$, t || '1'),
                                 '42501', 'runtime cannot change the title');

    -- Entered-in-error: needs the change reason and a status reason, then nothing changes any more.
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE document.attachments SET status = 'entered-in-error', status_reason = 'wrong patient' WHERE id = %L$q$, t || '1'),
                                 'P0001', 'entered-in-error needs hms.change_reason');
    PERFORM pg_temp.ctx(a, c1, 'wrong patient');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE document.attachments SET status = 'entered-in-error' WHERE id = %L$q$, t || '1'),
                                 '23514', 'entered-in-error needs a status reason');
    PERFORM pg_temp.exec_as(rt, format($q$UPDATE document.attachments SET status = 'entered-in-error', status_reason = 'wrong patient' WHERE id = %L$q$, t || '1'));
    -- One version per transaction (this test is one transaction): version 1's snapshot now holds the change.
    PERFORM pg_temp.ok((SELECT version FROM document.attachments WHERE id = (t || '1')::uuid) = 1, 'same transaction, same version');
    PERFORM pg_temp.ok((SELECT change_reason = 'wrong patient' AND snapshot->>'status' = 'entered-in-error'
                        FROM document.resource_versions
                        WHERE resource_type = 'DocumentReference' AND resource_id = (t || '1')::uuid AND version = 1),
                       'the status and the reason are in the history');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE document.attachments SET status = 'current', status_reason = NULL WHERE id = %L$q$, t || '1'),
                                 'P0001', 'entered-in-error is terminal');
    PERFORM pg_temp.ctx(a, c1);

    -- Tenant isolation.
    PERFORM pg_temp.ctx(b, c2);
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, 'SELECT 1 FROM document.attachments') = 0, 'another organization sees no attachments');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, 'SELECT 1 FROM document.files') = 0, 'another organization sees no files');
    PERFORM pg_temp.expect_error(rt, pg_temp.file_sql(e || '6'), '42501', 'cannot write a file of another organization');
    PERFORM pg_temp.exec_as(rt, pg_temp.file_sql(e || '7', p_org => b, p_fac => '00000000-0000-7000-8000-0000000000fb',
                                                 p_user => c2));
    PERFORM pg_temp.ctx(a, c1);
    PERFORM pg_temp.expect_error(rt, pg_temp.att_sql(t || '7', e || '7', 'patient', d1, NULL, NULL, 'external-lab-result'),
                                 '23503', 'an attachment cannot use a file of another organization');

    -- Who may access the schema at all.
    PERFORM pg_temp.expect_error(br, 'SELECT 1 FROM document.attachments', '42501', 'the legacy bridge has no access');
    PERFORM pg_temp.expect_error(rp, 'SELECT 1 FROM document.files', '42501', 'reporting has no access');
    PERFORM pg_temp.ok(NOT has_table_privilege(rt, 'document.resource_versions', 'INSERT'), 'runtime cannot write history');
    PERFORM pg_temp.ok(NOT has_table_privilege(rt, 'document.categories', 'INSERT'), 'runtime cannot add categories');
END
$$;

ROLLBACK;
