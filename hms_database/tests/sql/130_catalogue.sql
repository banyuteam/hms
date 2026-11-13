-- catalogue schema (migration 0022, ADR-SVC-012). Synthetic data only; rolled back.
BEGIN;

DO $$
DECLARE
    rt   text := pg_temp.r('runtime');
    org  uuid := '00000000-0000-7000-8000-0000000000c1';
    usr  uuid := '00000000-0000-7000-8000-0000000000c2';
    src  uuid := '00000000-0000-7000-8000-0000000000c3';
    lnk  uuid := '00000000-0000-7000-8000-0000000000c4';
    ts   timestamptz;
BEGIN
    INSERT INTO platform.organizations (id, code, name) VALUES (org, 'TEST-CAT', 'Catalogue Test Organization');
    INSERT INTO iam.users (id, organization_id, display_name) VALUES (usr, org, 'Catalogue Tester');

    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$
        INSERT INTO catalogue.sources (id, organization_id, title, source_type, publisher, created_by_user_id,
                                       updated_by_user_id, created_at, updated_at)
        VALUES (%L, %L, 'Synthetic tariff workbook', 'excel', 'Synthetic publisher', %L, %L, '2020-01-01', '2020-01-01')
    $q$, src, org, usr, usr)) = 1, 'runtime inserts a file-type source');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$
        INSERT INTO catalogue.sources (id, organization_id, title, source_type, url, created_by_user_id, updated_by_user_id)
        VALUES (%L, %L, 'Synthetic guideline page', 'url', 'https://example.org/guideline', %L, %L)
    $q$, lnk, org, usr, usr)) = 1, 'runtime inserts a link');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$
        INSERT INTO catalogue.data_titles (source_id, position, title) VALUES (%L, 1, 'Sheet A'), (%L, 2, 'Sheet B')
    $q$, src, src)) = 2, 'runtime inserts data titles');

    -- Links need an https URL; files never carry one; the type is from a fixed list.
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO catalogue.sources (organization_id, title, source_type,
        created_by_user_id, updated_by_user_id) VALUES (%L, 'No URL', 'url', %L, %L)$q$, org, usr, usr),
        '23514', 'a link needs a URL');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO catalogue.sources (organization_id, title, source_type, url,
        created_by_user_id, updated_by_user_id) VALUES (%L, 'Plain http', 'url', 'http://example.org', %L, %L)$q$, org, usr, usr),
        '23514', 'a link must be https');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO catalogue.sources (organization_id, title, source_type, url,
        created_by_user_id, updated_by_user_id) VALUES (%L, 'PDF with URL', 'pdf', 'https://example.org/a.pdf', %L, %L)$q$,
        org, usr, usr), '23514', 'a file-type source has no URL');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO catalogue.sources (organization_id, title, source_type,
        created_by_user_id, updated_by_user_id) VALUES (%L, 'Video', 'video', %L, %L)$q$, org, usr, usr),
        '23514', 'source type is from the fixed list');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO catalogue.sources (organization_id, title, source_type,
        created_by_user_id, updated_by_user_id) VALUES (%L, '   ', 'pdf', %L, %L)$q$, org, usr, usr),
        '23514', 'title must not be blank');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO catalogue.sources (organization_id, title, source_type,
        created_by_user_id, updated_by_user_id) VALUES (%L, 'Foreign user', 'pdf', uuidv7(), uuidv7())$q$, org),
        '23503', 'the creator must be a user of the same organization');

    -- Files: type from the source, reference and hash only.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$
        INSERT INTO catalogue.files (source_id, storage_key, media_type, size_bytes, content_sha256, uploaded_by_user_id)
        VALUES (%L, 'catalogue/2026/11/0195f0c4-0000-7000-8000-000000000001',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1024, sha256('x'), %L)
    $q$, src, usr)) = 1, 'runtime records the stored file of an Excel source');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE catalogue.files SET media_type = 'application/pdf'
        WHERE source_id = %L$q$, src), '23514', 'an Excel source cannot hold a PDF');
    PERFORM pg_temp.expect_error(rt, format($q$INSERT INTO catalogue.files (source_id, storage_key, media_type, size_bytes,
        content_sha256, uploaded_by_user_id) VALUES (%L, 'catalogue/2026/11/0195f0c4-0000-7000-8000-000000000002', 'application/pdf',
        1, sha256('y'), %L)$q$, lnk, usr), '23514', 'a link has no stored file');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE catalogue.files SET size_bytes = 20971521 WHERE source_id = %L$q$, src),
        '23514', 'files are at most 20 MiB');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE catalogue.files SET storage_key = '../etc/passwd' WHERE source_id = %L$q$, src),
        '23514', 'the storage key is a fixed shape, never a path or file name');
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE catalogue.files SET storage_key = 'documents/2026/11/0195f0c4-0000-7000-8000-000000000003'
        WHERE source_id = %L$q$, src), '23514', 'catalogue files stay in the catalogue namespace');

    -- Type is fixed after creation; updated_at is kept by trigger.
    PERFORM pg_temp.expect_error(rt, format($q$UPDATE catalogue.sources SET source_type = 'pdf' WHERE id = %L$q$, src),
        '42501', 'source type cannot be changed');
    PERFORM pg_temp.exec_as(rt, format($q$UPDATE catalogue.sources SET title = 'Renamed', version = version + 1 WHERE id = %L$q$, src));
    SELECT updated_at INTO ts FROM catalogue.sources WHERE id = src;
    PERFORM pg_temp.ok(ts = now(), 'updated_at is maintained by trigger');

    -- Deleting a source removes its data titles and file record.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, format($q$DELETE FROM catalogue.sources WHERE id = %L$q$, src)) = 1,
        'runtime deletes a source');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM catalogue.data_titles WHERE source_id = src)
                       AND NOT EXISTS (SELECT 1 FROM catalogue.files WHERE source_id = src),
                       'data titles and the file record go with their source');

    PERFORM pg_temp.expect_error(pg_temp.r('reporting'), 'SELECT * FROM catalogue.sources', '42501',
        'reporting does not read the catalogue');
END
$$;

ROLLBACK;
