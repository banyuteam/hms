package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

const evalID = "0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a90"

type fakeStore struct {
	err       error
	res       FeedbackResult
	submitted []FeedbackInput
	submitEv  []audit.Event
	summary   SummaryData
	summaryQ  []SummaryQuery
	comments  []Comment
	commentQ  []CommentQuery
	batches   []EventBatch
}

func (f *fakeStore) SubmitFeedback(_ context.Context, in FeedbackInput, ev audit.Event) (FeedbackResult, error) {
	f.submitted, f.submitEv = append(f.submitted, in), append(f.submitEv, ev)
	return f.res, f.err
}

func (f *fakeStore) Summary(_ context.Context, q SummaryQuery) (SummaryData, error) {
	f.summaryQ = append(f.summaryQ, q)
	return f.summary, f.err
}

func (f *fakeStore) Comments(_ context.Context, q CommentQuery) ([]Comment, error) {
	f.commentQ = append(f.commentQ, q)
	return f.comments, f.err
}

func (f *fakeStore) RecordEvents(_ context.Context, b EventBatch) (int, error) {
	f.batches = append(f.batches, b)
	return len(b.Events), f.err
}

type fenv struct {
	h       *FeedbackHandler
	store   *fakeStore
	audit   *fakeAudit
	allowed bool
	asked   []string
}

var testNow = time.Date(2026, 11, 9, 3, 15, 0, 0, time.UTC)

func newFenv(t *testing.T) *fenv {
	t.Helper()
	u, _ := url.Parse(origin)
	ih := iam.NewHandler(nil, iam.HTTPOptions{PublicOrigin: u})
	e := &fenv{store: &fakeStore{res: FeedbackResult{ID: "fb-1", Version: 1, Created: true}}, audit: &fakeAudit{},
		allowed: true}
	e.h = NewFeedbackHandler(e.store, e.audit, ih, slog.New(slog.NewTextHandler(io.Discard, nil)))
	e.h.now = func() time.Time { return testNow }
	e.h.can = func(_ *http.Request, perm string) (bool, error) {
		e.asked = append(e.asked, perm)
		return e.allowed, nil
	}
	return e
}

// call runs one handler as the routes would after RequireSession (and RequirePermission) let the request through.
func (e *fenv) call(fn http.HandlerFunc, method, target, body string, edit ...func(*http.Request)) *httptest.ResponseRecorder {
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, target, rd)
	r.Header.Set("Origin", origin)
	r.Header.Set("Content-Type", "application/json")
	r = r.WithContext(iam.WithPrincipal(r.Context(), iam.Principal{UserID: "user-1", OrganizationID: "org-1", FacilityID: "fac-1"}))
	for _, f := range edit {
		f(r)
	}
	w := httptest.NewRecorder()
	fn(w, r)
	return w
}

func (e *fenv) feedback(body string) *httptest.ResponseRecorder {
	return e.call(e.h.submit, http.MethodPost, "/api/v1/assistant/feedback", body)
}

func findingBody(extra string) string {
	return `{"evaluation_id":"` + evalID + `","rule_id":"discharge_summary_present","result":"failed","reason":"result_wrong"` +
		extra + `}`
}

func TestFeedbackOnAFindingIsStoredAsTheUsersOwnAndAuditedWithoutTheComment(t *testing.T) {
	e := newFenv(t)
	w := e.feedback(findingBody(`,"comment":"  Resume ditulis setelah pemeriksaan.  "`))
	if w.Code != http.StatusCreated || !strings.Contains(w.Body.String(), `"feedback_id":"fb-1"`) {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	in := e.store.submitted[0]
	want := FeedbackInput{EvaluationID: evalID, UserID: "user-1", FacilityID: "fac-1", Target: TargetFinding,
		RuleID: "discharge_summary_present", Result: "failed", Reason: "result_wrong",
		Comment: "Resume ditulis setelah pemeriksaan.", Now: testNow, Window: 7 * 24 * time.Hour}
	if in != want {
		t.Errorf("input %+v", in)
	}
	ev := e.store.submitEv[0]
	if ev.Action != "assistant.feedback.submit" || ev.Outcome != "success" || ev.ActorID != "user-1" ||
		ev.ResourceType != "AssistantEvaluation" || ev.ResourceID != evalID || ev.Detail["comment"] != "true" ||
		ev.Detail["reason"] != "result_wrong" || ev.Detail["rule_id"] != "discharge_summary_present" {
		t.Errorf("audit event %+v", ev)
	}
	d, _ := json.Marshal(ev.Detail)
	if strings.Contains(string(d), "Resume") {
		t.Errorf("comment text in the audit detail: %s", d)
	}
	if len(e.audit.events) != 0 {
		t.Error("an accepted item is audited by the store transaction, not separately")
	}
}

func TestFeedbackOnTheAnswerAndAnUnchangedRepeat(t *testing.T) {
	e := newFenv(t)
	e.store.res = FeedbackResult{ID: "fb-2", Version: 3, Created: false}
	w := e.feedback(`{"evaluation_id":"` + evalID + `","helpfulness":"not_helpful","expected":"actionable_steps"}`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"version":3`) {
		t.Fatalf("unchanged repeat: %d %s", w.Code, w.Body.String())
	}
	in := e.store.submitted[0]
	if in.Target != TargetAnswer || in.Helpfulness != "not_helpful" || in.Expected != "actionable_steps" || in.RuleID != "" {
		t.Errorf("input %+v", in)
	}
}

func TestFeedbackValidation(t *testing.T) {
	long := strings.Repeat("é", 201)
	for name, body := range map[string]string{
		"evaluation id":         `{"evaluation_id":"x","helpfulness":"helpful"}`,
		"unknown field":         `{"evaluation_id":"` + evalID + `","helpfulness":"helpful","user_id":"someone-else"}`,
		"trailing data":         `{"evaluation_id":"` + evalID + `","helpfulness":"helpful"} {}`,
		"reason":                findingBody(`,"x":1`),
		"unknown reason":        `{"evaluation_id":"` + evalID + `","rule_id":"sep_present","result":"failed","reason":"bad"}`,
		"missing result":        `{"evaluation_id":"` + evalID + `","rule_id":"sep_present","reason":"unclear"}`,
		"finding helpfulness":   findingBody(`,"helpfulness":"helpful"`),
		"answer reason":         `{"evaluation_id":"` + evalID + `","helpfulness":"helpful","reason":"unclear"}`,
		"helpful with expected": `{"evaluation_id":"` + evalID + `","helpfulness":"helpful","expected":"other"}`,
		"unknown expected":      `{"evaluation_id":"` + evalID + `","helpfulness":"not_helpful","expected":"magic"}`,
		"comment too long":      findingBody(`,"comment":"` + long + `"`),
		"comment control":       findingBody(`,"comment":"a\u0007b"`),
		"body over 1 KiB":       findingBody(`,"comment":"` + strings.Repeat(" ", 1100) + `"`),
	} {
		e := newFenv(t)
		if w := e.feedback(body); w.Code != http.StatusBadRequest || errorCode(w) != "invalid_request" {
			t.Errorf("%s: %d %s", name, w.Code, w.Body.String())
		}
		if len(e.store.submitted) != 0 {
			t.Errorf("%s: stored", name)
		}
	}
	// 200 characters of multi-byte text are within the limit (characters, not bytes).
	e := newFenv(t)
	if w := e.feedback(findingBody(`,"comment":"` + strings.Repeat("é", 200) + `"`)); w.Code != http.StatusCreated {
		t.Errorf("200 characters: %d %s", w.Code, w.Body.String())
	}
}

func TestRejectedFeedbackIsAuditedAndSaysNothingAboutWhy(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
		reason string
	}{
		{ErrReceiptNotFound, 404, "evaluation_not_found", "not_found"},
		{ErrRuleMismatch, 422, "rule_not_in_evaluation", "rule_mismatch"},
	} {
		e := newFenv(t)
		e.store.err = tc.err
		w := e.feedback(findingBody(""))
		if w.Code != tc.status || errorCode(w) != tc.code {
			t.Errorf("%v: %d %s", tc.err, w.Code, w.Body.String())
		}
		if len(e.audit.events) != 1 || e.audit.events[0].Outcome != "failure" ||
			e.audit.events[0].Detail["reason_rejected"] != tc.reason {
			t.Errorf("%v: audit %+v", tc.err, e.audit.events)
		}
	}
	// No rejection without its audit event.
	e := newFenv(t)
	e.store.err, e.audit.fail = ErrReceiptNotFound, true
	if w := e.feedback(findingBody("")); w.Code != http.StatusServiceUnavailable {
		t.Errorf("audit down: %d", w.Code)
	}
	e = newFenv(t)
	e.store.err = errors.New("db down")
	if w := e.feedback(findingBody("")); w.Code != http.StatusServiceUnavailable {
		t.Errorf("store down: %d", w.Code)
	}
}

func TestFeedbackNeedsTheOriginAndIsRateLimited(t *testing.T) {
	e := newFenv(t)
	w := e.call(e.h.submit, http.MethodPost, "/api/v1/assistant/feedback", findingBody(""), func(r *http.Request) {
		r.Header.Set("Origin", "https://evil.test.invalid")
	})
	if w.Code != http.StatusForbidden || len(e.store.submitted) != 0 {
		t.Errorf("foreign origin: %d", w.Code)
	}
	e = newFenv(t)
	for i := 0; i < feedbackPerMinute; i++ {
		e.feedback(findingBody(""))
	}
	if w := e.feedback(findingBody("")); w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") == "" {
		t.Errorf("limit: %d", w.Code)
	}
}

func TestSummaryWithholdsSmallGroupsAndIsScopedToTheSessionFacility(t *testing.T) {
	e := newFenv(t)
	e.store.summary = SummaryData{Evaluations: 40, Groups: []SummaryGroup{
		{Target: TargetFinding, RuleID: "sep_present", Result: "failed", Reason: "unclear", Count: 4, Comments: 2},
		{Target: TargetFinding, RuleID: "sep_present", Result: "failed", Reason: "result_wrong", Count: 5, Comments: 1},
		{Target: TargetAnswer, Helpfulness: "helpful", Count: 12},
	}}
	w := e.call(e.h.summary, http.MethodGet, "/api/v1/assistant/feedback/summary?rule_set=claim-readiness&version=3&from=2026-09&to=2026-11", "")
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var got struct {
		Evaluations  int64         `json:"evaluations"`
		MinGroupSize int           `json:"min_group_size"`
		From         string        `json:"from"`
		To           string        `json:"to"`
		Groups       []summaryItem `json:"groups"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if got.Evaluations != 40 || got.MinGroupSize != 5 || len(got.Groups) != 3 {
		t.Fatalf("summary %+v", got)
	}
	if g := got.Groups[0]; !g.Suppressed || g.Count != nil || g.Comments != nil || *g.Reason != "unclear" {
		t.Errorf("group of 4 %+v", g)
	}
	if g := got.Groups[1]; g.Suppressed || *g.Count != 5 || *g.Comments != 1 {
		t.Errorf("group of 5 %+v", g)
	}
	if strings.Contains(w.Body.String(), "user") {
		t.Errorf("user data in the summary: %s", w.Body.String())
	}
	q := e.store.summaryQ[0]
	if q.OrganizationID != "org-1" || q.FacilityID != "fac-1" || q.RuleSetID != "claim-readiness" ||
		q.RuleSetVersion == nil || *q.RuleSetVersion != 3 || !q.From.Equal(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)) ||
		!q.To.Equal(time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("query %+v", q)
	}
	if len(e.audit.events) != 1 || e.audit.events[0].Action != "assistant.feedback.summary" ||
		e.audit.events[0].ResourceType != "AssistantFeedback" || e.audit.events[0].Detail["from"] != "2026-09" {
		t.Errorf("audit %+v", e.audit.events)
	}

	// Default range: the current month.
	e.call(e.h.summary, http.MethodGet, "/api/v1/assistant/feedback/summary?rule_set=claim-readiness", "")
	if q := e.store.summaryQ[1]; !q.From.Equal(time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)) || q.RuleSetVersion != nil {
		t.Errorf("default query %+v", q)
	}
	for _, bad := range []string{"", "?rule_set=Bad", "?rule_set=claim-readiness&version=0",
		"?rule_set=claim-readiness&from=2026-13", "?rule_set=claim-readiness&from=2026-11&to=2026-10",
		"?rule_set=claim-readiness&from=2025-01&to=2026-01"} {
		if w := e.call(e.h.summary, http.MethodGet, "/api/v1/assistant/feedback/summary"+bad, ""); w.Code != 400 {
			t.Errorf("%q: %d", bad, w.Code)
		}
	}
}

func TestCommentsAreAuditedAndNeverNameTheSubmitter(t *testing.T) {
	e := newFenv(t)
	for i := 0; i < commentsPageSize+1; i++ {
		e.store.comments = append(e.store.comments, Comment{FeedbackID: "fb-" + string(rune('a'+i%26)),
			Target: TargetFinding, RuleID: "sep_present", Result: "failed", Reason: "unclear", Body: "synthetic",
			CreatedAt: time.Date(2026, 11, 8, 14, 30, 0, 0, time.UTC)})
	}
	w := e.call(e.h.comments, http.MethodGet, "/api/v1/assistant/feedback/comments?rule_set=claim-readiness&rule_id=sep_present", "")
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var got struct {
		Comments   []map[string]any `json:"comments"`
		NextBefore *string          `json:"next_before"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if len(got.Comments) != commentsPageSize || got.NextBefore == nil || got.Comments[0]["date"] != "2026-11-08" {
		t.Fatalf("page %d next %v first %v", len(got.Comments), got.NextBefore, got.Comments[0])
	}
	for k := range got.Comments[0] {
		if strings.Contains(k, "user") || k == "created_at" {
			t.Errorf("comment exposes %q", k)
		}
	}
	if q := e.store.commentQ[0]; q.Limit != commentsPageSize+1 || q.RuleID != "sep_present" || q.FacilityID != "fac-1" {
		t.Errorf("query %+v", q)
	}
	if len(e.audit.events) != 1 || e.audit.events[0].Action != "assistant.feedback.comments.read" ||
		e.audit.events[0].Detail["returned"] != "50" || e.audit.events[0].Detail["rule_id"] != "sep_present" {
		t.Errorf("audit %+v", e.audit.events)
	}
	if w := e.call(e.h.comments, http.MethodGet, "/api/v1/assistant/feedback/comments?rule_set=claim-readiness&before=x", ""); w.Code != 400 {
		t.Errorf("bad cursor: %d", w.Code)
	}
	e.audit.fail = true
	if w := e.call(e.h.comments, http.MethodGet, "/api/v1/assistant/feedback/comments?rule_set=claim-readiness", ""); w.Code != 503 ||
		strings.Contains(w.Body.String(), "synthetic") {
		t.Errorf("unaudited read: %d %s", w.Code, w.Body.String())
	}
}

func event(typ, extra string) string {
	return `{"schema_version":1,"event_id":"11111111-2222-4333-8444-555555555555","type":"` + typ +
		`","client_at":"2026-11-09T10:14:00+07:00","panel_session":"66666666-7777-4888-9999-000000000000"` + extra + `}`
}

func (e *fenv) events(list ...string) *httptest.ResponseRecorder {
	return e.call(e.h.events, http.MethodPost, "/api/v1/assistant/events", `{"events":[`+strings.Join(list, ",")+`]}`)
}

func TestInteractionEvents(t *testing.T) {
	e := newFenv(t)
	w := e.events(event("topic_selected", `,"topic":"labs","input":"button"`),
		event("fallback_shown", `,"fallback_kind":"choose_visit"`))
	if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), `"accepted":2`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	b := e.store.batches[0]
	if b.UserID != "user-1" || b.FacilityID != "fac-1" || !b.ReceivedAt.Equal(testNow) || len(b.Events) != 2 ||
		b.Events[1].FallbackKind != "choose_visit" || len(e.asked) != 0 {
		t.Errorf("batch %+v asked %v", b, e.asked)
	}

	// Without permission for claim checks, a claim topic is dropped, not stored.
	e = newFenv(t)
	e.allowed = false
	w = e.events(event("topic_selected", `,"topic":"claim","input":"typed"`), event("topic_selected", `,"topic":"claim","input":"button"`))
	if w.Code != http.StatusAccepted || len(e.store.batches) != 0 || len(e.asked) != 1 || e.asked[0] != PermEvaluate {
		t.Errorf("claim without permission: %d batches %d asked %v", w.Code, len(e.store.batches), e.asked)
	}

	many := make([]string, maxEventsPerBatch+1)
	for i := range many {
		many[i] = event("fallback_shown", `,"fallback_kind":"help"`)
	}
	for name, w := range map[string]*httptest.ResponseRecorder{
		"unknown type":   newFenv(t).events(event("page_viewed", "")),
		"schema 2":       newFenv(t).events(strings.Replace(event("fallback_shown", `,"fallback_kind":"help"`), `"schema_version":1`, `"schema_version":2`, 1)),
		"topic+fallback": newFenv(t).events(event("topic_selected", `,"topic":"labs","input":"button","fallback_kind":"help"`)),
		"text field":     newFenv(t).events(event("topic_selected", `,"topic":"labs","input":"button","text":"pasien"`)),
		"old client_at":  newFenv(t).events(strings.Replace(event("fallback_shown", `,"fallback_kind":"help"`), "2026-11-09T10:14", "2026-10-01T10:14", 1)),
		"too many":       newFenv(t).events(many...),
		"none":           newFenv(t).events(),
	} {
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", name, w.Code, w.Body.String())
		}
	}
}

func TestFeedbackRoutesNeedASession(t *testing.T) {
	e := newFenv(t)
	mux := http.NewServeMux()
	e.h.Register(mux)
	for _, rq := range []*http.Request{
		httptest.NewRequest(http.MethodPost, "/api/v1/assistant/feedback", strings.NewReader(findingBody(""))),
		httptest.NewRequest(http.MethodGet, "/api/v1/assistant/feedback/summary?rule_set=claim-readiness", nil),
		httptest.NewRequest(http.MethodGet, "/api/v1/assistant/feedback/comments?rule_set=claim-readiness", nil),
		httptest.NewRequest(http.MethodPost, "/api/v1/assistant/events", strings.NewReader(`{"events":[]}`)),
	} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, rq)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a session: %d", rq.Method, rq.URL.Path, w.Code)
		}
	}
	if len(e.store.submitted)+len(e.store.summaryQ)+len(e.store.commentQ)+len(e.store.batches) != 0 {
		t.Error("nothing reaches the store without a session")
	}
}
