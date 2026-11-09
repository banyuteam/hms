package assistant

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/platform/audit"
)

// PgStore is the assistant's persistence in schema assistant (hms_database migration 0006), as hms_meta_runtime
// through hms_assistant_rw. Monthly counts are incremented in the same transaction as the receipt or event they count,
// so retention only ever deletes.
type PgStore struct{ db *pgxpool.Pool }

func NewPgStore(db *pgxpool.Pool) *PgStore { return &PgStore{db: db} }

// Metrics of assistant.monthly_counts.
const (
	metricEvaluations = "evaluations"
	metricTopic       = "topic_selected"
	metricFallback    = "fallback_shown"
)

// Months are UTC calendar months, like the feedback summary view.
const monthlyUpsertSQL = `
INSERT INTO assistant.monthly_counts (month, organization_id, facility_id, metric, rule_set_id, rule_set_version,
                                      topic, input, fallback_kind, total)
VALUES (date_trunc('month', $1::timestamptz AT TIME ZONE 'UTC')::date, $2::uuid, $3::uuid, $4, NULLIF($5, ''),
        $6::integer, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), 1)
ON CONFLICT (month, organization_id, facility_id, metric, rule_set_id, rule_set_version, topic, input, fallback_kind)
DO UPDATE SET total = assistant.monthly_counts.total + 1`

func (s *PgStore) WriteReceipt(ctx context.Context, r Receipt) error {
	ids, results := make([]string, len(r.Results)), make([]string, len(r.Results))
	for i, x := range r.Results {
		ids[i], results[i] = x.RuleID, x.Result
	}
	return pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
INSERT INTO assistant.evaluation_receipts (evaluation_id, organization_id, facility_id, user_id, rule_set_id,
                                           rule_set_version, evaluated_at)
VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)`,
			r.EvaluationID, r.OrganizationID, r.FacilityID, r.UserID, r.RuleSetID, r.RuleSetVersion, r.EvaluatedAt); err != nil {
			return fmt.Errorf("insert receipt: %w", err)
		}
		if len(ids) > 0 {
			if _, err := tx.Exec(ctx, `
INSERT INTO assistant.evaluation_receipt_results (evaluation_id, rule_id, result)
SELECT $1::uuid, x.rule_id, x.result FROM unnest($2::text[], $3::text[]) AS x(rule_id, result)`,
				r.EvaluationID, ids, results); err != nil {
				return fmt.Errorf("insert receipt results: %w", err)
			}
		}
		_, err := tx.Exec(ctx, monthlyUpsertSQL, r.EvaluatedAt, r.OrganizationID, r.FacilityID, metricEvaluations,
			r.RuleSetID, r.RuleSetVersion, "", "", "")
		return err
	})
}

func isPgError(err error, code string) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == code
}

// SubmitFeedback stores a feedback item as the current version for (user, evaluation, target), or returns the current
// item when nothing changed. Two concurrent first submissions collide on uq_feedback_current; the loser retries once.
func (s *PgStore) SubmitFeedback(ctx context.Context, in FeedbackInput, ev audit.Event) (FeedbackResult, error) {
	var res FeedbackResult
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		res, err = s.submitOnce(ctx, in, ev)
		if !isPgError(err, "23505") {
			break
		}
	}
	switch {
	case isPgError(err, "23503"): // the receipt or its rule disappeared meanwhile (retention)
		return FeedbackResult{}, ErrReceiptNotFound
	case err != nil:
		return FeedbackResult{}, err
	}
	return res, nil
}

func (s *PgStore) submitOnce(ctx context.Context, in FeedbackInput, ev audit.Event) (FeedbackResult, error) {
	var res FeedbackResult
	err := pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		var one int
		err := tx.QueryRow(ctx, `
SELECT 1 FROM assistant.evaluation_receipts
WHERE evaluation_id = $1::uuid AND user_id = $2::uuid AND facility_id = $3::uuid AND evaluated_at >= $4`,
			in.EvaluationID, in.UserID, in.FacilityID, in.Now.Add(-in.Window)).Scan(&one)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrReceiptNotFound
		}
		if err != nil {
			return err
		}
		if in.Target == TargetFinding {
			var result string
			err := tx.QueryRow(ctx, `SELECT result FROM assistant.evaluation_receipt_results
WHERE evaluation_id = $1::uuid AND rule_id = $2`, in.EvaluationID, in.RuleID).Scan(&result)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && result != in.Result) {
				return ErrRuleMismatch
			}
			if err != nil {
				return err
			}
		}

		var curID, curReason, curHelp, curExpected, curComment string
		var curVersion int
		err = tx.QueryRow(ctx, `
SELECT f.id::text, f.version, coalesce(f.reason, ''), coalesce(f.helpfulness, ''), coalesce(f.expected, ''),
       coalesce(c.body, '')
FROM assistant.feedback f LEFT JOIN assistant.feedback_comments c ON c.feedback_id = f.id
WHERE f.evaluation_id = $1::uuid AND f.user_id = $2::uuid AND f.target = $3
  AND f.rule_id IS NOT DISTINCT FROM NULLIF($4, '') AND f.superseded_at IS NULL
FOR UPDATE OF f`, in.EvaluationID, in.UserID, in.Target, in.RuleID).
			Scan(&curID, &curVersion, &curReason, &curHelp, &curExpected, &curComment)
		found := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		detail := maps.Clone(ev.Detail)
		if found && curReason == in.Reason && curHelp == in.Helpfulness && curExpected == in.Expected &&
			curComment == in.Comment {
			res = FeedbackResult{ID: curID, Version: curVersion, Created: false}
			detail["version"], detail["unchanged"] = strconv.Itoa(curVersion), "true"
			ev.Detail = detail
			return audit.Write(ctx, tx, ev)
		}
		version := 1
		if found {
			if _, err := tx.Exec(ctx, `UPDATE assistant.feedback SET superseded_at = now() WHERE id = $1::uuid`, curID); err != nil {
				return err
			}
			version = curVersion + 1
		}
		var id string
		if err := tx.QueryRow(ctx, `
INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen, reason, helpfulness, expected, version)
VALUES ($1::uuid, $2::uuid, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), $9)
RETURNING id::text`, in.EvaluationID, in.UserID, in.Target, in.RuleID, in.Result, in.Reason, in.Helpfulness,
			in.Expected, version).Scan(&id); err != nil {
			return err
		}
		if in.Comment != "" {
			if _, err := tx.Exec(ctx, `INSERT INTO assistant.feedback_comments (feedback_id, body) VALUES ($1::uuid, $2)`,
				id, in.Comment); err != nil {
				return err
			}
		}
		res = FeedbackResult{ID: id, Version: version, Created: true}
		detail["version"] = strconv.Itoa(version)
		ev.Detail = detail
		return audit.Write(ctx, tx, ev)
	})
	return res, err
}

func (s *PgStore) Summary(ctx context.Context, q SummaryQuery) (SummaryData, error) {
	var out SummaryData
	if err := s.db.QueryRow(ctx, `
SELECT coalesce(sum(total), 0) FROM assistant.monthly_counts
WHERE metric = 'evaluations' AND organization_id = $1::uuid AND facility_id = $2::uuid AND rule_set_id = $3
  AND ($4::integer IS NULL OR rule_set_version = $4) AND month >= $5::date AND month < $6::date`,
		q.OrganizationID, q.FacilityID, q.RuleSetID, q.RuleSetVersion, q.From, q.To).Scan(&out.Evaluations); err != nil {
		return SummaryData{}, err
	}
	rows, err := s.db.Query(ctx, `
SELECT f.target, coalesce(f.rule_id, ''), coalesce(f.result_seen, ''), coalesce(f.reason, ''),
       coalesce(f.helpfulness, ''), coalesce(f.expected, ''), count(*), count(c.feedback_id)
FROM assistant.feedback f
JOIN assistant.evaluation_receipts r ON r.evaluation_id = f.evaluation_id
LEFT JOIN assistant.feedback_comments c ON c.feedback_id = f.id
WHERE f.superseded_at IS NULL AND r.organization_id = $1::uuid AND r.facility_id = $2::uuid AND r.rule_set_id = $3
  AND ($4::integer IS NULL OR r.rule_set_version = $4) AND f.created_at >= $5 AND f.created_at < $6
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY 1, 2, 3, 4, 5, 6`, q.OrganizationID, q.FacilityID, q.RuleSetID, q.RuleSetVersion, q.From, q.To)
	if err != nil {
		return SummaryData{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var g SummaryGroup
		if err := rows.Scan(&g.Target, &g.RuleID, &g.Result, &g.Reason, &g.Helpfulness, &g.Expected, &g.Count,
			&g.Comments); err != nil {
			return SummaryData{}, err
		}
		out.Groups = append(out.Groups, g)
	}
	return out, rows.Err()
}

func (s *PgStore) Comments(ctx context.Context, q CommentQuery) ([]Comment, error) {
	rows, err := s.db.Query(ctx, `
SELECT f.id::text, f.target, coalesce(f.rule_id, ''), coalesce(f.result_seen, ''), coalesce(f.reason, ''),
       coalesce(f.helpfulness, ''), coalesce(f.expected, ''), c.body, c.created_at
FROM assistant.feedback_comments c
JOIN assistant.feedback f ON f.id = c.feedback_id
JOIN assistant.evaluation_receipts r ON r.evaluation_id = f.evaluation_id
WHERE f.superseded_at IS NULL AND r.organization_id = $1::uuid AND r.facility_id = $2::uuid AND r.rule_set_id = $3
  AND ($4::integer IS NULL OR r.rule_set_version = $4) AND (NULLIF($5::text, '') IS NULL OR f.rule_id = $5)
  AND c.created_at >= $6 AND c.created_at < $7
  AND (NULLIF($8::text, '') IS NULL OR f.id < NULLIF($8::text, '')::uuid)
ORDER BY f.id DESC
LIMIT $9`, q.OrganizationID, q.FacilityID, q.RuleSetID, q.RuleSetVersion, q.RuleID, q.From, q.To, q.Before, q.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Comment
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.FeedbackID, &c.Target, &c.RuleID, &c.Result, &c.Reason, &c.Helpfulness, &c.Expected,
			&c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// RecordEvents stores new events (a repeated event id of the same user is ignored) and counts each stored one.
func (s *PgStore) RecordEvents(ctx context.Context, b EventBatch) (int, error) {
	stored := 0
	err := pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		stored = 0
		for _, e := range b.Events {
			tag, err := tx.Exec(ctx, `
INSERT INTO assistant.interaction_events (user_id, event_id, organization_id, facility_id, panel_session, schema_version,
                                          event_type, topic, input, fallback_kind, client_at, received_at)
VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), $10, $11)
ON CONFLICT DO NOTHING`, b.UserID, e.EventID, b.OrganizationID, b.FacilityID, e.PanelSession, e.Type, e.Topic,
				e.Input, e.FallbackKind, e.ClientAt, b.ReceivedAt)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				continue
			}
			stored++
			if _, err := tx.Exec(ctx, monthlyUpsertSQL, b.ReceivedAt, b.OrganizationID, b.FacilityID, e.Type, "", nil,
				e.Topic, e.Input, e.FallbackKind); err != nil {
				return err
			}
		}
		return nil
	})
	return stored, err
}

// Retention periods (ADR-SVC-008 L-5, L-11). Receipts referenced by feedback stay until that feedback expires.
const (
	ReceiptRetention = 30 * 24 * time.Hour
	CommentRetention = 90 * 24 * time.Hour
	EventRetention   = 90 * 24 * time.Hour
	purgeBatch       = 1000
	purgeMaxBatches  = 100
)

// PurgeResult counts rows deleted per table.
type PurgeResult map[string]int64

// Purge deletes expired rows in bounded batches, comments and feedback first so that the receipts they kept become
// deletable in the same run. It never touches audit events. A non-empty purge is recorded as one system audit event.
func (s *PgStore) Purge(ctx context.Context, now time.Time) (PurgeResult, error) {
	year := now.AddDate(-1, 0, 0)
	monthStart := time.Date(now.UTC().Year(), now.UTC().Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(-1, 0, 0)
	steps := []struct{ table, sql string }{
		{"feedback_comments", `DELETE FROM assistant.feedback_comments WHERE feedback_id IN (
SELECT feedback_id FROM assistant.feedback_comments WHERE created_at < $1 LIMIT $2)`},
		{"feedback", `DELETE FROM assistant.feedback WHERE id IN (
SELECT id FROM assistant.feedback WHERE created_at < $1 LIMIT $2)`},
		{"evaluation_receipts", `DELETE FROM assistant.evaluation_receipts WHERE evaluation_id IN (
SELECT r.evaluation_id FROM assistant.evaluation_receipts r
WHERE r.created_at < $1 AND NOT EXISTS (SELECT 1 FROM assistant.feedback f WHERE f.evaluation_id = r.evaluation_id)
LIMIT $2)`},
		{"interaction_events", `DELETE FROM assistant.interaction_events WHERE (user_id, event_id) IN (
SELECT user_id, event_id FROM assistant.interaction_events WHERE received_at < $1 LIMIT $2)`},
		{"monthly_counts", `DELETE FROM assistant.monthly_counts WHERE id IN (
SELECT id FROM assistant.monthly_counts WHERE month < $1::date LIMIT $2)`},
	}
	cutoffs := []time.Time{now.Add(-CommentRetention), year, now.Add(-ReceiptRetention), now.Add(-EventRetention), monthStart}
	res := PurgeResult{}
	for i, st := range steps {
		for n := 0; n < purgeMaxBatches; n++ {
			tag, err := s.db.Exec(ctx, st.sql, cutoffs[i], purgeBatch)
			if err != nil {
				return res, fmt.Errorf("purge %s: %w", st.table, err)
			}
			res[st.table] += tag.RowsAffected()
			if tag.RowsAffected() < purgeBatch {
				break
			}
		}
	}
	total := int64(0)
	detail := map[string]string{}
	for k, v := range res {
		total += v
		detail[k] = strconv.FormatInt(v, 10)
	}
	if total > 0 {
		if err := audit.Write(ctx, s.db, audit.Event{OccurredAt: now, Category: audit.CategoryAdministration,
			Action: "assistant.retention.purge", Outcome: audit.OutcomeSuccess, ActorType: audit.ActorSystem,
			Channel: "system", Detail: detail}); err != nil {
			return res, err
		}
	}
	return res, nil
}
