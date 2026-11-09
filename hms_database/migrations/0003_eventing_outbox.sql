-- 0003 eventing: transactional outbox and consumer receipts (schema eventing).
-- Owner: hms_database (definitions); writes: hms_services (producers insert in their business transaction; the relay
-- updates delivery state; consumers record receipts). Envelope fields follow standards/contracts/event-envelope.md.
-- Classification: confidential. Payloads carry identifiers and minimal facts, never full records (max 64 KiB).
-- Delivery is at-least-once: relays must tolerate duplicates and consumers must deduplicate via consumer_receipts.
-- id order is insertion order, not commit order; per-aggregate ordering uses aggregate_version.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA eventing;
COMMENT ON SCHEMA eventing IS 'hms_database: transactional outbox and idempotent consumer receipts';

CREATE TABLE eventing.outbox_events (
    id                 bigint      GENERATED ALWAYS AS IDENTITY,
    event_id           uuid        NOT NULL DEFAULT uuidv7(),
    event_type         text        NOT NULL,
    event_version      integer     NOT NULL,
    source             text        NOT NULL,
    tenant_id          uuid,
    aggregate_type     text        NOT NULL,
    aggregate_id       text        NOT NULL,
    aggregate_version  bigint,
    correlation_id     uuid,
    causation_id       uuid,
    actor_type         text,
    actor_id           text,
    classification     text        NOT NULL,
    occurred_at        timestamptz,
    recorded_at        timestamptz NOT NULL DEFAULT now(),
    payload            jsonb       NOT NULL,
    published_at       timestamptz,
    dead_lettered_at   timestamptz,
    attempt_count      integer     NOT NULL DEFAULT 0,
    next_attempt_at    timestamptz NOT NULL DEFAULT now(),
    last_error         text,
    CONSTRAINT pk_outbox_events PRIMARY KEY (id),
    CONSTRAINT uq_outbox_events_event_id UNIQUE (event_id),
    CONSTRAINT ck_outbox_events_event_type CHECK (event_type ~ '^[A-Za-z][A-Za-z0-9_.-]{0,127}$'),
    CONSTRAINT ck_outbox_events_event_version CHECK (event_version >= 1),
    CONSTRAINT ck_outbox_events_source CHECK (source ~ '^[a-z][a-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_outbox_events_aggregate_type CHECK (aggregate_type ~ '^[A-Za-z][A-Za-z0-9_.-]{0,63}$'),
    CONSTRAINT ck_outbox_events_aggregate_id CHECK (length(aggregate_id) BETWEEN 1 AND 128),
    CONSTRAINT ck_outbox_events_aggregate_version CHECK (aggregate_version >= 0),
    CONSTRAINT ck_outbox_events_actor_type CHECK (actor_type IN ('user', 'service', 'system')),
    CONSTRAINT ck_outbox_events_actor_id CHECK (length(actor_id) <= 128),
    CONSTRAINT ck_outbox_events_classification CHECK (classification IN ('internal', 'confidential', 'restricted')),
    CONSTRAINT ck_outbox_events_payload CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 65536),
    CONSTRAINT ck_outbox_events_attempt_count CHECK (attempt_count >= 0),
    CONSTRAINT ck_outbox_events_last_error CHECK (length(last_error) <= 2000),
    CONSTRAINT ck_outbox_events_terminal CHECK (published_at IS NULL OR dead_lettered_at IS NULL)
);
COMMENT ON TABLE eventing.outbox_events IS
    'Transactional outbox: written in the producing transaction, published at least once by the relay';
COMMENT ON COLUMN eventing.outbox_events.event_type IS 'e.g. clinical.EncounterStarted; Legacy...Observed for polled changes';
COMMENT ON COLUMN eventing.outbox_events.tenant_id IS 'platform.organizations.id of the owning tenant (no FK: retention independent)';
COMMENT ON COLUMN eventing.outbox_events.occurred_at IS 'Evidence-backed business time only; never the polling time';
COMMENT ON COLUMN eventing.outbox_events.recorded_at IS 'Producing transaction time';
COMMENT ON COLUMN eventing.outbox_events.payload IS 'Minimal event data (identifiers, changed facts); no full charts';

-- Relay work queue: SELECT ... WHERE published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= now()
-- ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT n.
CREATE INDEX idx_outbox_events_pending ON eventing.outbox_events (next_attempt_at, id)
    WHERE published_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX idx_outbox_events_aggregate ON eventing.outbox_events (aggregate_type, aggregate_id, id);
CREATE INDEX idx_outbox_events_published_at ON eventing.outbox_events (published_at) WHERE published_at IS NOT NULL;

-- Undelivered events are never deleted: only published or dead-lettered rows may be purged by retention.
CREATE FUNCTION eventing.outbox_events_guard_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.published_at IS NULL AND OLD.dead_lettered_at IS NULL THEN
        RAISE EXCEPTION 'outbox event % is not delivered yet and cannot be deleted', OLD.event_id;
    END IF;
    RETURN OLD;
END
$$;
CREATE TRIGGER trg_outbox_events_guard_delete BEFORE DELETE ON eventing.outbox_events
    FOR EACH ROW EXECUTE FUNCTION eventing.outbox_events_guard_delete();

-- Idempotent consumers: INSERT ... ON CONFLICT DO NOTHING in the same transaction as the consumer's effect; zero rows
-- inserted means the event was already processed.
CREATE TABLE eventing.consumer_receipts (
    consumer_name  text        NOT NULL,
    event_id       uuid        NOT NULL,
    event_type     text        NOT NULL,
    processed_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_consumer_receipts PRIMARY KEY (consumer_name, event_id),
    CONSTRAINT ck_consumer_receipts_consumer_name CHECK (consumer_name ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    CONSTRAINT ck_consumer_receipts_event_type CHECK (event_type ~ '^[A-Za-z][A-Za-z0-9_.-]{0,127}$')
);
COMMENT ON TABLE eventing.consumer_receipts IS 'Events already processed per consumer (deduplication for at-least-once delivery)';
CREATE INDEX idx_consumer_receipts_processed_at ON eventing.consumer_receipts (processed_at);

-- Producers and the relay share one runtime: envelope columns are insert-only, delivery columns are updatable.
GRANT USAGE ON SCHEMA eventing TO hms_eventing_rw;
GRANT SELECT, INSERT, DELETE ON eventing.outbox_events TO hms_eventing_rw;
GRANT UPDATE (published_at, dead_lettered_at, attempt_count, next_attempt_at, last_error)
    ON eventing.outbox_events TO hms_eventing_rw;
GRANT SELECT, INSERT, DELETE ON eventing.consumer_receipts TO hms_eventing_rw;
