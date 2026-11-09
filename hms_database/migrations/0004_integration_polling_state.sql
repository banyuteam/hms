-- 0004 integration: legacy read-polling state (schema integration).
-- Owner: hms_database (definitions); writes: hms_services legacy polling adapter. The legacy MySQL source is never
-- written: its cursors, leases and run history live here (standards/security/legacy-read-only-policy.md).
-- Classification: confidential (cursors may contain legacy business keys such as encounter numbers).
-- Poll time recorded here is observation time, not business-event time.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA integration;
COMMENT ON SCHEMA integration IS 'hms_database: external integration state (legacy polling checkpoints, leases, runs)';

-- One row per polled stream. Writers use optimistic concurrency:
--   UPDATE ... SET cursor_value = $new, cursor_version = cursor_version + 1 WHERE stream_name = $s AND cursor_version = $v
-- and treat zero updated rows as a lost race.
CREATE TABLE integration.poll_checkpoints (
    stream_name       text        NOT NULL,
    source_system     text        NOT NULL,
    cursor_value      jsonb,
    cursor_version    bigint      NOT NULL DEFAULT 0,
    last_batch_count  integer     NOT NULL DEFAULT 0,
    last_success_at   timestamptz,
    last_error_at     timestamptz,
    last_error_code   text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_poll_checkpoints PRIMARY KEY (stream_name),
    CONSTRAINT ck_poll_checkpoints_stream_name CHECK (stream_name ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    CONSTRAINT ck_poll_checkpoints_source_system CHECK (source_system ~ '^[a-z][a-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_poll_checkpoints_cursor_value CHECK (cursor_value IS NULL OR jsonb_typeof(cursor_value) IN ('array', 'object')),
    CONSTRAINT ck_poll_checkpoints_cursor_version CHECK (cursor_version >= 0),
    CONSTRAINT ck_poll_checkpoints_last_batch_count CHECK (last_batch_count >= 0),
    CONSTRAINT ck_poll_checkpoints_last_error_code CHECK (last_error_code ~ '^[a-z][a-z0-9_.-]{0,63}$')
);
COMMENT ON TABLE integration.poll_checkpoints IS 'Durable cursor per polled legacy stream; NULL cursor = not started';
COMMENT ON COLUMN integration.poll_checkpoints.last_error_code IS 'Error class only; no messages, SQL or row contents';

-- Single active poller per stream. Acquire or take over an expired lease with:
--   INSERT ... VALUES ($s, $holder, 1, now() + $ttl) ON CONFLICT (stream_name) DO UPDATE
--   SET holder = EXCLUDED.holder, fence = poll_leases.fence + 1, acquired_at = now(), expires_at = EXCLUDED.expires_at
--   WHERE poll_leases.expires_at < now() OR poll_leases.holder = EXCLUDED.holder
-- The fence increases on every acquisition; checkpoint writes compare it to reject a stale holder.
CREATE TABLE integration.poll_leases (
    stream_name  text        NOT NULL,
    holder       text        NOT NULL,
    fence        bigint      NOT NULL,
    acquired_at  timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    CONSTRAINT pk_poll_leases PRIMARY KEY (stream_name),
    CONSTRAINT ck_poll_leases_holder CHECK (length(holder) BETWEEN 1 AND 200),
    CONSTRAINT ck_poll_leases_fence CHECK (fence >= 1),
    CONSTRAINT ck_poll_leases_expiry CHECK (expires_at > acquired_at)
);
COMMENT ON TABLE integration.poll_leases IS 'Lease with fencing token so one poller instance owns a stream at a time';

CREATE TABLE integration.sync_runs (
    id             bigint      GENERATED ALWAYS AS IDENTITY,
    run_id         uuid        NOT NULL DEFAULT uuidv7(),
    stream_name    text        NOT NULL,
    lease_fence    bigint,
    status         text        NOT NULL DEFAULT 'running',
    started_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz,
    rows_observed  integer     NOT NULL DEFAULT 0,
    error_code     text,
    CONSTRAINT pk_sync_runs PRIMARY KEY (id),
    CONSTRAINT uq_sync_runs_run_id UNIQUE (run_id),
    CONSTRAINT ck_sync_runs_stream_name CHECK (stream_name ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    CONSTRAINT ck_sync_runs_status CHECK (status IN ('running', 'succeeded', 'failed', 'abandoned')),
    CONSTRAINT ck_sync_runs_finished CHECK ((status = 'running') = (finished_at IS NULL)),
    CONSTRAINT ck_sync_runs_time_order CHECK (finished_at IS NULL OR finished_at >= started_at),
    CONSTRAINT ck_sync_runs_rows_observed CHECK (rows_observed >= 0),
    CONSTRAINT ck_sync_runs_error_code CHECK (error_code ~ '^[a-z][a-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_sync_runs_error_status CHECK (error_code IS NULL OR status IN ('failed', 'abandoned'))
);
COMMENT ON TABLE integration.sync_runs IS 'History of polling runs per stream (counts and outcome, no row contents)';
CREATE INDEX idx_sync_runs_stream_name_started_at ON integration.sync_runs (stream_name, started_at);
CREATE INDEX idx_sync_runs_running ON integration.sync_runs (stream_name) WHERE status = 'running';

CREATE TRIGGER trg_poll_checkpoints_touch_updated_at BEFORE UPDATE ON integration.poll_checkpoints
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();

GRANT USAGE ON SCHEMA integration TO hms_integration_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON integration.poll_checkpoints, integration.poll_leases, integration.sync_runs
    TO hms_integration_rw;
