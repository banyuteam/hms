-- 0002 audit trail: append-only, hash-chained audit events (schema audit).
-- Owner: hms_database (definitions); writes: hms_services audit integration (INSERT only); reads: audit reviewers.
-- Classification: restricted. Rows hold identifiers and outcomes (actor, resource type/id, request), never record
-- contents, field values, tokens or passwords; detail is a small JSON object for non-PHI context.
-- Integrity: UPDATE, DELETE and TRUNCATE are refused by triggers; each row carries prev_hash (hash of the preceding
-- row) and hash (SHA-256 over its own content and prev_hash), so audit.verify_chain() detects edits and removals
-- inside the chain. Removal of the newest rows is only detectable against an externally anchored hash (see
-- schemas/audit/README.md).
-- Online-safe: creates new objects only. Rollback: fix forward (audit evidence is never dropped outside development).

CREATE SCHEMA audit;
COMMENT ON SCHEMA audit IS 'hms_database: append-only security and access audit trail';

CREATE TABLE audit.audit_events (
    seq              bigint      NOT NULL,
    event_id         uuid        NOT NULL DEFAULT uuidv7(),
    recorded_at      timestamptz NOT NULL,
    occurred_at      timestamptz,
    category         text        NOT NULL,
    action           text        NOT NULL,
    outcome          text        NOT NULL,
    actor_type       text        NOT NULL,
    actor_id         text,
    actor_role       text,
    organization_id  uuid,
    facility_id      uuid,
    resource_type    text,
    resource_id      text,
    purpose_of_use   text,
    channel          text,
    request_id       text,
    correlation_id   uuid,
    client_addr      inet,
    detail           jsonb       NOT NULL DEFAULT '{}'::jsonb,
    prev_hash        bytea       NOT NULL,
    hash             bytea       NOT NULL,
    CONSTRAINT pk_audit_events PRIMARY KEY (seq),
    CONSTRAINT uq_audit_events_event_id UNIQUE (event_id),
    CONSTRAINT uq_audit_events_hash UNIQUE (hash),
    CONSTRAINT ck_audit_events_category CHECK (category IN
        ('authentication', 'authorization', 'data_access', 'data_change', 'administration', 'security', 'system')),
    CONSTRAINT ck_audit_events_action CHECK (action ~ '^[a-z][a-z0-9_.:-]{0,127}$'),
    CONSTRAINT ck_audit_events_outcome CHECK (outcome IN ('success', 'denied', 'failure')),
    CONSTRAINT ck_audit_events_actor_type CHECK (actor_type IN ('user', 'service', 'system', 'anonymous')),
    CONSTRAINT ck_audit_events_actor_id CHECK (length(actor_id) <= 128),
    CONSTRAINT ck_audit_events_actor_role CHECK (length(actor_role) <= 64),
    CONSTRAINT ck_audit_events_resource_type CHECK (resource_type ~ '^[A-Za-z][A-Za-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_audit_events_resource_id CHECK (length(resource_id) <= 128),
    CONSTRAINT ck_audit_events_purpose_of_use CHECK (purpose_of_use ~ '^[A-Za-z][A-Za-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_audit_events_channel CHECK (channel ~ '^[a-z][a-z0-9_-]{0,31}$'),
    CONSTRAINT ck_audit_events_request_id CHECK (length(request_id) <= 128),
    CONSTRAINT ck_audit_events_detail CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 8192),
    CONSTRAINT ck_audit_events_hash_len CHECK (octet_length(hash) = 32 AND octet_length(prev_hash) = 32)
);
COMMENT ON TABLE audit.audit_events IS 'Append-only, hash-chained audit trail; never holds record contents or secrets';
COMMENT ON COLUMN audit.audit_events.seq IS 'Chain position, assigned by trigger: contiguous from 1, no gaps';
COMMENT ON COLUMN audit.audit_events.event_id IS 'Writer-supplied idempotency key (retries use ON CONFLICT DO NOTHING)';
COMMENT ON COLUMN audit.audit_events.recorded_at IS 'Database clock at insert, assigned by trigger; cannot be supplied';
COMMENT ON COLUMN audit.audit_events.occurred_at IS 'When the audited action happened, per the writer, if different';
COMMENT ON COLUMN audit.audit_events.resource_id IS 'Identifier of the accessed resource (may identify a patient: restricted)';
COMMENT ON COLUMN audit.audit_events.detail IS 'Small non-PHI context object (max 8 KiB): no field values or record contents';

CREATE INDEX idx_audit_events_recorded_at ON audit.audit_events (recorded_at);
CREATE INDEX idx_audit_events_actor_id_recorded_at ON audit.audit_events (actor_id, recorded_at) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_events_resource ON audit.audit_events (resource_type, resource_id, recorded_at)
    WHERE resource_id IS NOT NULL;
CREATE INDEX idx_audit_events_correlation_id ON audit.audit_events (correlation_id) WHERE correlation_id IS NOT NULL;

-- Canonical content of a row: a JSON array with a fixed field order and UTC timestamps, so the hash does not depend
-- on session settings (TimeZone, DateStyle). Any change to this function invalidates existing hashes: never alter it,
-- add a versioned successor instead.
CREATE FUNCTION audit.audit_event_hash(e audit.audit_events) RETURNS bytea
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT sha256(convert_to(jsonb_build_array(
        e.seq,
        e.event_id,
        to_char(e.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        e.category, e.action, e.outcome,
        e.actor_type, e.actor_id, e.actor_role,
        e.organization_id, e.facility_id,
        e.resource_type, e.resource_id, e.purpose_of_use,
        e.channel, e.request_id, e.correlation_id, e.client_addr::text,
        e.detail,
        encode(e.prev_hash, 'hex')
    )::text, 'UTF8'))
$$;
COMMENT ON FUNCTION audit.audit_event_hash(audit.audit_events) IS 'Hash v1 of an audit row (content + prev_hash)';

-- Assigns seq, recorded_at, prev_hash and hash. Runs as the table owner so writers need INSERT only. Inserts are
-- serialized by a transaction-level advisory lock (constant key 7208431001 = audit chain) held until commit, and must
-- run in READ COMMITTED so the lookup of the previous row sees every committed predecessor.
CREATE FUNCTION audit.audit_events_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    last_seq  bigint;
    last_hash bytea;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'audit events must be written in READ COMMITTED transactions (current: %)',
            current_setting('transaction_isolation');
    END IF;
    PERFORM pg_advisory_xact_lock(7208431001);
    SELECT a.seq, a.hash INTO last_seq, last_hash FROM audit.audit_events a ORDER BY a.seq DESC LIMIT 1;
    NEW.seq := coalesce(last_seq, 0) + 1;
    NEW.prev_hash := coalesce(last_hash, decode(repeat('00', 32), 'hex'));
    NEW.recorded_at := clock_timestamp();
    NEW.hash := audit.audit_event_hash(NEW);
    RETURN NEW;
END
$$;

CREATE FUNCTION audit.audit_events_refuse_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'audit.audit_events is append-only (% refused)', TG_OP;
END
$$;

CREATE TRIGGER trg_audit_events_chain BEFORE INSERT ON audit.audit_events
    FOR EACH ROW EXECUTE FUNCTION audit.audit_events_chain();
CREATE TRIGGER trg_audit_events_no_update_delete BEFORE UPDATE OR DELETE ON audit.audit_events
    FOR EACH ROW EXECUTE FUNCTION audit.audit_events_refuse_change();
CREATE TRIGGER trg_audit_events_no_truncate BEFORE TRUNCATE ON audit.audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit.audit_events_refuse_change();

-- Verifies the chain between two positions. Returns the number of rows checked and, when the chain is broken, the
-- first invalid position and the reason. A clean result is (rows_checked, NULL, NULL).
CREATE FUNCTION audit.verify_chain(p_from_seq bigint DEFAULT 1, p_to_seq bigint DEFAULT NULL)
RETURNS TABLE (rows_checked bigint, first_invalid_seq bigint, problem text)
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    r              audit.audit_events;
    expected_seq   bigint := p_from_seq;
    expected_prev  bytea;
    n              bigint := 0;
BEGIN
    IF p_from_seq IS NULL OR p_from_seq < 1 THEN
        RAISE EXCEPTION 'p_from_seq must be >= 1';
    END IF;
    IF p_from_seq = 1 THEN
        expected_prev := decode(repeat('00', 32), 'hex');
    ELSE
        SELECT a.hash INTO expected_prev FROM audit.audit_events a WHERE a.seq = p_from_seq - 1;
        IF NOT FOUND THEN
            RETURN QUERY SELECT 0::bigint, p_from_seq - 1, 'anchor row missing';
            RETURN;
        END IF;
    END IF;

    FOR r IN
        SELECT * FROM audit.audit_events a
        WHERE a.seq >= p_from_seq AND (p_to_seq IS NULL OR a.seq <= p_to_seq)
        ORDER BY a.seq
    LOOP
        IF r.seq <> expected_seq THEN
            RETURN QUERY SELECT n, expected_seq, 'row missing (sequence gap)';
            RETURN;
        END IF;
        IF r.prev_hash <> expected_prev THEN
            RETURN QUERY SELECT n, r.seq, 'prev_hash does not match the preceding row';
            RETURN;
        END IF;
        IF r.hash <> audit.audit_event_hash(r) THEN
            RETURN QUERY SELECT n, r.seq, 'hash does not match row content';
            RETURN;
        END IF;
        n := n + 1;
        expected_prev := r.hash;
        expected_seq := r.seq + 1;
    END LOOP;
    RETURN QUERY SELECT n, NULL::bigint, NULL::text;
END
$$;
COMMENT ON FUNCTION audit.verify_chain(bigint, bigint) IS 'Checks seq continuity, prev_hash links and row hashes';

-- Writers may supply only the descriptive columns; seq, recorded_at and the hashes come from the trigger.
GRANT USAGE ON SCHEMA audit TO hms_audit_append, hms_audit_read;
GRANT INSERT (event_id, occurred_at, category, action, outcome, actor_type, actor_id, actor_role, organization_id,
              facility_id, resource_type, resource_id, purpose_of_use, channel, request_id, correlation_id,
              client_addr, detail)
    ON audit.audit_events TO hms_audit_append;
-- event_id only, for retries with ON CONFLICT (event_id) DO NOTHING; writers cannot read the trail itself.
GRANT SELECT (event_id) ON audit.audit_events TO hms_audit_append;
GRANT SELECT ON audit.audit_events TO hms_audit_read;
GRANT EXECUTE ON FUNCTION audit.verify_chain(bigint, bigint), audit.audit_event_hash(audit.audit_events)
    TO hms_audit_read;
