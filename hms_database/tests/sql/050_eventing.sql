-- eventing.outbox_events and eventing.consumer_receipts (migration 0003). Rolled back.
BEGIN;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
BEGIN
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO eventing.outbox_events (event_id, event_type, event_version, source, aggregate_type, aggregate_id,
                                            aggregate_version, classification, payload)
        VALUES ('00000000-0000-7000-8000-0000000000e1', 'platform.FacilityRegistered', 1, 'hms-services.platform',
                'Facility', 'test-facility-1', 1, 'internal', '{"facility_code": "TEST-FAC"}'),
               ('00000000-0000-7000-8000-0000000000e2', 'platform.FacilityRenamed', 1, 'hms-services.platform',
                'Facility', 'test-facility-1', 2, 'internal', '{"facility_code": "TEST-FAC"}')
    $q$) = 2, 'runtime writes outbox events');

    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO eventing.outbox_events (event_id, event_type, event_version, source,
                                         aggregate_type, aggregate_id, classification, payload)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', 'x.Y', 1, 'test', 'X', '1', 'internal', '{}')$q$,
                                 '23505', 'event_id is unique');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO eventing.outbox_events (event_type, event_version, source, aggregate_type,
                                         aggregate_id, classification, payload)
                                       VALUES ('x.Y', 1, 'test', 'X', '1', 'internal', '[1, 2]')$q$,
                                 '23514', 'payload must be an object');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO eventing.outbox_events (event_type, event_version, source, aggregate_type,
                                         aggregate_id, classification, payload)
                                       VALUES ('x.Y', 1, 'test', 'X', '1', 'internal', jsonb_build_object('blob', repeat('x', 70000)))$q$,
                                 '23514', 'payload is size-limited');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO eventing.outbox_events (event_type, event_version, source, aggregate_type,
                                         aggregate_id, classification, payload)
                                       VALUES ('x.Y', 1, 'test', 'X', '1', 'top-secret', '{}')$q$,
                                 '23514', 'classification is constrained');

    -- Relay: claim, then mark published. Envelope columns are not updatable.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        SELECT id FROM eventing.outbox_events
        WHERE published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= now()
        ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT 10
    $q$) >= 2, 'relay claims pending events with SKIP LOCKED');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        UPDATE eventing.outbox_events SET published_at = now(), attempt_count = attempt_count + 1
        WHERE event_id = '00000000-0000-7000-8000-0000000000e1'
    $q$) = 1, 'relay marks an event published');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE eventing.outbox_events SET payload = '{}'
                                       WHERE event_id = '00000000-0000-7000-8000-0000000000e2'$q$,
                                 '42501', 'payload is immutable for the runtime');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE eventing.outbox_events SET dead_lettered_at = now()
                                       WHERE event_id = '00000000-0000-7000-8000-0000000000e1'$q$,
                                 '23514', 'an event cannot be both published and dead-lettered');

    -- Retention may remove delivered events only.
    PERFORM pg_temp.expect_error(rt, $q$DELETE FROM eventing.outbox_events WHERE event_id = '00000000-0000-7000-8000-0000000000e2'$q$,
                                 'P0001', 'undelivered event cannot be deleted');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        DELETE FROM eventing.outbox_events WHERE event_id = '00000000-0000-7000-8000-0000000000e1'
    $q$) = 1, 'published event can be purged');

    -- Idempotent consumer.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO eventing.consumer_receipts (consumer_name, event_id, event_type)
        VALUES ('test.consumer', '00000000-0000-7000-8000-0000000000e2', 'platform.FacilityRenamed')
        ON CONFLICT DO NOTHING
    $q$) = 1, 'first delivery is recorded');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO eventing.consumer_receipts (consumer_name, event_id, event_type)
        VALUES ('test.consumer', '00000000-0000-7000-8000-0000000000e2', 'platform.FacilityRenamed')
        ON CONFLICT DO NOTHING
    $q$) = 0, 'duplicate delivery is detected');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE eventing.consumer_receipts SET processed_at = now()$q$, '42501',
                                 'receipts are not updatable');
END
$$;

ROLLBACK;
