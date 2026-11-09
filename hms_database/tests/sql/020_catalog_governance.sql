-- Governance rules that every migration must keep true (database-engineering and shared-postgresql-platform skills).
BEGIN;

DO $$
DECLARE
    p        text := current_setting('hms.role_prefix');
    schemas  text[] := ARRAY['hms_meta', 'platform', 'audit', 'eventing', 'integration', 'iam'];
    offender text;
BEGIN
    SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offender
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND pg_get_userbyid(c.relowner) <> p || '_owner';
    PERFORM pg_temp.ok(offender IS NULL, 'relations not owned by the owner role: ' || coalesce(offender, ''));

    SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offender
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p');
    PERFORM pg_temp.ok(offender IS NULL, 'tables without a primary key: ' || coalesce(offender, ''));

    SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offender
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND (has_table_privilege('public', c.oid, 'SELECT') OR has_table_privilege('public', c.oid, 'INSERT')
           OR has_table_privilege('public', c.oid, 'UPDATE') OR has_table_privilege('public', c.oid, 'DELETE'));
    PERFORM pg_temp.ok(offender IS NULL, 'relations accessible to PUBLIC: ' || coalesce(offender, ''));

    SELECT string_agg(f.oid::regprocedure::text, ', ') INTO offender
    FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
    WHERE n.nspname = ANY (schemas) AND has_function_privilege('public', f.oid, 'EXECUTE');
    PERFORM pg_temp.ok(offender IS NULL, 'functions executable by PUBLIC: ' || coalesce(offender, ''));

    SELECT string_agg(f.oid::regprocedure::text, ', ') INTO offender
    FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
    WHERE n.nspname = ANY (schemas)
      AND NOT EXISTS (SELECT 1 FROM unnest(f.proconfig) c WHERE c LIKE 'search_path=%');
    PERFORM pg_temp.ok(offender IS NULL, 'functions without a fixed search_path: ' || coalesce(offender, ''));

    SELECT string_agg(n.nspname || '.' || c.relname || '.' || a.attname, ', ') INTO offender
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid IN ('timestamp'::regtype, 'money'::regtype, 'real'::regtype, 'double precision'::regtype);
    PERFORM pg_temp.ok(offender IS NULL, 'columns using timestamp without time zone, money or float: ' || coalesce(offender, ''));

    -- No credential storage (ADR-DB-003): no column that looks like a password, PIN, secret, token or private key.
    SELECT string_agg(n.nspname || '.' || c.relname || '.' || a.attname, ', ') INTO offender
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname ~ '(^|_)(password|passwd|pin|secret|token|private_key|api_key)(_|$)';
    PERFORM pg_temp.ok(offender IS NULL, 'columns that look like stored credentials: ' || coalesce(offender, ''));

    -- Each reader role sees only its schemas.
    PERFORM pg_temp.ok(has_table_privilege(p || '_reporting', 'platform.facilities', 'SELECT'), 'reporting reads platform');
    PERFORM pg_temp.ok(NOT has_table_privilege(p || '_reporting', 'audit.audit_events', 'SELECT'), 'reporting cannot read audit');
    PERFORM pg_temp.ok(NOT has_table_privilege(p || '_reporting', 'eventing.outbox_events', 'SELECT'), 'reporting cannot read outbox');
    PERFORM pg_temp.ok(NOT has_table_privilege(p || '_reporting', 'integration.poll_checkpoints', 'SELECT'),
                          'reporting cannot read integration state');
    PERFORM pg_temp.ok(has_table_privilege(p || '_auditor', 'audit.audit_events', 'SELECT'), 'auditor reads audit');
    PERFORM pg_temp.ok(NOT has_table_privilege(p || '_auditor', 'audit.audit_events', 'INSERT'), 'auditor cannot write audit');
    PERFORM pg_temp.ok(NOT has_table_privilege(p || '_auditor', 'platform.facilities', 'SELECT'), 'auditor cannot read platform');
    PERFORM pg_temp.ok(NOT has_table_privilege(p || '_runtime', 'audit.audit_events', 'SELECT'), 'runtime cannot read audit');
    PERFORM pg_temp.ok(NOT has_table_privilege(p || '_runtime', 'audit.audit_events', 'UPDATE')
                          AND NOT has_table_privilege(p || '_runtime', 'audit.audit_events', 'DELETE')
                          AND NOT has_table_privilege(p || '_runtime', 'audit.audit_events', 'TRUNCATE'),
                          'runtime cannot change or remove audit rows');
END
$$;

ROLLBACK;
