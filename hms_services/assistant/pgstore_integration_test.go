package assistant

// PostgreSQL integration tests for the assistant store (schema assistant, hms_database migration 0006). Development/CI
// database only:
//
//	HMS_TEST_DATABASE_URL        connection as the runtime role (hms_meta_runtime)
//	HMS_TEST_ADMIN_DATABASE_URL  superuser connection, used only to set up users and inspect or age rows
//
// Skipped when either is unset. Rows are synthetic and tagged per run; they are left behind like the other PG tests.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/platform/audit"
	"hms/services/platform/tenancy"
)

type pgAssistant struct {
	rt, admin           *pgxpool.Pool
	store               *PgStore
	org, facA, facB     string
	user1, user2        string
	evalA, evalB, evalC string
}

func uuid4() string { return newUUID() }

func setupAssistantPG(t *testing.T) *pgAssistant {
	t.Helper()
	rtURL, adminURL := os.Getenv("HMS_TEST_DATABASE_URL"), os.Getenv("HMS_TEST_ADMIN_DATABASE_URL")
	if rtURL == "" || adminURL == "" {
		t.Skip("HMS_TEST_DATABASE_URL / HMS_TEST_ADMIN_DATABASE_URL not set")
	}
	ctx := context.Background()
	rt, err := pgxpool.New(ctx, rtURL)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rt.Close(); admin.Close() })
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	code := "T" + strings.ToUpper(hex.EncodeToString(b))
	a, err := tenancy.Ensure(ctx, rt, tenancy.Setup{OrganizationCode: code, OrganizationName: "Test Org " + code,
		FacilityCode: code + "-A", FacilityName: "Facility A", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	fb, err := tenancy.Ensure(ctx, rt, tenancy.Setup{OrganizationCode: code, OrganizationName: "Test Org " + code,
		FacilityCode: code + "-B", FacilityName: "Facility B", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	e := &pgAssistant{rt: rt, admin: admin, store: NewPgStore(rt), org: a.OrganizationID, facA: a.FacilityID,
		facB: fb.FacilityID, evalA: uuid4(), evalB: uuid4(), evalC: uuid4()}
	for _, u := range []*string{&e.user1, &e.user2} {
		if err := admin.QueryRow(ctx, `INSERT INTO iam.users (organization_id, display_name) VALUES ($1::uuid, 'Test user')
RETURNING id::text`, e.org).Scan(u); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

func (e *pgAssistant) count(t *testing.T, sql string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := e.admin.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// age moves a row's timestamp into the past as the superuser, bypassing the append-only guard (test setup only).
func (e *pgAssistant) age(t *testing.T, sql string, args ...any) {
	t.Helper()
	err := pgx.BeginTxFunc(context.Background(), e.admin, pgx.TxOptions{}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(context.Background(), `SET LOCAL session_replication_role = replica`); err != nil {
			return err
		}
		_, err := tx.Exec(context.Background(), sql, args...)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func (e *pgAssistant) receipt(t *testing.T, id, user, facility string, at time.Time) {
	t.Helper()
	if err := e.store.WriteReceipt(context.Background(), Receipt{EvaluationID: id, OrganizationID: e.org,
		FacilityID: facility, UserID: user, RuleSetID: "claim-readiness", RuleSetVersion: 3, EvaluatedAt: at,
		Results: []RuleResult{{"primary_diagnosis_coded", "passed"}, {"discharge_summary_present", "failed"}}}); err != nil {
		t.Fatal(err)
	}
}

func submitEvent(e *pgAssistant, in FeedbackInput) audit.Event {
	return audit.Event{Category: audit.CategoryDataAccess, Action: "assistant.feedback.submit", Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorUser, ActorID: in.UserID, OrganizationID: e.org, FacilityID: in.FacilityID,
		ResourceType: "AssistantEvaluation", ResourceID: in.EvaluationID, Channel: "web",
		Detail: map[string]string{"evaluation_id": in.EvaluationID, "target": in.Target}}
}

func TestPGAssistantFeedbackLifecycle(t *testing.T) {
	e := setupAssistantPG(t)
	ctx := context.Background()
	now := time.Now()
	e.receipt(t, e.evalA, e.user1, e.facA, now)
	e.receipt(t, e.evalB, e.user2, e.facA, now)
	if n := e.count(t, `SELECT total FROM assistant.monthly_counts WHERE facility_id = $1::uuid AND metric = 'evaluations'`,
		e.facA); n != 2 {
		t.Fatalf("monthly evaluations %d", n)
	}

	finding := FeedbackInput{EvaluationID: e.evalA, UserID: e.user1, FacilityID: e.facA, Target: TargetFinding,
		RuleID: "discharge_summary_present", Result: "failed", Reason: "result_wrong",
		Comment: "Synthetic: summary added later.", Now: now, Window: feedbackWindow}
	first, err := e.store.SubmitFeedback(ctx, finding, submitEvent(e, finding))
	if err != nil || !first.Created || first.Version != 1 {
		t.Fatalf("first: %+v %v", first, err)
	}
	same, err := e.store.SubmitFeedback(ctx, finding, submitEvent(e, finding))
	if err != nil || same.Created || same.ID != first.ID {
		t.Fatalf("repeat: %+v %v", same, err)
	}
	changed := finding
	changed.Reason, changed.Comment = "data_outdated", ""
	second, err := e.store.SubmitFeedback(ctx, changed, submitEvent(e, changed))
	if err != nil || !second.Created || second.Version != 2 || second.ID == first.ID {
		t.Fatalf("change: %+v %v", second, err)
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.feedback WHERE id = $1::uuid AND superseded_at IS NOT NULL`, first.ID); n != 1 {
		t.Error("the first version is superseded")
	}
	if n := e.count(t, `SELECT count(*) FROM audit.audit_events WHERE action = 'assistant.feedback.submit'
AND resource_id = $1 AND NOT detail ? 'comment_text'`, e.evalA); n != 3 {
		t.Errorf("audit events for the three submissions: %d", n)
	}

	// Lineage: only the user's own evaluation, at the session facility, within the window, for a rule it evaluated.
	for name, tc := range map[string]struct {
		edit func(*FeedbackInput)
		want error
	}{
		"other user":     {func(in *FeedbackInput) { in.UserID = e.user2 }, ErrReceiptNotFound},
		"other facility": {func(in *FeedbackInput) { in.FacilityID = e.facB }, ErrReceiptNotFound},
		"unknown":        {func(in *FeedbackInput) { in.EvaluationID = uuid4() }, ErrReceiptNotFound},
		"window passed":  {func(in *FeedbackInput) { in.Now = now.Add(8 * 24 * time.Hour) }, ErrReceiptNotFound},
		"rule not there": {func(in *FeedbackInput) { in.RuleID = "sep_present" }, ErrRuleMismatch},
		"other result":   {func(in *FeedbackInput) { in.Result = "passed" }, ErrRuleMismatch},
	} {
		in := finding
		tc.edit(&in)
		if _, err := e.store.SubmitFeedback(ctx, in, submitEvent(e, in)); !errors.Is(err, tc.want) {
			t.Errorf("%s: %v", name, err)
		}
	}

	answer := FeedbackInput{EvaluationID: e.evalA, UserID: e.user1, FacilityID: e.facA, Target: TargetAnswer,
		Helpfulness: "partially_helpful", Expected: "more_specific", Comment: "Synthetic answer comment.", Now: now,
		Window: feedbackWindow}
	if r, err := e.store.SubmitFeedback(ctx, answer, submitEvent(e, answer)); err != nil || !r.Created {
		t.Fatalf("answer: %+v %v", r, err)
	}

	// Summary: current items only, evaluations from the monthly counts.
	month := time.Date(now.UTC().Year(), now.UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	sum, err := e.store.Summary(ctx, SummaryQuery{OrganizationID: e.org, FacilityID: e.facA, RuleSetID: "claim-readiness",
		From: month, To: month.AddDate(0, 1, 0)})
	if err != nil || sum.Evaluations != 2 || len(sum.Groups) != 2 {
		t.Fatalf("summary %+v %v", sum, err)
	}
	for _, g := range sum.Groups {
		if g.Target == TargetFinding && (g.Reason != "data_outdated" || g.Count != 1 || g.Comments != 0) ||
			g.Target == TargetAnswer && (g.Helpfulness != "partially_helpful" || g.Count != 1 || g.Comments != 1) {
			t.Errorf("group %+v", g)
		}
	}
	other, _ := e.store.Summary(ctx, SummaryQuery{OrganizationID: e.org, FacilityID: e.facB, RuleSetID: "claim-readiness",
		From: month, To: month.AddDate(0, 1, 0)})
	if other.Evaluations != 0 || len(other.Groups) != 0 {
		t.Errorf("facility B sees facility A: %+v", other)
	}

	// Comments: current versions only (the first version's comment belongs to a superseded item).
	list, err := e.store.Comments(ctx, CommentQuery{OrganizationID: e.org, FacilityID: e.facA, RuleSetID: "claim-readiness",
		From: month, To: month.AddDate(0, 1, 0), Limit: 10})
	if err != nil || len(list) != 1 || list[0].Body != "Synthetic answer comment." || list[0].Target != TargetAnswer {
		t.Fatalf("comments %+v %v", list, err)
	}
	if l, _ := e.store.Comments(ctx, CommentQuery{OrganizationID: e.org, FacilityID: e.facA, RuleSetID: "claim-readiness",
		From: month, To: month.AddDate(0, 1, 0), Before: list[0].FeedbackID, Limit: 10}); len(l) != 0 {
		t.Errorf("cursor: %+v", l)
	}
}

func TestPGAssistantEventsAndRetention(t *testing.T) {
	e := setupAssistantPG(t)
	ctx := context.Background()
	now := time.Now()
	b := EventBatch{UserID: e.user1, OrganizationID: e.org, FacilityID: e.facA, ReceivedAt: now, Events: []Event{
		{EventID: uuid4(), PanelSession: uuid4(), Type: "topic_selected", Topic: "claim", Input: "button", ClientAt: now},
		{EventID: uuid4(), PanelSession: uuid4(), Type: "fallback_shown", FallbackKind: "choose_visit", ClientAt: now},
	}}
	if n, err := e.store.RecordEvents(ctx, b); err != nil || n != 2 {
		t.Fatalf("events: %d %v", n, err)
	}
	if n, err := e.store.RecordEvents(ctx, b); err != nil || n != 0 {
		t.Fatalf("repeat: %d %v", n, err)
	}
	if n := e.count(t, `SELECT coalesce(sum(total), 0) FROM assistant.monthly_counts WHERE facility_id = $1::uuid
AND metric IN ('topic_selected', 'fallback_shown')`, e.facA); n != 2 {
		t.Errorf("monthly event counts %d (duplicates must not count)", n)
	}

	// Retention: an old receipt without feedback goes, one with feedback stays; old comments and events go.
	e.receipt(t, e.evalA, e.user1, e.facA, now)
	e.receipt(t, e.evalB, e.user1, e.facA, now)
	in := FeedbackInput{EvaluationID: e.evalA, UserID: e.user1, FacilityID: e.facA, Target: TargetAnswer,
		Helpfulness: "not_helpful", Comment: "Synthetic.", Now: now, Window: feedbackWindow}
	fb, err := e.store.SubmitFeedback(ctx, in, submitEvent(e, in))
	if err != nil {
		t.Fatal(err)
	}
	old := now.Add(-100 * 24 * time.Hour)
	e.age(t, `UPDATE assistant.evaluation_receipts SET created_at = $2 WHERE evaluation_id IN ($1::uuid, $3::uuid)`,
		e.evalA, old, e.evalB)
	e.age(t, `UPDATE assistant.feedback_comments SET created_at = $2 WHERE feedback_id = $1::uuid`, fb.ID, old)
	e.age(t, `UPDATE assistant.interaction_events SET received_at = $2 WHERE user_id = $1::uuid`, e.user1, old)

	res, err := e.store.Purge(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if res["evaluation_receipts"] < 1 || res["feedback_comments"] < 1 || res["interaction_events"] < 2 {
		t.Errorf("purged %v", res)
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.evaluation_receipts WHERE evaluation_id = $1::uuid`, e.evalB); n != 0 {
		t.Error("an old receipt without feedback is purged")
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.evaluation_receipts WHERE evaluation_id = $1::uuid`, e.evalA); n != 1 {
		t.Error("a receipt with feedback is kept")
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.feedback WHERE id = $1::uuid`, fb.ID); n != 1 {
		t.Error("the feedback choice stays when its comment expires")
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.feedback_comments WHERE feedback_id = $1::uuid`, fb.ID); n != 0 {
		t.Error("an old comment is purged")
	}
	if n := e.count(t, `SELECT coalesce(sum(total), 0) FROM assistant.monthly_counts WHERE facility_id = $1::uuid`, e.facA); n < 4 {
		t.Errorf("monthly counts survive the purge of their rows: %d", n)
	}
	if n := e.count(t, `SELECT count(*) FROM audit.audit_events WHERE action = 'assistant.retention.purge'
AND occurred_at >= $1`, now.Add(-time.Minute)); n < 1 {
		t.Error("a purge is audited")
	}

	// After twelve months the feedback goes too, and with it the receipt it kept.
	e.age(t, `UPDATE assistant.feedback SET created_at = $2 WHERE id = $1::uuid`, fb.ID, now.AddDate(-1, 0, -1))
	if _, err := e.store.Purge(ctx, now); err != nil {
		t.Fatal(err)
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.evaluation_receipts WHERE evaluation_id = $1::uuid`, e.evalA); n != 0 {
		t.Error("the receipt is purged once its feedback expired")
	}
}
