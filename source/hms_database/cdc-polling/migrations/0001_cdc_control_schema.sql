-- 0001_cdc_control_schema.sql
-- Control tables for the cdc-polling service (source/hms_services/cdc-polling/).
-- Target: PostgreSQL 18 (ADR-0004, proposed). Never run against Khanza.
-- Online-safe: yes (new schemas and tables only).
-- Rollback: DROP SCHEMA cdc CASCADE; DROP SCHEMA khanza_mirror CASCADE;  (drops all mirrored data)

BEGIN;

CREATE SCHEMA IF NOT EXISTS cdc;
COMMENT ON SCHEMA cdc IS 'cdc-polling control data: checkpoints, row hashes, change events. Contains PHI keys.';

CREATE SCHEMA IF NOT EXISTS khanza_mirror;
COMMENT ON SCHEMA khanza_mirror IS 'Read-side mirror of allowlisted Khanza tables, written only by cdc-polling. Contains PHI.';

-- One row per mirrored table.
CREATE TABLE cdc.table_state (
    table_name           text        PRIMARY KEY,
    mapping_fingerprint  text        NOT NULL,
    key_strategy         text        NOT NULL CHECK (key_strategy IN ('keyset', 'int_range')),
    pass_no              bigint      NOT NULL DEFAULT 0,
    bootstrapped_at      timestamptz,
    last_pass_started_at timestamptz,
    last_pass_finished_at timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE cdc.table_state IS 'Per-table state; mapping_fingerprint guards against silent mapping changes.';

-- Decision 1 + 3: fixed-size primary-key ranges, each with its own independent checkpoint.
-- lower_key is inclusive, upper_key exclusive; NULL means unbounded. Key values are JSON arrays
-- in key-column order, compared only on the MariaDB side (its collation), never here.
CREATE TABLE cdc.range_checkpoint (
    range_id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name       text        NOT NULL REFERENCES cdc.table_state (table_name) ON DELETE CASCADE,
    lower_key        jsonb,
    upper_key        jsonb,
    row_count        bigint,
    digest           text,                -- 16 hex digits: XOR of md5 prefixes; NULL = never scanned
    unchanged_streak integer     NOT NULL DEFAULT 0,
    last_scanned_at  timestamptz,
    last_changed_at  timestamptz,
    next_due_at      timestamptz NOT NULL DEFAULT now(),
    last_pass_no     bigint      NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE cdc.range_checkpoint IS 'One checkpoint per primary-key range (lower inclusive, upper exclusive). Bounds are PHI keys.';
COMMENT ON COLUMN cdc.range_checkpoint.lower_key IS 'PHI: may contain no_rawat / no_rkm_medis values.';
COMMENT ON COLUMN cdc.range_checkpoint.upper_key IS 'PHI: may contain no_rawat / no_rkm_medis values.';
CREATE INDEX range_checkpoint_due_idx ON cdc.range_checkpoint (table_name, next_due_at);

-- Last seen source row hash per key. range_id ties the key to its range so the diff never depends
-- on PostgreSQL ordering of source keys.
CREATE TABLE cdc.row_state (
    table_name  text        NOT NULL,
    pk_key      text        NOT NULL,     -- canonical JSON array of key values
    range_id    bigint      NOT NULL REFERENCES cdc.range_checkpoint (range_id),
    row_hash    char(32)    NOT NULL,     -- MD5 computed by MariaDB, stored opaquely
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (table_name, pk_key)
);
COMMENT ON TABLE cdc.row_state IS 'Source row hash per key, as last applied to the mirror.';
COMMENT ON COLUMN cdc.row_state.pk_key IS 'PHI: source primary key values.';
CREATE INDEX row_state_range_idx ON cdc.row_state (range_id);

-- Detected changes. Acts as the outbox that event-streaming relays to khanza.<table> topics.
CREATE TABLE cdc.change_event (
    event_seq    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id     uuid        NOT NULL UNIQUE,   -- deterministic, for consumer dedupe
    table_name   text        NOT NULL,
    op           char(1)     NOT NULL CHECK (op IN ('c', 'u', 'd', 'r')),
    pk           jsonb       NOT NULL,
    before_hash  char(32),
    after_hash   char(32),
    range_id     bigint      NOT NULL,
    pass_no      bigint      NOT NULL,
    captured_at  timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);
COMMENT ON TABLE cdc.change_event IS 'Change events (c=insert, u=update, d=delete, r=snapshot read). No payload: read the mirror.';
COMMENT ON COLUMN cdc.change_event.pk IS 'PHI: source primary key values.';
CREATE INDEX change_event_unpublished_idx ON cdc.change_event (event_seq) WHERE published_at IS NULL;
CREATE INDEX change_event_table_idx ON cdc.change_event (table_name, captured_at);

-- Metrics per pass (no PHI).
CREATE TABLE cdc.scan_run (
    run_id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name      text        NOT NULL,
    pass_no         bigint      NOT NULL,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    ranges_scanned  integer     NOT NULL DEFAULT 0,
    ranges_changed  integer     NOT NULL DEFAULT 0,
    ranges_split    integer     NOT NULL DEFAULT 0,
    rows_read       bigint      NOT NULL DEFAULT 0,
    inserts         integer     NOT NULL DEFAULT 0,
    updates         integer     NOT NULL DEFAULT 0,
    deletes         integer     NOT NULL DEFAULT 0,
    error           text
);
COMMENT ON TABLE cdc.scan_run IS 'Per-pass metrics for monitoring. Never contains keys or values.';

COMMIT;
