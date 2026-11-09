-- assistant: evaluation receipts, feedback, comments, interaction events, monthly counts and the aggregate views
-- (migration 0006, ADR-SVC-008). Synthetic data; rolled back. Fixed ids: organization ...0a, facilities ...a1/a2,
-- users ...c1 and ...c2 (same organization), evaluations ...e1 (user c1) and ...e2 (user c2).
BEGIN;

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    rp  text := pg_temp.r('reporting');
    au  text := pg_temp.r('auditor');
BEGIN
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO platform.organizations (id, code, name) VALUES
            ('00000000-0000-7000-8000-00000000000a', 'TEST-ORG-A', 'Test Organization A')
    $q$);
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO platform.facilities (id, organization_id, code, name, timezone) VALUES
            ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-00000000000a', 'A1', 'Facility A1', 'Asia/Jakarta'),
            ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-00000000000a', 'A2', 'Facility A2', 'Asia/Jakarta')
    $q$);
    PERFORM pg_temp.exec_as(rt, $q$
        INSERT INTO iam.users (id, organization_id, display_name) VALUES
            ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-00000000000a', 'Test User One'),
            ('00000000-0000-7000-8000-0000000000c2', '00000000-0000-7000-8000-00000000000a', 'Test User Two')
    $q$);

    -- Receipts and their rule results (L-1).
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.evaluation_receipts (evaluation_id, organization_id, facility_id, user_id, rule_set_id,
                                                   rule_set_version, evaluated_at) VALUES
            ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-00000000000a',
             '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1', 'claim-readiness', 3, now()),
            ('00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-00000000000a',
             '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c2', 'claim-readiness', 3, now())
    $q$) = 2, 'runtime writes receipts');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.evaluation_receipt_results (evaluation_id, rule_id, result) VALUES
            ('00000000-0000-7000-8000-0000000000e1', 'primary_diagnosis_coded', 'passed'),
            ('00000000-0000-7000-8000-0000000000e1', 'discharge_summary_present', 'failed'),
            ('00000000-0000-7000-8000-0000000000e2', 'primary_diagnosis_coded', 'failed')
    $q$) = 3, 'runtime writes receipt results');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.evaluation_receipt_results VALUES
                                       ('00000000-0000-7000-8000-0000000000e1', 'primary_diagnosis_coded', 'failed')$q$,
                                 '23505', 'one result per rule and evaluation');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.evaluation_receipt_results VALUES
                                       ('00000000-0000-7000-8000-0000000000e1', 'sep_present', 'approved')$q$,
                                 '23514', 'result is one of the contract values');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.evaluation_receipts (evaluation_id, organization_id,
                                         facility_id, user_id, rule_set_id, rule_set_version, evaluated_at)
                                       VALUES (uuidv7(), '00000000-0000-7000-8000-00000000000a',
                                               '00000000-0000-7000-8000-0000000000a1', uuidv7(), 'claim-readiness', 3, now())$q$,
                                 '23503', 'receipt user must exist in the organization');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.evaluation_receipts SET rule_set_version = 9$q$, '42501',
                                 'receipts are append-only');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.evaluation_receipt_results SET result = 'passed'$q$, '42501',
                                 'receipt results are append-only');

    -- Finding feedback: own evaluation, a rule in it, the result it had.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.feedback (id, evaluation_id, user_id, target, rule_id, result_seen, reason) VALUES
            ('00000000-0000-7000-8000-0000000000f1', '00000000-0000-7000-8000-0000000000e1',
             '00000000-0000-7000-8000-0000000000c1', 'finding', 'discharge_summary_present', 'failed', 'result_wrong')
    $q$) = 1, 'finding feedback on the user''s own evaluation');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen, reason)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000c2',
                                               'finding', 'discharge_summary_present', 'failed', 'unclear')$q$,
                                 '23503', 'feedback on another user''s evaluation is refused');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen, reason)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000c1',
                                               'finding', 'sep_present', 'failed', 'unclear')$q$,
                                 '23503', 'feedback on a rule that was not evaluated is refused');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen, reason)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000c1',
                                               'finding', 'primary_diagnosis_coded', 'failed', 'unclear')$q$,
                                 '23503', 'feedback must name the result the evaluation had');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen, reason)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000c1',
                                               'finding', 'primary_diagnosis_coded', 'passed', 'looks_bad')$q$,
                                 '23514', 'reason is one of the four owner-approved reasons');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen,
                                         reason, helpfulness)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000c1',
                                               'finding', 'primary_diagnosis_coded', 'passed', 'unclear', 'helpful')$q$,
                                 '23514', 'a finding item carries no helpfulness');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen, reason)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000c1',
                                               'finding', 'discharge_summary_present', 'failed', 'unclear')$q$,
                                 '23505', 'one current item per user, evaluation and finding');

    -- Answer feedback.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.feedback (evaluation_id, user_id, target, helpfulness, expected) VALUES
            ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000c1', 'answer', 'not_helpful',
             'actionable_steps')
    $q$) = 1, 'answer feedback with an expected category');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, helpfulness, expected)
                                       VALUES ('00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-0000000000c2',
                                               'answer', 'helpful', 'more_specific')$q$,
                                 '23514', 'a helpful answer has no expected category');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, helpfulness)
                                       VALUES ('00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-0000000000c2',
                                               'answer', 'primary_diagnosis_coded', 'helpful')$q$,
                                 '23514', 'an answer item names no rule');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, helpfulness)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000c1',
                                               'answer', 'helpful')$q$,
                                 '23505', 'one current answer item per user and evaluation');

    -- A changed item is a new version; the old one is superseded once and is otherwise immutable.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        UPDATE assistant.feedback SET superseded_at = now() WHERE id = '00000000-0000-7000-8000-0000000000f1'
    $q$) = 1, 'a version is superseded');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.feedback (id, evaluation_id, user_id, target, rule_id, result_seen, reason, version) VALUES
            ('00000000-0000-7000-8000-0000000000f2', '00000000-0000-7000-8000-0000000000e1',
             '00000000-0000-7000-8000-0000000000c1', 'finding', 'discharge_summary_present', 'failed', 'data_outdated', 2)
    $q$) = 1, 'the new version becomes current');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.feedback SET superseded_at = now()
                                       WHERE id = '00000000-0000-7000-8000-0000000000f1'$q$,
                                 'P0001', 'a superseded version stays superseded');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.feedback SET superseded_at = NULL
                                       WHERE id = '00000000-0000-7000-8000-0000000000f2'$q$,
                                 'P0001', 'superseding is the only change');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.feedback SET reason = 'unclear'
                                       WHERE id = '00000000-0000-7000-8000-0000000000f2'$q$,
                                 '42501', 'feedback content is immutable');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen,
                                         reason, version)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000c1',
                                               'finding', 'discharge_summary_present', 'failed', 'unclear', 1)$q$,
                                 '23505', 'version numbers are unique per item');

    -- Comments (L-3): bounded, restricted, removed with their feedback.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.feedback_comments (feedback_id, body)
        VALUES ('00000000-0000-7000-8000-0000000000f2', 'Synthetic test comment: summary was added later.')
    $q$) = 1, 'a feedback version may carry a comment');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback_comments (feedback_id, body)
                                       VALUES ('00000000-0000-7000-8000-0000000000f1', repeat('x', 201))$q$,
                                 '23514', 'comments are at most 200 characters');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.feedback_comments (feedback_id, body)
                                       VALUES ('00000000-0000-7000-8000-0000000000f1', '   ')$q$,
                                 '23514', 'a comment is not blank');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.feedback_comments SET body = 'changed'$q$, '42501',
                                 'comments are not editable');

    -- Retention: a receipt with feedback cannot be purged; one without can, and its results go with it.
    PERFORM pg_temp.expect_error(rt, $q$DELETE FROM assistant.evaluation_receipts
                                       WHERE evaluation_id = '00000000-0000-7000-8000-0000000000e1'$q$,
                                 '23503', 'a receipt referenced by feedback is kept');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        DELETE FROM assistant.evaluation_receipts WHERE evaluation_id = '00000000-0000-7000-8000-0000000000e2'
    $q$) = 1, 'an unreferenced receipt is purged');
    PERFORM pg_temp.ok((SELECT count(*) FROM assistant.evaluation_receipt_results
                        WHERE evaluation_id = '00000000-0000-7000-8000-0000000000e2') = 0,
                       'its rule results are removed with it');

    -- Interaction events (L-10).
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.interaction_events (user_id, event_id, organization_id, facility_id, panel_session,
                                                  schema_version, event_type, topic, input, fallback_kind, client_at) VALUES
            ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-000000000101',
             '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
             '00000000-0000-7000-8000-000000000201', 1, 'topic_selected', 'claim', 'button', NULL, now()),
            ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-000000000102',
             '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
             '00000000-0000-7000-8000-000000000201', 1, 'fallback_shown', NULL, NULL, 'choose_visit', now())
        ON CONFLICT DO NOTHING
    $q$) = 2, 'runtime records interaction events');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.interaction_events (user_id, event_id, organization_id, facility_id, panel_session,
                                                  schema_version, event_type, topic, input, client_at)
        VALUES ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-000000000101',
                '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
                '00000000-0000-7000-8000-000000000201', 1, 'topic_selected', 'labs', 'typed', now())
        ON CONFLICT DO NOTHING
    $q$) = 0, 'a repeated event id is ignored');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.interaction_events (user_id, event_id, organization_id, facility_id, panel_session,
                                                  schema_version, event_type, topic, input, client_at)
        VALUES ('00000000-0000-7000-8000-0000000000c2', '00000000-0000-7000-8000-000000000101',
                '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
                '00000000-0000-7000-8000-000000000202', 1, 'topic_selected', 'labs', 'typed', now())
        ON CONFLICT DO NOTHING
    $q$) = 1, 'another user''s event with the same id is not suppressed');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.interaction_events (user_id, event_id, organization_id,
                                         facility_id, panel_session, schema_version, event_type, topic, input, fallback_kind, client_at)
                                       VALUES ('00000000-0000-7000-8000-0000000000c1', uuidv7(), '00000000-0000-7000-8000-00000000000a',
                                               '00000000-0000-7000-8000-0000000000a1', uuidv7(), 1, 'topic_selected', 'claim',
                                               'button', 'help', now())$q$,
                                 '23514', 'a topic event carries no fallback kind');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.interaction_events (user_id, event_id, organization_id,
                                         facility_id, panel_session, schema_version, event_type, topic, input, client_at)
                                       VALUES ('00000000-0000-7000-8000-0000000000c1', uuidv7(), '00000000-0000-7000-8000-00000000000a',
                                               '00000000-0000-7000-8000-0000000000a1', uuidv7(), 2, 'topic_selected', 'claim',
                                               'button', now())$q$,
                                 '23514', 'unknown event schema versions are refused');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.interaction_events (user_id, event_id, organization_id,
                                         facility_id, panel_session, schema_version, event_type, topic, input, client_at)
                                       VALUES ('00000000-0000-7000-8000-0000000000c1', uuidv7(), '00000000-0000-7000-8000-00000000000a',
                                               '00000000-0000-7000-8000-0000000000a1', uuidv7(), 1, 'page_viewed', NULL, NULL, now())$q$,
                                 '23514', 'only approved event types');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.interaction_events SET topic = 'labs'$q$, '42501',
                                 'events are not editable');

    -- Monthly counts: upsert by key, first day of the month only.
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.monthly_counts (month, organization_id, facility_id, metric, rule_set_id, rule_set_version, total)
        VALUES ('2026-11-01', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
                'evaluations', 'claim-readiness', 3, 4)
        ON CONFLICT (month, organization_id, facility_id, metric, rule_set_id, rule_set_version, topic, input, fallback_kind)
        DO UPDATE SET total = assistant.monthly_counts.total + EXCLUDED.total
    $q$) = 1, 'monthly evaluation count is recorded');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.monthly_counts (month, organization_id, facility_id, metric, rule_set_id, rule_set_version, total)
        VALUES ('2026-11-01', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
                'evaluations', 'claim-readiness', 3, 3)
        ON CONFLICT (month, organization_id, facility_id, metric, rule_set_id, rule_set_version, topic, input, fallback_kind)
        DO UPDATE SET total = assistant.monthly_counts.total + EXCLUDED.total
    $q$) = 1, 'a later run adds to the same key');
    PERFORM pg_temp.ok((SELECT total FROM assistant.monthly_counts WHERE metric = 'evaluations') = 7,
                       'counts accumulate per key');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$
        INSERT INTO assistant.monthly_counts (month, organization_id, facility_id, metric, topic, input, total)
        VALUES ('2026-11-01', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1',
                'topic_selected', 'claim', 'button', 2)
    $q$) = 1, 'monthly topic count is recorded');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.monthly_counts (month, organization_id, facility_id, metric,
                                         rule_set_id, rule_set_version, total)
                                       VALUES ('2026-11-15', '00000000-0000-7000-8000-00000000000a',
                                               '00000000-0000-7000-8000-0000000000a1', 'evaluations', 'claim-readiness', 3, 1)$q$,
                                 '23514', 'month is the first day of a month');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO assistant.monthly_counts (month, organization_id, facility_id, metric,
                                         topic, input, total)
                                       VALUES ('2026-10-01', '00000000-0000-7000-8000-00000000000a',
                                               '00000000-0000-7000-8000-0000000000a1', 'evaluations', 'claim', 'button', 1)$q$,
                                 '23514', 'evaluation counts name a rule-set version, not a topic');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE assistant.monthly_counts SET metric = 'fallback_shown'$q$, '42501',
                                 'only the total of a monthly count changes');
END
$$;

-- Aggregate views: small groups are suppressed, no user ids or comment text; reporting sees only the views.
DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
    rp  text := pg_temp.r('reporting');
    au  text := pg_temp.r('auditor');
    i   int;
BEGIN
    PERFORM pg_temp.ok(
        (SELECT suppressed AND feedback_count IS NULL AND comment_count IS NULL
         FROM assistant.feedback_summary_monthly WHERE target = 'finding' AND reason = 'data_outdated'),
        'a group of one is suppressed');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM assistant.feedback_summary_monthly WHERE reason = 'result_wrong'),
                       'superseded versions are not counted');

    -- Five users' current feedback on the same rule and reason make a reportable group.
    FOR i IN 1..5 LOOP
        PERFORM pg_temp.exec_as(rt, format($q$
            INSERT INTO iam.users (id, organization_id, display_name)
            VALUES ('00000000-0000-7000-8000-%s', '00000000-0000-7000-8000-00000000000a', 'Test User %s')
        $q$, lpad(to_hex(4096 + i), 12, '0'), i));
        PERFORM pg_temp.exec_as(rt, format($q$
            INSERT INTO assistant.evaluation_receipts (evaluation_id, organization_id, facility_id, user_id, rule_set_id,
                                                       rule_set_version, evaluated_at)
            VALUES ('00000000-0000-7000-8000-%1$s', '00000000-0000-7000-8000-00000000000a',
                    '00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-%2$s', 'claim-readiness', 3, now());
            INSERT INTO assistant.evaluation_receipt_results VALUES ('00000000-0000-7000-8000-%1$s', 'sep_present', 'failed');
            INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen, reason)
            VALUES ('00000000-0000-7000-8000-%1$s', '00000000-0000-7000-8000-%2$s', 'finding', 'sep_present', 'failed', 'unclear');
        $q$, lpad(to_hex(8192 + i), 12, '0'), lpad(to_hex(4096 + i), 12, '0')));
    END LOOP;
    PERFORM pg_temp.ok(
        (SELECT NOT suppressed AND feedback_count = 5 AND comment_count = 0
         FROM assistant.feedback_summary_monthly WHERE rule_id = 'sep_present' AND reason = 'unclear'),
        'a group of five is reported with its count');
    PERFORM pg_temp.ok(
        (SELECT suppressed AND total IS NULL FROM assistant.usage_summary_monthly WHERE metric = 'topic_selected')
        AND (SELECT NOT suppressed AND total = 7 FROM assistant.usage_summary_monthly WHERE metric = 'evaluations'),
        'usage summary suppresses small counts and reports the rest');
    PERFORM pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'assistant' AND table_name IN ('feedback_summary_monthly', 'usage_summary_monthly')
          AND column_name IN ('user_id', 'body', 'evaluation_id', 'panel_session')),
        'views expose no user ids, comment text, evaluation ids or panel sessions');

    -- Reporting reads the views and nothing else; the auditor reads none of it.
    PERFORM pg_temp.ok(pg_temp.exec_as(rp, 'SELECT * FROM assistant.feedback_summary_monthly') >= 1,
                       'reporting reads the feedback summary');
    PERFORM pg_temp.ok(pg_temp.exec_as(rp, 'SELECT * FROM assistant.usage_summary_monthly') >= 1,
                       'reporting reads the usage summary');
    PERFORM pg_temp.expect_error(rp, 'SELECT * FROM assistant.feedback', '42501', 'reporting cannot read feedback rows');
    PERFORM pg_temp.expect_error(rp, 'SELECT * FROM assistant.feedback_comments', '42501', 'reporting cannot read comments');
    PERFORM pg_temp.expect_error(rp, 'SELECT * FROM assistant.interaction_events', '42501', 'reporting cannot read events');
    PERFORM pg_temp.expect_error(au, 'SELECT * FROM assistant.feedback_comments', '42501', 'auditor cannot read comments');
    PERFORM pg_temp.expect_error(rt, 'TRUNCATE assistant.feedback', '42501', 'runtime cannot truncate feedback');
    PERFORM pg_temp.expect_error(rt, 'DROP VIEW assistant.feedback_summary_monthly', '42501', 'runtime cannot drop views');
END
$$;

ROLLBACK;
