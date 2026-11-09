-- Roles, database-level privileges and settings created by bootstrap/bootstrap.psql (ADR-DB-002).
BEGIN;

DO $$
DECLARE
    p   text := current_setting('hms.role_prefix');
    s   text;
    r   text;
BEGIN
    PERFORM pg_temp.ok((SELECT count(*) FROM pg_roles
                           WHERE rolname IN (p || '_owner', p || '_migrator', p || '_runtime', p || '_auditor', p || '_reporting')
                             AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
                             AND NOT rolbypassrls) = 5,
                          'the five per-database roles exist without elevated attributes');
    PERFORM pg_temp.ok((SELECT count(*) FROM pg_roles
                           WHERE rolname IN ('hms_platform_rw', 'hms_iam_rw', 'hms_eventing_rw', 'hms_integration_rw',
                                             'hms_audit_append', 'hms_audit_read', 'hms_report_read')
                             AND NOT rolcanlogin AND NOT rolsuper) = 7,
                          'the seven group roles exist and cannot log in');
    PERFORM pg_temp.ok(NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = p || '_owner'), 'owner cannot log in');
    PERFORM pg_temp.ok((SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = p || '_owner',
                          'database is owned by the owner role');
    PERFORM pg_temp.ok((SELECT datlocprovider = 'b' AND datlocale = 'C.UTF-8' AND pg_encoding_to_char(encoding) = 'UTF8'
                           FROM pg_database WHERE datname = current_database()),
                          'database uses UTF8 with the builtin C.UTF-8 locale');

    -- PUBLIC gets nothing.
    PERFORM pg_temp.ok(NOT has_database_privilege('public', current_database(), 'CONNECT'), 'PUBLIC cannot connect');
    PERFORM pg_temp.ok(NOT has_database_privilege('public', current_database(), 'TEMPORARY'), 'PUBLIC cannot create temp tables');
    PERFORM pg_temp.ok(NOT has_database_privilege('public', current_database(), 'CREATE'), 'PUBLIC cannot create schemas');
    PERFORM pg_temp.ok(NOT has_schema_privilege('public', 'public', 'USAGE') AND NOT has_schema_privilege('public', 'public', 'CREATE'),
                          'PUBLIC cannot use the public schema');

    -- Migrator acts only through SET ROLE <owner>.
    PERFORM pg_temp.ok(pg_has_role(p || '_migrator', p || '_owner', 'SET'), 'migrator can SET ROLE to owner');
    PERFORM pg_temp.ok(NOT pg_has_role(p || '_migrator', p || '_owner', 'USAGE'), 'migrator does not inherit owner rights');

    -- Runtime, auditor and reporting are members of exactly their groups.
    PERFORM pg_temp.ok((SELECT array_agg(g.rolname ORDER BY g.rolname) FROM pg_auth_members m
                           JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
                           WHERE u.rolname = p || '_runtime')
                          = ARRAY['hms_audit_append', 'hms_eventing_rw', 'hms_iam_rw', 'hms_integration_rw', 'hms_platform_rw']::name[],
                          'runtime is a member of exactly the five runtime groups');
    PERFORM pg_temp.ok(NOT pg_has_role(p || '_runtime', p || '_owner', 'MEMBER'), 'runtime is not a member of owner');
    PERFORM pg_temp.ok(NOT pg_has_role(p || '_runtime', 'hms_audit_read', 'MEMBER'), 'runtime cannot read the audit trail');

    -- No login role can create anything.
    FOREACH r IN ARRAY ARRAY[p || '_migrator', p || '_runtime', p || '_auditor', p || '_reporting'] LOOP
        PERFORM pg_temp.ok(NOT has_database_privilege(r, current_database(), 'CREATE'), r || ' cannot create schemas');
        PERFORM pg_temp.ok(NOT has_database_privilege(r, current_database(), 'TEMPORARY'), r || ' cannot create temp tables');
        FOR s IN SELECT nspname FROM pg_namespace
                 WHERE nspname IN ('public', 'hms_meta', 'platform', 'audit', 'eventing', 'integration', 'iam') LOOP
            PERFORM pg_temp.ok(NOT has_schema_privilege(r, s, 'CREATE'), r || ' cannot create objects in ' || s);
        END LOOP;
        PERFORM pg_temp.ok(NOT has_table_privilege(r, 'hms_meta.schema_migrations', 'SELECT'), r || ' cannot read the ledger');
    END LOOP;

    -- Settings.
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
                                  WHERE d.datname = current_database() AND s.setrole = 0 AND 'TimeZone=UTC' = ANY (s.setconfig)),
                          'database time zone is UTC');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
                                  JOIN pg_roles u ON u.oid = s.setrole
                                  WHERE d.datname = current_database() AND u.rolname = p || '_runtime'
                                    AND 'statement_timeout=30s' = ANY (s.setconfig) AND 'lock_timeout=5s' = ANY (s.setconfig)),
                          'runtime has statement and lock timeouts');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
                                  JOIN pg_roles u ON u.oid = s.setrole
                                  WHERE d.datname = current_database() AND u.rolname = p || '_reporting'
                                    AND 'default_transaction_read_only=on' = ANY (s.setconfig)),
                          'reporting sessions are read-only');
END
$$;

-- DDL attempts actually fail for the runtime role.
DO $$
BEGIN
    PERFORM pg_temp.expect_error(pg_temp.r('runtime'), 'CREATE TABLE platform.t_probe (id int)', '42501', 'runtime CREATE TABLE');
    PERFORM pg_temp.expect_error(pg_temp.r('runtime'), 'CREATE SCHEMA probe', '42501', 'runtime CREATE SCHEMA');
    PERFORM pg_temp.expect_error(pg_temp.r('runtime'), 'DROP TABLE platform.organizations', '42501', 'runtime DROP TABLE');
    PERFORM pg_temp.expect_error(pg_temp.r('runtime'), 'ALTER TABLE audit.audit_events DISABLE TRIGGER ALL', '42501',
                                 'runtime disables audit triggers');
    PERFORM pg_temp.expect_error(pg_temp.r('runtime'), 'CREATE TEMP TABLE t_probe (id int)', '42501', 'runtime CREATE TEMP TABLE');
    PERFORM pg_temp.expect_error(pg_temp.r('migrator'), 'SELECT 1 FROM platform.organizations', '42501',
                                 'migrator has no data access without SET ROLE');
END
$$;

ROLLBACK;
