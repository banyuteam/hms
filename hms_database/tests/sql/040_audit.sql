-- audit.audit_events: append-only, hash chain, writer column restrictions (migration 0002). Rolled back.
BEGIN;

DO $$
DECLARE
    rt      text := pg_temp.r('runtime');
    base    bigint := coalesce((SELECT max(seq) FROM audit.audit_events), 0);
    v       record;
BEGIN
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO audit.audit_events (event_id, category, action, outcome, actor_type, actor_id, actor_role,
                                        resource_type, resource_id, channel, request_id, client_addr, detail)
        VALUES ('00000000-0000-7000-8000-0000000000a1', 'data_access', 'patient.read', 'success', 'user', 'test-user-1',
                'physician', 'Patient', 'test-patient-1', 'web', 'req-1', '10.0.0.1', '{"route": "/patients/{id}"}')
    $q$) = 1, 'runtime appends one audit event');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO audit.audit_events (category, action, outcome, actor_type, actor_id)
        VALUES ('authentication', 'session.sign_in', 'failure', 'user', 'test-user-2'),
               ('authorization', 'patient.read', 'denied', 'user', 'test-user-2')
    $q$) = 2, 'runtime appends two events in one statement');

    -- Idempotent retry of the same event.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO audit.audit_events (event_id, category, action, outcome, actor_type)
        VALUES ('00000000-0000-7000-8000-0000000000a1', 'data_access', 'patient.read', 'success', 'user')
        ON CONFLICT (event_id) DO NOTHING
    $q$) = 0, 'retried event_id is ignored');

    -- The trigger owns seq, recorded_at and the hashes, even for a superuser.
    INSERT INTO audit.audit_events (seq, recorded_at, prev_hash, hash, category, action, outcome, actor_type)
    VALUES (999999, '2000-01-01', '\x01', '\x02', 'system', 'test.forged', 'success', 'system');
    SELECT * INTO v FROM audit.audit_events WHERE action = 'test.forged';
    PERFORM pg_temp.ok(v.seq = base + 4 AND v.recorded_at > '2020-01-01' AND octet_length(v.hash) = 32,
                          'supplied seq/recorded_at/hash are overwritten by the chain trigger');

    PERFORM pg_temp.ok((SELECT array_agg(seq ORDER BY seq) FROM audit.audit_events WHERE seq > base)
                          = ARRAY[base + 1, base + 2, base + 3, base + 4], 'seq is contiguous');
    PERFORM pg_temp.ok((SELECT count(*) FROM audit.verify_chain() WHERE first_invalid_seq IS NULL AND rows_checked = base + 4) = 1,
                          'chain verifies from the start');
    PERFORM pg_temp.ok(pg_temp.exec_as(pg_temp.r('auditor'), 'SELECT * FROM audit.verify_chain()') = 1,
                          'auditor can run verify_chain');

    -- Writer restrictions.
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO audit.audit_events (seq, category, action, outcome, actor_type)
                                       VALUES (1, 'system', 'test.x', 'success', 'system')$q$, '42501', 'runtime cannot supply seq');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO audit.audit_events (recorded_at, category, action, outcome, actor_type)
                                       VALUES ('2000-01-01', 'system', 'test.x', 'success', 'system')$q$, '42501',
                                 'runtime cannot backdate recorded_at');
    PERFORM pg_temp.expect_error(rt, 'SELECT * FROM audit.audit_events', '42501', 'runtime cannot read audit events');
    PERFORM pg_temp.expect_error(rt, 'SELECT resource_id FROM audit.audit_events', '42501', 'runtime cannot read audit content');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO audit.audit_events (category, action, outcome, actor_type)
                                       VALUES ('gossip', 'test.x', 'success', 'system')$q$, '23514', 'category is constrained');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO audit.audit_events (category, action, outcome, actor_type, detail)
                                       VALUES ('system', 'test.x', 'success', 'system',
                                               jsonb_build_object('blob', repeat('x', 9000)))$q$, '23514', 'detail is size-limited');

    -- Append-only for everyone, including the superuser.
    PERFORM pg_temp.expect_error(current_user, $q$UPDATE audit.audit_events SET outcome = 'success' WHERE seq = $q$ || (base + 2),
                                 'P0001', 'UPDATE is refused');
    PERFORM pg_temp.expect_error(current_user, $q$DELETE FROM audit.audit_events WHERE seq = $q$ || (base + 2), 'P0001', 'DELETE is refused');
    PERFORM pg_temp.expect_error(current_user, 'TRUNCATE audit.audit_events', 'P0001', 'TRUNCATE is refused');
END
$$;

-- Tamper detection: bypass the guard trigger as a superuser would, then verify.
SAVEPOINT tamper_edit;
ALTER TABLE audit.audit_events DISABLE TRIGGER trg_audit_events_no_update_delete;
UPDATE audit.audit_events SET outcome = 'success' WHERE action = 'patient.read' AND outcome = 'denied';
DO $$
DECLARE v record;
BEGIN
    SELECT * INTO v FROM audit.verify_chain();
    PERFORM pg_temp.ok(v.first_invalid_seq = (SELECT seq FROM audit.audit_events WHERE action = 'patient.read' AND actor_id = 'test-user-2')
                          AND v.problem = 'hash does not match row content', 'an edited row is detected');
END
$$;
ROLLBACK TO SAVEPOINT tamper_edit;

SAVEPOINT tamper_delete;
ALTER TABLE audit.audit_events DISABLE TRIGGER trg_audit_events_no_update_delete;
DELETE FROM audit.audit_events WHERE action = 'session.sign_in' AND actor_id = 'test-user-2';
DO $$
DECLARE v record;
BEGIN
    SELECT * INTO v FROM audit.verify_chain();
    PERFORM pg_temp.ok(v.problem = 'row missing (sequence gap)', 'a removed row is detected');
END
$$;
ROLLBACK TO SAVEPOINT tamper_delete;

ROLLBACK;

-- Writes outside READ COMMITTED are refused (the chain lookup needs a fresh snapshot).
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$
BEGIN
    PERFORM pg_temp.expect_error(pg_temp.r('runtime'), $q$INSERT INTO audit.audit_events (category, action, outcome, actor_type)
                                                        VALUES ('system', 'test.x', 'success', 'system')$q$,
                                 'P0001', 'REPEATABLE READ audit insert is refused');
END
$$;
ROLLBACK;
