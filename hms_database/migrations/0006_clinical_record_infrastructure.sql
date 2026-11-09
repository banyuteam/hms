-- 0006 clinical record infrastructure: transaction context, version history, correction rules and tenant row-level
-- security shared by the patient, workforce, clinical, imaging and privacy schemas (ADR-DB-005).
-- Owner: hms_database. These functions are used by triggers and by later migrations; no role is granted EXECUTE.
-- Classification: internal (definitions only, no data).
--
-- Transaction context contract (hms_services sets these with set_config(name, value, true) in every write
-- transaction; they are transaction-local and never trusted for authorization, only recorded):
--   hms.organization_id  tenant of the transaction (uuid); row-level security shows and accepts only this tenant
--   hms.actor_user_id    iam.users.id of the person acting, or
--   hms.actor_service    service name when no person acts (e.g. legacy-import); exactly one of the two
--   hms.request_id       optional request/correlation identifier (no PHI)
--   hms.change_reason    reason, required to change a finalized record or to mark one entered-in-error
-- Online-safe: creates new functions only. Rollback: fix forward.

-- The person or service acting in this transaction. A person must be an active user of the record's organization.
-- Raises when neither or both are set, so no clinical row can be written without attribution.
CREATE FUNCTION hms_meta.current_actor(p_organization_id uuid, OUT actor_user_id uuid, OUT actor_service text)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    u text := nullif(current_setting('hms.actor_user_id', true), '');
    s text := nullif(current_setting('hms.actor_service', true), '');
BEGIN
    IF (u IS NULL) = (s IS NULL) THEN
        RAISE EXCEPTION 'record change without actor: set exactly one of hms.actor_user_id or hms.actor_service'
            USING ERRCODE = 'P0001';
    END IF;
    IF s IS NOT NULL THEN
        IF s !~ '^[a-z][a-z0-9_.-]{0,63}$' THEN
            RAISE EXCEPTION 'hms.actor_service "%" is not a valid service name', s;
        END IF;
        actor_service := s;
        RETURN;
    END IF;
    actor_user_id := u::uuid;
    IF NOT EXISTS (SELECT 1 FROM iam.users x
                   WHERE x.id = actor_user_id AND x.organization_id = p_organization_id AND x.status = 'active') THEN
        RAISE EXCEPTION 'actor % is not an active user of organization %', actor_user_id, p_organization_id;
    END IF;
END
$$;
COMMENT ON FUNCTION hms_meta.current_actor(uuid) IS
    'Actor of the transaction from hms.actor_user_id / hms.actor_service; raises if missing, ambiguous or not active';

-- BEFORE INSERT OR UPDATE on every versioned record table.
--   TG_ARGV[0]: comma-separated columns that never change (always includes id and organization_id)
--   TG_ARGV[1]: comma-separated statuses in which the record is finalized: changing it then needs hms.change_reason
-- Rules: version starts at 1 and grows by one per transaction that changes the row; created_at is fixed;
-- entered-in-error (status or verification_status) is terminal and needs a reason to enter.
-- "Same transaction" is (last_xact_id, updated_at) = (current transaction id, transaction start time): the time makes
-- the test safe after a logical restore into a new cluster, whose transaction ids restart and may repeat old values.
CREATE FUNCTION hms_meta.version_row() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    fixed_cols  text[] := string_to_array(TG_ARGV[0], ',');
    locked      text[] := coalesce(string_to_array(nullif(TG_ARGV[1], ''), ','), '{}');
    reason      text := nullif(btrim(current_setting('hms.change_reason', true)), '');
    o           jsonb;
    n           jsonb;
    c           text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.version := 1;
        NEW.created_at := now();
        NEW.updated_at := now();
        NEW.last_xact_id := pg_current_xact_id();
        RETURN NEW;
    END IF;

    o := to_jsonb(OLD);
    n := to_jsonb(NEW);
    IF 'entered-in-error' IN (o->>'status', o->>'verification_status') THEN
        RAISE EXCEPTION '%.% row % is entered-in-error and cannot change', TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id;
    END IF;
    FOREACH c IN ARRAY fixed_cols LOOP
        IF n->c IS DISTINCT FROM o->c THEN
            RAISE EXCEPTION '%.%: column % cannot change', TG_TABLE_SCHEMA, TG_TABLE_NAME, c;
        END IF;
    END LOOP;
    IF reason IS NULL AND (o->>'status' = ANY (locked)
                           OR 'entered-in-error' IN (n->>'status', n->>'verification_status')) THEN
        RAISE EXCEPTION '%.% row %: set hms.change_reason to correct a finalized record or mark it entered-in-error',
            TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id;
    END IF;

    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    IF OLD.last_xact_id = pg_current_xact_id() AND OLD.updated_at = now() THEN
        NEW.version := OLD.version;
    ELSE
        NEW.version := OLD.version + 1;
    END IF;
    NEW.last_xact_id := pg_current_xact_id();
    RETURN NEW;
END
$$;
COMMENT ON FUNCTION hms_meta.version_row() IS
    'Versioning, fixed columns, terminal entered-in-error and change-reason rules for record tables';

-- AFTER INSERT OR UPDATE on every versioned record table: writes the row as it now is into
-- <schema>.resource_versions with the actor, request and reason. One version per transaction: a second change in
-- the same transaction replaces that version's snapshot. Runs as the owner, so writers cannot write history directly.
--   TG_ARGV[0]: resource type, e.g. Encounter or Encounter.participant
--   TG_ARGV[1]: column holding the patient id ('' when the table has none)
CREATE FUNCTION hms_meta.capture_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    snap     jsonb := to_jsonb(NEW) - 'last_xact_id';
    org      uuid := (snap->>'organization_id')::uuid;
    pcol     text := nullif(TG_ARGV[1], '');
    a_user   uuid;
    a_svc    text;
BEGIN
    SELECT a.actor_user_id, a.actor_service INTO a_user, a_svc FROM hms_meta.current_actor(org) a;
    EXECUTE format(
        'INSERT INTO %I.resource_versions AS v (resource_type, resource_id, version, organization_id, patient_id,
                operation, snapshot, snapshot_sha256, actor_user_id, actor_service, request_id, change_reason, xact_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, sha256(convert_to($7::text, ''UTF8'')), $8, $9, $10, $11, pg_current_xact_id())
         ON CONFLICT (resource_type, resource_id, version) DO UPDATE
         SET snapshot = EXCLUDED.snapshot, snapshot_sha256 = EXCLUDED.snapshot_sha256,
             change_reason = coalesce(EXCLUDED.change_reason, v.change_reason)',
        TG_TABLE_SCHEMA)
    USING TG_ARGV[0], NEW.id, NEW.version, org,
          CASE WHEN pcol IS NULL THEN NULL ELSE (snap->>pcol)::uuid END,
          CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END,
          snap, a_user, a_svc,
          left(nullif(current_setting('hms.request_id', true), ''), 128),
          left(nullif(btrim(current_setting('hms.change_reason', true)), ''), 1000);
    RETURN NULL;
END
$$;
COMMENT ON FUNCTION hms_meta.capture_version() IS 'Appends the new row version, actor and reason to <schema>.resource_versions';

-- AFTER INSERT OR UPDATE on a child table (e.g. a patient name): records a new version of the parent once per
-- transaction, so the parent's version moves whenever any of its parts change and finalized-record rules apply to
-- the parts too.  TG_ARGV[0]: parent table; TG_ARGV[1]: child column holding the parent id.
CREATE FUNCTION hms_meta.touch_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    EXECUTE format('UPDATE %s SET updated_at = now() WHERE id = $1 AND NOT (last_xact_id = pg_current_xact_id() AND updated_at = now())',
                   TG_ARGV[0]::regclass)
    USING (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
    RETURN NULL;
END
$$;
COMMENT ON FUNCTION hms_meta.touch_parent() IS 'Bumps the parent record version when a child row changes';

CREATE FUNCTION hms_meta.refuse_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION '%.% does not allow % (records are corrected or marked entered-in-error, never removed)',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END
$$;
COMMENT ON FUNCTION hms_meta.refuse_change() IS 'Refuses the triggering operation (DELETE/TRUNCATE on records, any change on append-only tables)';

-- Version history rows are sealed when their transaction commits: only the transaction that wrote a version may
-- replace its snapshot (one version per transaction); nothing may delete or truncate history. The writing
-- transaction is recognised by its id and by recorded_at not preceding its start (ids repeat after a logical restore).
CREATE FUNCTION hms_meta.seal_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.xact_id = pg_current_xact_id() AND OLD.recorded_at >= now()
       AND (NEW.resource_type, NEW.resource_id, NEW.version, NEW.organization_id, NEW.xact_id)
           IS NOT DISTINCT FROM (OLD.resource_type, OLD.resource_id, OLD.version, OLD.organization_id, OLD.xact_id) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION '%.% is append-only (% refused)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END
$$;
COMMENT ON FUNCTION hms_meta.seal_version() IS 'Append-only guard for resource_versions (same-transaction snapshot replacement only)';

-- Migration helper: creates <schema>.resource_versions with tenant row-level security. Readers are granted by the
-- calling migration.
CREATE FUNCTION hms_meta.create_version_store(p_schema name) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    EXECUTE format($ddl$
        CREATE TABLE %1$I.resource_versions (
            resource_type    text        NOT NULL,
            resource_id      uuid        NOT NULL,
            version          integer     NOT NULL,
            organization_id  uuid        NOT NULL,
            patient_id       uuid,
            operation        text        NOT NULL,
            snapshot         jsonb       NOT NULL,
            snapshot_sha256  bytea       NOT NULL,
            recorded_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
            actor_user_id    uuid,
            actor_service    text,
            request_id       text,
            change_reason    text,
            xact_id          xid8        NOT NULL,
            CONSTRAINT pk_resource_versions PRIMARY KEY (resource_type, resource_id, version),
            CONSTRAINT fk_resource_versions_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
            CONSTRAINT fk_resource_versions_actor_user_id FOREIGN KEY (actor_user_id) REFERENCES iam.users (id),
            CONSTRAINT ck_resource_versions_resource_type CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}(\.[a-z][A-Za-z]{0,63})?$'),
            CONSTRAINT ck_resource_versions_version CHECK (version >= 1),
            CONSTRAINT ck_resource_versions_operation CHECK (operation IN ('create', 'update')),
            CONSTRAINT ck_resource_versions_actor CHECK ((actor_user_id IS NULL) <> (actor_service IS NULL)),
            CONSTRAINT ck_resource_versions_sha256 CHECK (octet_length(snapshot_sha256) = 32)
        )$ddl$, p_schema);
    EXECUTE format('COMMENT ON TABLE %I.resource_versions IS %L', p_schema,
                   'Append-only version history of ' || p_schema || ' records (snapshot, actor, reason); written by trigger only');
    EXECUTE format('CREATE INDEX idx_resource_versions_patient_id ON %I.resource_versions (patient_id, recorded_at) WHERE patient_id IS NOT NULL', p_schema);
    EXECUTE format('CREATE INDEX idx_resource_versions_recorded_at ON %I.resource_versions (recorded_at)', p_schema);
    EXECUTE format('CREATE INDEX idx_resource_versions_actor_user_id ON %I.resource_versions (actor_user_id, recorded_at) WHERE actor_user_id IS NOT NULL', p_schema);
    EXECUTE format('CREATE TRIGGER trg_resource_versions_seal BEFORE UPDATE OR DELETE ON %I.resource_versions
                    FOR EACH ROW EXECUTE FUNCTION hms_meta.seal_version()', p_schema);
    EXECUTE format('CREATE TRIGGER trg_resource_versions_no_truncate BEFORE TRUNCATE ON %I.resource_versions
                    FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change()', p_schema);
    PERFORM hms_meta.enable_tenant_rls(format('%I.resource_versions', p_schema)::regclass);
END
$$;
COMMENT ON FUNCTION hms_meta.create_version_store(name) IS 'Migration helper: creates <schema>.resource_versions';

-- Migration helper: tenant isolation. Rows are visible and writable only when organization_id equals the
-- transaction's hms.organization_id; without it nothing is visible (fail closed). The owner (migrations, trigger
-- functions, pseudonymized analytics views) is not subject to the policy.
CREATE FUNCTION hms_meta.enable_tenant_rls(p_table regclass) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %s
                      USING (organization_id = nullif(current_setting('hms.organization_id', true), '')::uuid)
                      WITH CHECK (organization_id = nullif(current_setting('hms.organization_id', true), '')::uuid)$p$,
                   p_table);
END
$$;
COMMENT ON FUNCTION hms_meta.enable_tenant_rls(regclass) IS 'Migration helper: tenant row-level security on organization_id';

-- Migration helper: makes a table a versioned record (version_row, capture_version, no DELETE/TRUNCATE, tenant RLS,
-- and optionally parent touching). The table must have id, organization_id, version, created_at, updated_at and
-- last_xact_id columns.
CREATE FUNCTION hms_meta.enable_versioned_record(
    p_table          regclass,
    p_resource_type  text,
    p_patient_column text,
    p_fixed_columns  text,
    p_locked_status  text DEFAULT '',
    p_parent_table   regclass DEFAULT NULL,
    p_parent_column  text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    t text := (SELECT c.relname FROM pg_class c WHERE c.oid = p_table);
BEGIN
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION hms_meta.version_row(%L, %L)',
                   'trg_' || t || '_version', p_table, p_fixed_columns, p_locked_status);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION hms_meta.capture_version(%L, %L)',
                   'trg_' || t || '_capture', p_table, p_resource_type, coalesce(p_patient_column, ''));
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change()',
                   'trg_' || t || '_no_delete', p_table);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION hms_meta.refuse_change()',
                   'trg_' || t || '_no_truncate', p_table);
    IF p_parent_table IS NOT NULL THEN
        EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_parent(%L, %L)',
                       'trg_' || t || '_touch_parent', p_table, p_parent_table::text, p_parent_column);
    END IF;
    PERFORM hms_meta.enable_tenant_rls(p_table);
END
$$;
COMMENT ON FUNCTION hms_meta.enable_versioned_record(regclass, text, text, text, text, regclass, text) IS
    'Migration helper: versioning, history capture, no delete, tenant RLS and parent touch for a record table';
