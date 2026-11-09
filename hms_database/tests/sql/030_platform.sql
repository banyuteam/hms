-- platform.organizations and platform.facilities (migration 0001). Synthetic data only; rolled back.
BEGIN;

DO $$
DECLARE
    rt   text := pg_temp.r('runtime');
    ts   timestamptz;
BEGIN
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO platform.organizations (id, code, name, created_at, updated_at)
        VALUES ('00000000-0000-7000-8000-000000000001', 'TEST-ORG', 'Test Organization', '2020-01-01', '2020-01-01')
    $q$) = 1, 'runtime inserts an organization');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO platform.facilities (organization_id, code, name, timezone)
        VALUES ('00000000-0000-7000-8000-000000000001', 'TEST-FAC', 'Test Facility', 'Asia/Jakarta')
    $q$) = 1, 'runtime inserts a facility');

    PERFORM pg_temp.ok((SELECT id FROM platform.facilities WHERE code = 'TEST-FAC')::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7',
                          'default ids are UUIDv7');

    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO platform.organizations (code, name) VALUES ('TEST-ORG', 'Duplicate')$q$,
                                 '23505', 'organization code is unique');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO platform.organizations (code, name) VALUES ('lower', 'Bad code')$q$,
                                 '23514', 'organization code format');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO platform.facilities (organization_id, code, name, timezone)
                                       VALUES (uuidv7(), 'X', 'Orphan', 'Asia/Jakarta')$q$,
                                 '23503', 'facility requires an organization');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO platform.facilities (organization_id, code, name, timezone)
                                       VALUES ('00000000-0000-7000-8000-000000000001', 'TZ', 'Bad zone', 'WIB')$q$,
                                 '23514', 'facility timezone must be an IANA name');
    PERFORM pg_temp.expect_error(rt, $q$DELETE FROM platform.facilities$q$, '42501', 'runtime cannot delete facilities');

    PERFORM pg_temp.exec_as(rt, $q$UPDATE platform.organizations SET name = 'Renamed' WHERE code = 'TEST-ORG'$q$);
    SELECT updated_at INTO ts FROM platform.organizations WHERE code = 'TEST-ORG';
    PERFORM pg_temp.ok(ts = now(), 'updated_at is maintained by trigger');

    PERFORM pg_temp.ok(pg_temp.exec_as(pg_temp.r('reporting'), 'SELECT * FROM platform.facilities') >= 1,
                          'reporting reads facilities');
    PERFORM pg_temp.expect_error(pg_temp.r('reporting'), $q$UPDATE platform.facilities SET name = 'x'$q$, '42501',
                                 'reporting cannot write');
END
$$;

ROLLBACK;
