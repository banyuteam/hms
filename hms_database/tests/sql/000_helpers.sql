-- Test helpers: session-local functions in pg_temp, gone when the test session ends. Requires a superuser session
-- (scripts/test.*) and the psql variable role_prefix.
SELECT set_config('hms.role_prefix', :'role_prefix', false) AS hms_ignored \gset

-- Name of a per-database role, e.g. pg_temp.r('runtime') -> hms_meta_runtime.
CREATE FUNCTION pg_temp.r(p_kind text) RETURNS text LANGUAGE sql AS $$
    SELECT current_setting('hms.role_prefix') || '_' || p_kind
$$;

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL: %', p_label;
    END IF;
END
$$;

-- Runs p_sql as p_role and returns the number of rows it processed.
CREATE FUNCTION pg_temp.exec_as(p_role text, p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RETURN n;
END
$$;

-- Asserts that p_sql run as p_role fails with p_sqlstate (42501 privilege, 23514 check, 23505 unique, P0001 raise).
CREATE FUNCTION pg_temp.expect_error(p_role text, p_sql text, p_sqlstate text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
    BEGIN
        PERFORM pg_temp.exec_as(p_role, p_sql);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS got = RETURNED_SQLSTATE;
        IF got = p_sqlstate THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL: %: expected SQLSTATE %, got % (%)', p_label, p_sqlstate, got, SQLERRM;
    END;
    RAISE EXCEPTION 'FAIL: %: expected SQLSTATE %, but the statement succeeded', p_label, p_sqlstate;
END
$$;
