-- Governance rules that every migration must keep true (database-engineering and shared-postgresql-platform skills).
BEGIN;

DO $$
DECLARE
    p        text := current_setting('hms.role_prefix');
    schemas  text[] := ARRAY['hms_meta', 'platform', 'audit', 'eventing', 'integration', 'iam', 'terminology',
                             'workforce', 'patient', 'clinical', 'knowledge', 'imaging', 'readmodel', 'privacy',
                             'analytics', 'catalogue', 'document'];
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

-- Clinical record governance (ADR-DB-004/005).
DO $$
DECLARE
    p        text := current_setting('hms.role_prefix');
    record_schemas text[] := ARRAY['patient', 'workforce', 'clinical', 'imaging', 'privacy', 'readmodel'];
    offender text;
BEGIN
    -- Every tenant-scoped table in the record schemas (and new integration state) has tenant row-level security.
    SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offender
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND (n.nspname = ANY (record_schemas)
           OR (n.nspname = 'integration' AND c.relname IN ('legacy_record_links', 'external_resource_ids',
                                                           'outbound_submissions', 'validation_results',
                                                           'domain_authority', 'bridge_issues')))
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped)
      AND NOT (c.relrowsecurity AND EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid AND pol.polname = 'tenant_isolation'));
    PERFORM pg_temp.ok(offender IS NULL, 'tenant tables without row-level security: ' || coalesce(offender, ''));

    -- No login role can delete or truncate clinical record rows or their history.
    SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offender
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('patient', 'workforce', 'clinical', 'imaging', 'privacy') AND c.relkind IN ('r', 'p')
      AND (has_table_privilege(p || '_runtime', c.oid, 'DELETE') OR has_table_privilege(p || '_runtime', c.oid, 'TRUNCATE')
           OR has_table_privilege(p || '_legacy_bridge', c.oid, 'DELETE')
           OR has_table_privilege(p || '_legacy_bridge', c.oid, 'TRUNCATE'));
    PERFORM pg_temp.ok(offender IS NULL, 'record tables the runtime or bridge may delete from: ' || coalesce(offender, ''));

    -- Layer separation (ADR-ROOT-002): every versioned record table is in a domain, records its origin and is guarded;
    -- a child table is in its parent's domain (they cut over together).
    SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offender
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('patient', 'workforce', 'clinical', 'imaging') AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgfoid = 'hms_meta.capture_version'::regproc)
      AND NOT (EXISTS (SELECT 1 FROM integration.record_domain_tables d WHERE d.table_name = n.nspname || '.' || c.relname)
               AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'record_origin' AND NOT a.attisdropped)
               AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgfoid = 'hms_meta.guard_record_layer'::regproc
                                                       AND t.tgenabled = 'O'));
    PERFORM pg_temp.ok(offender IS NULL, 'record tables without domain, origin or layer guard: ' || coalesce(offender, ''));
    SELECT string_agg(child.table_name, ', ') INTO offender
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN integration.record_domain_tables child ON child.table_name = n.nspname || '.' || c.relname
    JOIN integration.record_domain_tables parent
      ON parent.table_name = split_part(encode(t.tgargs, 'escape'), '\000', 1)
    WHERE t.tgfoid = 'hms_meta.touch_parent'::regproc AND child.domain <> parent.domain;
    PERFORM pg_temp.ok(offender IS NULL, 'child tables outside their parent''s domain: ' || coalesce(offender, ''));
    PERFORM pg_temp.ok(NOT has_table_privilege(p || '_runtime', 'integration.domain_authority', 'INSERT')
                       AND NOT has_table_privilege(p || '_runtime', 'integration.domain_authority', 'UPDATE')
                       AND NOT has_table_privilege(p || '_legacy_bridge', 'integration.domain_authority', 'INSERT')
                       AND NOT has_table_privilege(p || '_legacy_bridge', 'integration.domain_authority', 'UPDATE'),
                          'domain authority is changed by the owner only');
    SELECT string_agg(x.t, ', ') INTO offender
    FROM unnest(ARRAY['integration.legacy_record_links', 'integration.poll_checkpoints', 'integration.poll_leases',
                      'integration.sync_runs', 'integration.bridge_issues']) AS x(t)
    WHERE has_table_privilege(p || '_runtime', x.t, 'INSERT')
       OR has_any_column_privilege(p || '_runtime', x.t, 'UPDATE') AND x.t <> 'integration.bridge_issues';
    PERFORM pg_temp.ok(offender IS NULL, 'bridge state the native runtime may write: ' || coalesce(offender, ''));
    SELECT string_agg(x.t, ', ') INTO offender
    FROM unnest(ARRAY['integration.outbound_submissions', 'integration.external_resource_ids', 'iam.users',
                      'iam.role_assignments', 'privacy.disclosures', 'readmodel.clinical_timeline']) AS x(t)
    WHERE to_regclass(x.t) IS NOT NULL
      AND (has_table_privilege(p || '_legacy_bridge', x.t, 'INSERT') OR has_any_column_privilege(p || '_legacy_bridge', x.t, 'UPDATE'));
    PERFORM pg_temp.ok(offender IS NULL, 'native-only tables the bridge may write: ' || coalesce(offender, ''));

    -- Every table with a version column is versioned by trigger and refuses DELETE even for the owner.
    SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offender
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND c.relname <> 'resource_versions'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'last_xact_id' AND NOT a.attisdropped)
      AND NOT (EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgfoid = 'hms_meta.version_row'::regproc)
               AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgfoid = 'hms_meta.capture_version'::regproc)
               AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgfoid = 'hms_meta.refuse_change'::regproc));
    PERFORM pg_temp.ok(offender IS NULL, 'versioned tables missing version/capture/no-delete triggers: ' || coalesce(offender, ''));

    -- History is written only by the capture trigger.
    SELECT string_agg(n.nspname || '.resource_versions', ', ') INTO offender
    FROM pg_namespace n
    WHERE to_regclass(n.nspname || '.resource_versions') IS NOT NULL
      AND (has_table_privilege(p || '_runtime', n.nspname || '.resource_versions', 'INSERT')
           OR has_table_privilege(p || '_runtime', n.nspname || '.resource_versions', 'UPDATE')
           OR has_table_privilege(p || '_legacy_bridge', n.nspname || '.resource_versions', 'INSERT')
           OR has_table_privilege(p || '_legacy_bridge', n.nspname || '.resource_versions', 'UPDATE'));
    PERFORM pg_temp.ok(offender IS NULL, 'version history writable by the runtime or bridge: ' || coalesce(offender, ''));

    -- Readers: reporting sees terminology, knowledge and pseudonymized analytics only; auditors no clinical content.
    PERFORM pg_temp.ok(has_table_privilege(p || '_reporting', 'analytics.encounter_facts', 'SELECT'), 'reporting reads analytics');
    PERFORM pg_temp.ok(has_table_privilege(p || '_reporting', 'terminology.code_systems', 'SELECT'), 'reporting reads terminology');
    PERFORM pg_temp.ok(NOT has_table_privilege(p || '_reporting', 'analytics.patient_pseudonyms', 'SELECT')
                          AND NOT has_table_privilege(p || '_runtime', 'analytics.patient_pseudonyms', 'SELECT'),
                          'nobody but the owner reads the pseudonym keys');
    SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offender
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('patient', 'workforce', 'clinical', 'imaging', 'readmodel', 'privacy', 'integration')
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND has_table_privilege(p || '_reporting', c.oid, 'SELECT');
    PERFORM pg_temp.ok(offender IS NULL, 'reporting can read identifiable tables: ' || coalesce(offender, ''));
    SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO offender
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('patient', 'clinical', 'imaging', 'readmodel', 'integration') AND c.relkind IN ('r', 'p', 'v', 'm')
      AND has_table_privilege(p || '_auditor', c.oid, 'SELECT');
    PERFORM pg_temp.ok(offender IS NULL, 'auditor can read clinical content: ' || coalesce(offender, ''));
    PERFORM pg_temp.ok(has_table_privilege(p || '_auditor', 'privacy.disclosures', 'SELECT'), 'auditor reads disclosures');

    -- Analytics views expose no direct identifiers.
    SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO offender
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'analytics' AND c.relkind = 'v' AND a.attnum > 0
      AND (a.attname IN ('patient_id', 'encounter_id', 'id', 'birth_date', 'name', 'text', 'value', 'note', 'value_string')
           OR a.attname LIKE '%name%' OR a.attname LIKE '%identifier%' OR a.attname LIKE '%address%');
    PERFORM pg_temp.ok(offender IS NULL, 'analytics view columns that identify: ' || coalesce(offender, ''));
END
$$;

ROLLBACK;
