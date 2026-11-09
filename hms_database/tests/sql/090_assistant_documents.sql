-- assistant.documents, document_readings, document_reading_files and document_usage_monthly (migration 0007,
-- ADR-SVC-009). Synthetic data; rolled back. Fixed ids: organization ...0a, facility ...a1, users ...c1 and ...c2.
BEGIN;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    rp  text := pg_temp.r('reporting');
    au  text := pg_temp.r('auditor');
    ins text := $s$INSERT INTO assistant.documents (id, organization_id, facility_id, user_id, visit_number,
                   uploaded_media_type, stored_media_type, size_bytes, page_count, sha256, storage_key, scan_engine,
                   expires_at) VALUES $s$;
BEGIN
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO platform.organizations (id, code, name) VALUES
            ('00000000-0000-7000-8000-00000000000a', 'TEST-ORG-A', 'Test Organization A')
    $q$);
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO platform.facilities (id, organization_id, code, name, timezone) VALUES
            ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-00000000000a', 'A1', 'Facility A1', 'Asia/Jakarta')
    $q$);
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO iam.users (id, organization_id, display_name) VALUES
            ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-00000000000a', 'Test User One')
    $q$);

    -- A Word file stored as its PDF conversion, and a photo stored as an image.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, ins || $q$
        ('00000000-0000-7000-8000-0000000000d1', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
         '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf', 52000, 3,
         sha256('synthetic-1'), '2026/11/0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a91', 'ClamAV test', now() + interval '7 days'),
        ('00000000-0000-7000-8000-0000000000d2', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
         '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123', 'image/jpeg', 'image/jpeg', 800000, NULL,
         sha256('synthetic-2'), '2026/11/0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a92', 'ClamAV test', now() + interval '7 days')
    $q$) = 2, 'runtime stores document metadata');

    PERFORM pg_temp.expect_error(rt, ins || $q$(uuidv7(), '00000000-0000-7000-8000-00000000000a',
        '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 100, NULL, sha256('x'),
        '2026/11/0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a93', 'ClamAV test', now() + interval '7 days')$q$,
        '23514', 'Office files are stored only as their PDF conversion');
    PERFORM pg_temp.expect_error(rt, ins || $q$(uuidv7(), '00000000-0000-7000-8000-00000000000a',
        '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123',
        'application/x-msdownload', 'application/pdf', 100, 1, sha256('x'),
        '2026/11/0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a93', 'ClamAV test', now() + interval '7 days')$q$,
        '23514', 'only the approved upload types');
    PERFORM pg_temp.expect_error(rt, ins || $q$(uuidv7(), '00000000-0000-7000-8000-00000000000a',
        '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123',
        'application/pdf', 'application/pdf', 10485761, 1, sha256('x'),
        '2026/11/0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a93', 'ClamAV test', now() + interval '7 days')$q$,
        '23514', 'a file is at most 10 MiB');
    PERFORM pg_temp.expect_error(rt, ins || $q$(uuidv7(), '00000000-0000-7000-8000-00000000000a',
        '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123',
        'application/pdf', 'application/pdf', 100, 51, sha256('x'),
        '2026/11/0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a93', 'ClamAV test', now() + interval '7 days')$q$,
        '23514', 'a PDF has at most 50 pages');
    PERFORM pg_temp.expect_error(rt, ins || $q$(uuidv7(), '00000000-0000-7000-8000-00000000000a',
        '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123',
        'image/png', 'image/png', 100, NULL, sha256('x'), '../../etc/passwd', 'ClamAV test', now() + interval '7 days')$q$,
        '23514', 'storage keys are generated paths, never a user-supplied name');
    PERFORM pg_temp.expect_error(rt, ins || $q$(uuidv7(), '00000000-0000-7000-8000-00000000000a',
        '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123',
        'image/png', 'image/png', 100, NULL, sha256('x'), '2026/11/0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a92',
        'ClamAV test', now() + interval '7 days')$q$,
        '23505', 'one document per storage key');
    PERFORM pg_temp.expect_error(rt, ins || $q$(uuidv7(), '00000000-0000-7000-8000-00000000000a',
        '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123',
        'image/png', 'image/png', 100, NULL, sha256('x'), '2026/11/0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a94',
        'ClamAV test', now() + interval '31 days')$q$,
        '23514', 'a file is kept at most 30 days');
    PERFORM pg_temp.expect_error(rt, ins || $q$(uuidv7(), '00000000-0000-7000-8000-00000000000a',
        '00000000-0000-7000-8000-0000000000a1', uuidv7(), '2026/10/26/000123', 'image/png', 'image/png', 100, NULL,
        sha256('x'), '2026/11/0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a95', 'ClamAV test', now() + interval '7 days')$q$,
        '23503', 'the uploader is a user of the organization');
    PERFORM pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'assistant' AND table_name IN ('documents', 'document_readings')
          AND column_name ~ '(name|question|answer|content|text)'),
        'no file name, question, answer or content column');

    -- Purge marks the file deleted once; nothing else changes.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        UPDATE assistant.documents SET purged_at = now() WHERE id = '00000000-0000-7000-8000-0000000000d2'
    $q$) = 1, 'a purged file is marked');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.documents SET purged_at = now()
                                       WHERE id = '00000000-0000-7000-8000-0000000000d2'$q$,
                                 'P0001', 'a purged document stays purged');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.documents SET purged_at = NULL
                                       WHERE id = '00000000-0000-7000-8000-0000000000d1'$q$,
                                 'P0001', 'purging is the only change');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.documents SET visit_number = '1'$q$, '42501',
                                 'document metadata is immutable');

    -- Readings: provenance when the model was reached; outcomes decided by hms-services need none.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.document_readings (id, request_id, organization_id, facility_id, user_id, visit_number, status,
                                                 model, bridge_version, input_tokens, output_tokens, duration_ms) VALUES
            ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000f1',
             '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
             '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123', 'answered', 'claude-opus-5-5', '0.1.0',
             12000, 800, 9000),
            ('00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-0000000000f2',
             '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
             '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123', 'unavailable', NULL, NULL, 0, 0, 5)
    $q$) = 2, 'runtime records readings');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.document_reading_files (reading_id, document_id) VALUES
            ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000d1'),
            ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000d2')
    $q$) = 2, 'a reading lists its documents');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.document_readings (request_id, organization_id, facility_id,
                                         user_id, visit_number, status)
                                       VALUES (uuidv7(), '00000000-0000-7000-8000-00000000000a',
                                               '00000000-0000-7000-8000-0000000000a1',
                                               '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123', 'answered')$q$,
                                 '23514', 'an answered reading names the model and the bridge');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.document_readings (request_id, organization_id, facility_id,
                                         user_id, visit_number, status)
                                       VALUES (uuidv7(), '00000000-0000-7000-8000-00000000000a',
                                               '00000000-0000-7000-8000-0000000000a1',
                                               '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123', 'maybe')$q$,
                                 '23514', 'only known outcomes');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.document_readings (request_id, organization_id, facility_id,
                                         user_id, visit_number, status)
                                       VALUES ('00000000-0000-7000-8000-0000000000f1', '00000000-0000-7000-8000-00000000000a',
                                               '00000000-0000-7000-8000-0000000000a1',
                                               '00000000-0000-7000-8000-0000000000c1', '2026/10/26/000123', 'failed')$q$,
                                 '23505', 'one reading per bridge request id');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.document_readings SET status = 'declined'$q$, '42501',
                                 'readings are not editable');

    -- Retention: document metadata goes after its readings.
    PERFORM pg_temp.expect_error(rt, $q$DELETE FROM assistant.documents WHERE id = '00000000-0000-7000-8000-0000000000d1'$q$,
                                 '23503', 'a document used by a reading is kept until the reading expires');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        DELETE FROM assistant.document_readings WHERE id = '00000000-0000-7000-8000-0000000000e1'
    $q$) = 1, 'an expired reading is purged with its links');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        DELETE FROM assistant.documents WHERE id = '00000000-0000-7000-8000-0000000000d1'
    $q$) = 1, 'then its document metadata');

    -- Reporting: monthly usage without user ids; no access to the rows.
    PERFORM pg_temp.ok((SELECT readings = 1 AND input_tokens = 0
                        FROM assistant.document_usage_monthly WHERE status = 'unavailable'),
                       'usage view counts readings and tokens');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_schema = 'assistant' AND table_name = 'document_usage_monthly'
                                     AND column_name IN ('user_id', 'visit_number', 'request_id')),
                       'usage view has no user, visit or request ids');
    PERFORM pg_temp.ok(pg_temp.exec_as(rp, 'SELECT * FROM assistant.document_usage_monthly') >= 1,
                       'reporting reads the usage view');
    PERFORM pg_temp.expect_error(rp, 'SELECT * FROM assistant.documents', '42501', 'reporting cannot read documents');
    PERFORM pg_temp.expect_error(rp, 'SELECT * FROM assistant.document_readings', '42501', 'reporting cannot read readings');
    PERFORM pg_temp.expect_error(au, 'SELECT * FROM assistant.documents', '42501', 'auditor cannot read documents');
END
$$;

ROLLBACK;
