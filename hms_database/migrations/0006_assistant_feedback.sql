-- 0006 assistant: evaluation receipts, feedback on claim-readiness results, short comments, interaction events and
-- monthly counts (schema assistant, ADR-SVC-008 Phase A, owner decisions L-1 to L-11 of 2026-11-09).
-- Owner: hms_database (definitions); writes: hms_services assistant module (hms_assistant_rw); reads: hms_services;
-- reporting reads only the aggregate views (hms_report_read), never the rows.
-- Classification: confidential (staff ids, rule codes and results; no record values, no encounter or patient
-- identifiers). Exception: assistant.feedback_comments is restricted: free text that may contain patient data.
-- Retention (enforced by the hms_services purge job, not here): receipts 30 days unless feedback references them,
-- feedback 12 months, comments 90 days, interaction events 90 days, monthly counts 12 months.
-- Learning never changes rules: nothing in this schema is read to decide an evaluation result.
-- Requires group role hms_assistant_rw: re-run bootstrap/bootstrap.psql before applying.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA assistant;
COMMENT ON SCHEMA assistant IS 'hms_database: assistant evaluation receipts, feedback and usage counts (ADR-SVC-008)';

-- One row per claim-readiness evaluation returned to a user (L-1). Lineage for feedback and the denominator for
-- summaries. The encounter is not stored: the audit event of the evaluation links evaluation_id to it.
CREATE TABLE assistant.evaluation_receipts (
    evaluation_id     uuid        NOT NULL,
    organization_id   uuid        NOT NULL,
    facility_id       uuid        NOT NULL,
    user_id           uuid        NOT NULL,
    rule_set_id       text        NOT NULL,
    rule_set_version  integer     NOT NULL,
    evaluated_at      timestamptz NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_evaluation_receipts PRIMARY KEY (evaluation_id),
    CONSTRAINT uq_evaluation_receipts_evaluation_id_user_id UNIQUE (evaluation_id, user_id),
    CONSTRAINT fk_evaluation_receipts_facility FOREIGN KEY (facility_id, organization_id)
        REFERENCES platform.facilities (id, organization_id),
    CONSTRAINT fk_evaluation_receipts_user FOREIGN KEY (user_id, organization_id)
        REFERENCES iam.users (id, organization_id),
    CONSTRAINT ck_evaluation_receipts_rule_set_id CHECK (rule_set_id ~ '^[a-z][a-z0-9-]{0,63}$'),
    CONSTRAINT ck_evaluation_receipts_rule_set_version CHECK (rule_set_version >= 1)
);
COMMENT ON TABLE assistant.evaluation_receipts IS
    'Claim-readiness evaluation returned to a user (no encounter, no record values); append-only, purged after 30 days unless referenced';
CREATE INDEX idx_evaluation_receipts_evaluated_at ON assistant.evaluation_receipts (evaluated_at);
CREATE INDEX idx_evaluation_receipts_user_id ON assistant.evaluation_receipts (user_id);

-- The result of each rule in a receipt, so feedback can only name a rule that was evaluated, with the result shown.
CREATE TABLE assistant.evaluation_receipt_results (
    evaluation_id  uuid NOT NULL,
    rule_id        text NOT NULL,
    result         text NOT NULL,
    CONSTRAINT pk_evaluation_receipt_results PRIMARY KEY (evaluation_id, rule_id),
    CONSTRAINT uq_evaluation_receipt_results_result UNIQUE (evaluation_id, rule_id, result),
    CONSTRAINT fk_evaluation_receipt_results_evaluation_id FOREIGN KEY (evaluation_id)
        REFERENCES assistant.evaluation_receipts (evaluation_id) ON DELETE CASCADE,
    CONSTRAINT ck_evaluation_receipt_results_rule_id CHECK (rule_id ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_evaluation_receipt_results_result CHECK (result IN ('passed', 'failed', 'not_applicable', 'not_evaluated'))
);
COMMENT ON TABLE assistant.evaluation_receipt_results IS 'Rule results of one evaluation receipt (rule codes and results only)';

-- Feedback on a finding (target finding) or on the whole answer (target answer), by the user who ran the evaluation.
-- Append-only versions: a changed item is a new row and the previous one gets superseded_at, once.
CREATE TABLE assistant.feedback (
    id              uuid        NOT NULL DEFAULT uuidv7(),
    evaluation_id   uuid        NOT NULL,
    user_id         uuid        NOT NULL,
    target          text        NOT NULL,
    rule_id         text,
    result_seen     text,
    reason          text,
    helpfulness     text,
    expected        text,
    version         integer     NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    superseded_at   timestamptz,
    CONSTRAINT pk_feedback PRIMARY KEY (id),
    -- Only the user who ran the evaluation (L-4), and the receipt cannot be purged while feedback references it.
    CONSTRAINT fk_feedback_receipt FOREIGN KEY (evaluation_id, user_id)
        REFERENCES assistant.evaluation_receipts (evaluation_id, user_id),
    -- A finding must name a rule of that evaluation with the result it had (MATCH SIMPLE: not checked for answers).
    CONSTRAINT fk_feedback_rule_result FOREIGN KEY (evaluation_id, rule_id, result_seen)
        REFERENCES assistant.evaluation_receipt_results (evaluation_id, rule_id, result),
    CONSTRAINT ck_feedback_target CHECK (target IN ('finding', 'answer')),
    CONSTRAINT ck_feedback_reason CHECK (reason IN ('result_wrong', 'unclear', 'not_relevant', 'data_outdated')),
    CONSTRAINT ck_feedback_helpfulness CHECK (helpfulness IN ('helpful', 'partially_helpful', 'not_helpful')),
    CONSTRAINT ck_feedback_expected CHECK (expected IN
        ('more_specific', 'different_interpretation', 'actionable_steps', 'additional_information', 'other')),
    CONSTRAINT ck_feedback_shape CHECK (
        (target = 'finding' AND rule_id IS NOT NULL AND result_seen IS NOT NULL AND reason IS NOT NULL
            AND helpfulness IS NULL AND expected IS NULL)
        OR (target = 'answer' AND rule_id IS NULL AND result_seen IS NULL AND reason IS NULL
            AND helpfulness IS NOT NULL AND (expected IS NULL OR helpfulness <> 'helpful'))),
    CONSTRAINT ck_feedback_version CHECK (version >= 1),
    CONSTRAINT ck_feedback_superseded_at CHECK (superseded_at IS NULL OR superseded_at >= created_at)
);
COMMENT ON TABLE assistant.feedback IS
    'Structured feedback on a claim-readiness evaluation by the user who ran it; versions are appended, never edited';
COMMENT ON COLUMN assistant.feedback.result_seen IS 'Result of rule_id the user saw; must equal the receipt (composite FK)';
COMMENT ON COLUMN assistant.feedback.superseded_at IS 'Set once when a newer version replaces this one; NULL = current';
CREATE UNIQUE INDEX uq_feedback_current ON assistant.feedback (evaluation_id, user_id, target, rule_id)
    NULLS NOT DISTINCT WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX uq_feedback_version ON assistant.feedback (evaluation_id, user_id, target, rule_id, version)
    NULLS NOT DISTINCT;
CREATE INDEX idx_feedback_created_at ON assistant.feedback (created_at);

-- Optional comment of one feedback version (L-3): at most 200 characters, restricted, purged after 90 days.
CREATE TABLE assistant.feedback_comments (
    feedback_id  uuid        NOT NULL,
    body         text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_feedback_comments PRIMARY KEY (feedback_id),
    CONSTRAINT fk_feedback_comments_feedback_id FOREIGN KEY (feedback_id)
        REFERENCES assistant.feedback (id) ON DELETE CASCADE,
    CONSTRAINT ck_feedback_comments_body CHECK (length(btrim(body)) BETWEEN 1 AND 200)
);
COMMENT ON TABLE assistant.feedback_comments IS
    'Restricted: free text that may contain patient data; read only through hms_services with assistant.feedback.comments.read';
CREATE INDEX idx_feedback_comments_created_at ON assistant.feedback_comments (created_at);

-- Interaction events (L-10): which topic was asked and how, and when the assistant asked back instead of answering.
-- No text, no encounter or patient identifiers, no tags. User, organization and facility come from the session.
CREATE TABLE assistant.interaction_events (
    user_id          uuid        NOT NULL,
    event_id         uuid        NOT NULL,
    organization_id  uuid        NOT NULL,
    facility_id      uuid        NOT NULL,
    panel_session    uuid        NOT NULL,
    schema_version   integer     NOT NULL,
    event_type       text        NOT NULL,
    topic            text,
    input            text,
    fallback_kind    text,
    client_at        timestamptz NOT NULL,
    received_at      timestamptz NOT NULL DEFAULT now(),
    -- Deduplication per user: a client cannot suppress another user's events by reusing an event_id.
    CONSTRAINT pk_interaction_events PRIMARY KEY (user_id, event_id),
    CONSTRAINT fk_interaction_events_facility FOREIGN KEY (facility_id, organization_id)
        REFERENCES platform.facilities (id, organization_id),
    CONSTRAINT fk_interaction_events_user FOREIGN KEY (user_id, organization_id)
        REFERENCES iam.users (id, organization_id),
    CONSTRAINT ck_interaction_events_schema_version CHECK (schema_version = 1),
    CONSTRAINT ck_interaction_events_topic CHECK (topic IN
        ('claim', 'summary', 'diagnoses', 'procedures', 'labs', 'medications')),
    CONSTRAINT ck_interaction_events_input CHECK (input IN ('button', 'typed')),
    CONSTRAINT ck_interaction_events_fallback_kind CHECK (fallback_kind IN
        ('help', 'need_tag', 'need_visit', 'choose_visit', 'not_loaded', 'refused')),
    CONSTRAINT ck_interaction_events_shape CHECK (
        (event_type = 'topic_selected' AND topic IS NOT NULL AND input IS NOT NULL AND fallback_kind IS NULL)
        OR (event_type = 'fallback_shown' AND fallback_kind IS NOT NULL AND topic IS NULL AND input IS NULL))
);
COMMENT ON TABLE assistant.interaction_events IS
    'Assistant usage events (schema v1, ADR-SVC-008 Decision 6); purged after 90 days once counted in monthly_counts';
COMMENT ON COLUMN assistant.interaction_events.panel_session IS
    'Random id per assistant panel session in the browser; groups events, never an identity';
COMMENT ON COLUMN assistant.interaction_events.client_at IS 'Client clock, untrusted; received_at is the server time';
CREATE INDEX idx_interaction_events_received_at ON assistant.interaction_events (received_at);

-- Monthly counts kept 12 months after the rows they summarise expire (L-5, L-11). No user ids.
CREATE TABLE assistant.monthly_counts (
    id                uuid        NOT NULL DEFAULT uuidv7(),
    month             date        NOT NULL,
    organization_id   uuid        NOT NULL,
    facility_id       uuid        NOT NULL,
    metric            text        NOT NULL,
    rule_set_id       text,
    rule_set_version  integer,
    topic             text,
    input             text,
    fallback_kind     text,
    total             bigint      NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_monthly_counts PRIMARY KEY (id),
    CONSTRAINT fk_monthly_counts_facility FOREIGN KEY (facility_id, organization_id)
        REFERENCES platform.facilities (id, organization_id),
    CONSTRAINT ck_monthly_counts_month CHECK (month = date_trunc('month', month)::date),
    CONSTRAINT ck_monthly_counts_total CHECK (total >= 0),
    CONSTRAINT ck_monthly_counts_shape CHECK (
        (metric = 'evaluations' AND rule_set_id IS NOT NULL AND rule_set_version >= 1
            AND topic IS NULL AND input IS NULL AND fallback_kind IS NULL)
        OR (metric = 'topic_selected' AND rule_set_id IS NULL AND rule_set_version IS NULL
            AND topic IS NOT NULL AND input IS NOT NULL AND fallback_kind IS NULL)
        OR (metric = 'fallback_shown' AND rule_set_id IS NULL AND rule_set_version IS NULL
            AND topic IS NULL AND input IS NULL AND fallback_kind IS NOT NULL)),
    CONSTRAINT ck_monthly_counts_rule_set_id CHECK (rule_set_id ~ '^[a-z][a-z0-9-]{0,63}$'),
    CONSTRAINT ck_monthly_counts_topic CHECK (topic IN
        ('claim', 'summary', 'diagnoses', 'procedures', 'labs', 'medications')),
    CONSTRAINT ck_monthly_counts_input CHECK (input IN ('button', 'typed')),
    CONSTRAINT ck_monthly_counts_fallback_kind CHECK (fallback_kind IN
        ('help', 'need_tag', 'need_visit', 'choose_visit', 'not_loaded', 'refused'))
);
COMMENT ON TABLE assistant.monthly_counts IS
    'Per month and facility: evaluations per rule-set version, topic selections, fallbacks; built before raw rows expire';
CREATE UNIQUE INDEX uq_monthly_counts_key ON assistant.monthly_counts
    (month, organization_id, facility_id, metric, rule_set_id, rule_set_version, topic, input, fallback_kind)
    NULLS NOT DISTINCT;

CREATE TRIGGER trg_monthly_counts_touch_updated_at BEFORE UPDATE ON assistant.monthly_counts
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();

-- A feedback version is immutable; the only change is superseding it, once (column grants allow nothing else).
CREATE FUNCTION assistant.feedback_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'assistant.feedback row % is already superseded', OLD.id;
    END IF;
    IF NEW.superseded_at IS NULL THEN
        RAISE EXCEPTION 'assistant.feedback row % can only be superseded', OLD.id;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER trg_feedback_guard_update BEFORE UPDATE ON assistant.feedback
    FOR EACH ROW EXECUTE FUNCTION assistant.feedback_guard_update();

-- Reporting: aggregates only, with groups below 5 suppressed (L-6). The views run with the owner's rights, so
-- hms_report_read needs no access to the rows. The minimum is applied again by hms_services for its summary route.
CREATE VIEW assistant.feedback_summary_monthly AS
SELECT date_trunc('month', f.created_at)::date AS month,
       r.organization_id,
       r.facility_id,
       r.rule_set_id,
       r.rule_set_version,
       f.target,
       f.rule_id,
       f.result_seen,
       f.reason,
       f.helpfulness,
       f.expected,
       CASE WHEN count(*) >= 5 THEN count(*) END AS feedback_count,
       CASE WHEN count(*) >= 5 THEN count(c.feedback_id) END AS comment_count,
       count(*) < 5 AS suppressed
FROM assistant.feedback f
JOIN assistant.evaluation_receipts r ON r.evaluation_id = f.evaluation_id
LEFT JOIN assistant.feedback_comments c ON c.feedback_id = f.id
WHERE f.superseded_at IS NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;
COMMENT ON VIEW assistant.feedback_summary_monthly IS
    'Current feedback per month, facility, rule-set version, rule and choice; counts below 5 are NULL (suppressed); no user ids, no comment text';

CREATE VIEW assistant.usage_summary_monthly AS
SELECT month, organization_id, facility_id, metric, rule_set_id, rule_set_version, topic, input, fallback_kind,
       CASE WHEN total >= 5 THEN total END AS total,
       total < 5 AS suppressed
FROM assistant.monthly_counts;
COMMENT ON VIEW assistant.usage_summary_monthly IS
    'Monthly evaluation, topic and fallback counts per facility; counts below 5 are NULL (suppressed)';

GRANT USAGE ON SCHEMA assistant TO hms_assistant_rw, hms_report_read;
GRANT SELECT, INSERT, DELETE ON assistant.evaluation_receipts TO hms_assistant_rw;
GRANT SELECT, INSERT ON assistant.evaluation_receipt_results TO hms_assistant_rw;
GRANT SELECT, INSERT, DELETE ON assistant.feedback TO hms_assistant_rw;
GRANT UPDATE (superseded_at) ON assistant.feedback TO hms_assistant_rw;
GRANT SELECT, INSERT, DELETE ON assistant.feedback_comments TO hms_assistant_rw;
GRANT SELECT, INSERT, DELETE ON assistant.interaction_events TO hms_assistant_rw;
GRANT SELECT, INSERT, DELETE ON assistant.monthly_counts TO hms_assistant_rw;
GRANT UPDATE (total) ON assistant.monthly_counts TO hms_assistant_rw;
GRANT SELECT ON assistant.feedback_summary_monthly, assistant.usage_summary_monthly TO hms_assistant_rw, hms_report_read;
