-- integration polling state: checkpoints, leases, runs (migration 0004). Rolled back.
BEGIN;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    v   record;
BEGIN
    -- Checkpoint with optimistic concurrency.
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO integration.poll_checkpoints (stream_name, source_system, updated_at)
        VALUES ('test.registrations', 'legacy-hms', '2020-01-01')
    $q$);
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        UPDATE integration.poll_checkpoints
        SET cursor_value = '["2026-01-01T00:00:00", "TEST-0001"]', cursor_version = cursor_version + 1,
            last_batch_count = 1, last_success_at = now()
        WHERE stream_name = 'test.registrations' AND cursor_version = 0
    $q$) = 1, 'checkpoint advances from the expected version');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        UPDATE integration.poll_checkpoints SET cursor_value = '["stale"]', cursor_version = cursor_version + 1
        WHERE stream_name = 'test.registrations' AND cursor_version = 0
    $q$) = 0, 'a stale writer updates nothing');
    PERFORM pg_temp.ok((SELECT updated_at = now() FROM integration.poll_checkpoints WHERE stream_name = 'test.registrations'),
                          'updated_at is maintained by trigger');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE integration.poll_checkpoints SET cursor_value = '"scalar"'$q$, '23514',
                                 'cursor must be an array or object');

    -- Lease acquisition and takeover with fencing.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO integration.poll_leases (stream_name, holder, fence, expires_at)
        VALUES ('test.registrations', 'poller-a', 1, now() + interval '30 seconds')
        ON CONFLICT (stream_name) DO UPDATE
        SET holder = EXCLUDED.holder, fence = poll_leases.fence + 1, acquired_at = now(), expires_at = EXCLUDED.expires_at
        WHERE poll_leases.expires_at < now() OR poll_leases.holder = EXCLUDED.holder
    $q$) = 1, 'poller-a acquires the lease');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO integration.poll_leases (stream_name, holder, fence, expires_at)
        VALUES ('test.registrations', 'poller-b', 1, now() + interval '30 seconds')
        ON CONFLICT (stream_name) DO UPDATE
        SET holder = EXCLUDED.holder, fence = poll_leases.fence + 1, acquired_at = now(), expires_at = EXCLUDED.expires_at
        WHERE poll_leases.expires_at < now() OR poll_leases.holder = EXCLUDED.holder
    $q$) = 0, 'poller-b cannot take an active lease');
    UPDATE integration.poll_leases SET acquired_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
    WHERE stream_name = 'test.registrations';
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO integration.poll_leases (stream_name, holder, fence, expires_at)
        VALUES ('test.registrations', 'poller-b', 1, now() + interval '30 seconds')
        ON CONFLICT (stream_name) DO UPDATE
        SET holder = EXCLUDED.holder, fence = poll_leases.fence + 1, acquired_at = now(), expires_at = EXCLUDED.expires_at
        WHERE poll_leases.expires_at < now() OR poll_leases.holder = EXCLUDED.holder
    $q$);
    SELECT holder, fence INTO v FROM integration.poll_leases WHERE stream_name = 'test.registrations';
    PERFORM pg_temp.ok(v.holder = 'poller-b' AND v.fence = 2, 'expired lease is taken over with a higher fence');

    -- Run lifecycle.
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO integration.sync_runs (run_id, stream_name, lease_fence)
        VALUES ('00000000-0000-7000-8000-0000000000b1', 'test.registrations', 2)
    $q$);
    PERFORM pg_temp.expect_error(rt, $q$UPDATE integration.sync_runs SET status = 'succeeded'
                                       WHERE run_id = '00000000-0000-7000-8000-0000000000b1'$q$,
                                 '23514', 'a finished run needs finished_at');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE integration.sync_runs SET status = 'succeeded', finished_at = now(),
                                       error_code = 'timeout' WHERE run_id = '00000000-0000-7000-8000-0000000000b1'$q$,
                                 '23514', 'a successful run has no error code');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        UPDATE integration.sync_runs SET status = 'succeeded', finished_at = now(), rows_observed = 1
        WHERE run_id = '00000000-0000-7000-8000-0000000000b1'
    $q$) = 1, 'run completes');
END
$$;

ROLLBACK;
