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

	"hms/services/assistant/rules"
	"hms/services/clinical"
	"hms/services/core/httpx"
	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

const (
	origin = "https://hms.test.invalid"
	number = "2026/10/26/000123"
)

func s(v string) *string { return &v }

// fakeReader is a synthetic legacy HMS with one inpatient BPJS visit (two rooms, a doctor action, coded data and an
// inpatient SEP with its discharge date).
type fakeReader struct {
	down     bool
	calls    int
	sections legacyhms.SectionRows
}

func (f *fakeReader) Timeline(_ context.Context, n string) (legacyhms.SectionRows, error) {
	f.calls++
	if f.down {
		return legacyhms.SectionRows{}, errors.New("legacy down")
	}
	if n != number {
		return legacyhms.SectionRows{}, legacyhms.ErrNotFound
	}
	return f.sections, nil
}

func visitRows(payer string) legacyhms.SectionRows {
	return legacyhms.SectionRows{Rows: map[string]legacyhms.TextRows{
		"header": {{s("000001"), s("Ranap"), s("Sudah"), s(payer), s("BPJS KESEHATAN"), nil, s("001"), s("2026-10-26"),
			s("08:15:00"), s("Penyakit Dalam"), s("dr. Contoh")}},
		"room_stay": {
			{s("2026-10-26"), s("09:00:00"), s("K1"), s("Kelas 1"), s("Melati"), s("Observasi"), nil, s("2026-10-27"),
				s("09:00:00"), s("1"), s("Pindah Kamar")},
			{s("2026-10-27"), s("09:00:00"), s("K2"), s("Kelas 1"), s("Mawar"), nil, s("Hipertensi"), s("2026-10-30"),
				s("10:00:00"), s("3"), s("Sembuh")},
		},
		"procedure_rawat_inap_dr": {{s("2026-10-27"), s("10:00:00"), s("RI01"), s("Visite dokter"), s("dr. Contoh"), nil}},
		"diagnosis":               {{s("I10"), s("Essential hypertension"), s("Ranap"), s("1"), s("Baru")}},
		"coded_procedure":         {{s("89.7"), s("General physical examination"), s("Ranap"), s("1")}},
		"discharge_summary": {{s("dr. Contoh"), s("keluhan"), s("perjalanan"), s("I10"), s("Hipertensi"), s(""), nil,
			s(""), nil, s(""), s("Membaik"), s("Atas Persetujuan Dokter"), s(""), s(""), s(""), nil}},
		// Column order: legacyhms.SEPColumns.
		"sep": {{s("0301R0011026V000123"), s("2026-10-26"), s("1"), s("1"), s("030101021026P000999"),
			s("Puskesmas Contoh"), s("I10"), s("Hipertensi"), nil, s("dr. Contoh"), s("2026-10-30 10:00:00"),
			s("0. Tidak"), s("0. Tidak"), s("")}},
	}, Truncated: []string{}}
}

type fakeAudit struct {
	fail   bool
	events []audit.Event
}

func (a *fakeAudit) WriteAudit(_ context.Context, ev audit.Event) error {
	if a.fail {
		return errors.New("audit down")
	}
	a.events = append(a.events, ev)
	return nil
}

type env struct {
	h       *Handler
	read    *fakeReader
	audit   *fakeAudit
	allowed bool
	canErr  error
	asked   []string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	loc, _ := time.LoadLocation("Asia/Jakarta")
	u, _ := url.Parse(origin)
	ih := iam.NewHandler(nil, iam.HTTPOptions{PublicOrigin: u})
	e := &env{read: &fakeReader{sections: visitRows("BPJ")}, audit: &fakeAudit{}, allowed: true}
	e.h = NewHandler(e.read, e.audit, ih, loc, slog.New(slog.NewTextHandler(io.Discard, nil)))
	e.h.now = func() time.Time { return time.Date(2026, 11, 9, 3, 15, 0, 0, time.UTC) }
	e.h.newID = func() string { return "0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a90" }
	e.h.can = func(_ *http.Request, perm string) (bool, error) {
		e.asked = append(e.asked, perm)
		return e.allowed, e.canErr
	}
	return e
}

// post calls evaluate as RequireSession/RequirePermission would after letting the request through.
func (e *env) post(body string, edit ...func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/assistant/rules/evaluate", strings.NewReader(body))
	r.Header.Set("Origin", origin)
	r.Header.Set("Content-Type", "application/json")
	r = r.WithContext(iam.WithPrincipal(r.Context(), iam.Principal{UserID: "user-1", OrganizationID: "org-1", FacilityID: "fac-1"}))
	for _, f := range edit {
		f(r)
	}
	w := httptest.NewRecorder()
	e.h.evaluate(w, r)
	return w
}

func body(id string) string {
	return `{"rule_set":{"id":"claim-readiness"},"context":{"references":[{"resource_type":"encounter","resource_id":"` + id + `"}]}}`
}

func errorCode(w *httptest.ResponseRecorder) string {
	var b httpx.ErrorBody
	_ = json.Unmarshal(w.Body.Bytes(), &b)
	return b.Error.Code
}

func TestEvaluatesClaimReadinessFromTheTimeline(t *testing.T) {
	e := newEnv(t)
	w := e.post(body(number))
	if w.Code != 200 {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	var got Evaluation
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.EvaluationID != "0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a90" || got.EvaluatedAt != "2026-11-09T10:15:00+07:00" ||
		got.RuleSet != (RuleSetRef{"claim-readiness", 3}) || got.Reference != (Reference{"encounter", number}) {
		t.Errorf("envelope %+v", got)
	}
	// BPJS: an inpatient SEP with its discharge date, and everything else recorded (last room: 3 days, Sembuh).
	if got.Status != rules.StatusComplete || got.Summary != (rules.Summary{Passed: 9}) ||
		len(got.Findings) != 9 || got.Findings[0].RuleID != rules.RuleSEPPresent || !got.DataCompleteness.Complete {
		t.Errorf("outcome %+v", got.Outcome)
	}
	for _, leak := range []string{"I10", "BPJS KESEHATAN", "000001", "Hipertensi", "Sembuh", "dr. Contoh",
		"0301R0011026V000123", "030101021026P000999", "Puskesmas"} {
		if strings.Contains(w.Body.String(), leak) {
			t.Errorf("record value %q in the response", leak)
		}
	}
	if len(e.asked) != 1 || e.asked[0] != clinical.PermClinicalRead {
		t.Errorf("data permission checked: %v", e.asked)
	}
	ev := e.audit.events[0]
	if len(e.audit.events) != 1 || ev.Action != "assistant.rules.evaluate" || ev.Outcome != "success" ||
		ev.Category != "data_access" || ev.ResourceType != "Encounter" || ev.ResourceID != number || ev.ActorID != "user-1" ||
		ev.FacilityID != "fac-1" || ev.Detail["evaluation_id"] != got.EvaluationID || ev.Detail["status"] != "complete" ||
		ev.Detail["failed"] != "0" || ev.Detail["not_evaluated"] != "0" || ev.Detail["rule_set"] != "claim-readiness" ||
		ev.Detail["version"] != "3" {
		t.Errorf("audit %+v", e.audit.events)
	}
	d, _ := json.Marshal(ev.Detail)
	if strings.Contains(string(d), "I10") || strings.Contains(string(d), "BPJ") {
		t.Errorf("audit detail holds a value: %s", d)
	}
}

func TestVisitOfReadsTheLastRoomAndDoctorActions(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Jakarta")
	rows := visitRows("A09")
	rows.Rows["procedure_rawat_inap_pr"] = legacyhms.TextRows{{s("2026-10-27"), s("11:00:00"), s("RI02"), nil, nil, s("Perawat")}}
	v := VisitOf(clinical.MapTimeline(number, rows, loc))
	if v.CareSetting != "inpatient" || v.PayerCode != "A09" || len(v.Diagnoses) != 1 || !v.HasDischargeSummary ||
		v.SummaryMainDiagnosis != "I10" || v.CodedProcedures != 1 || v.DoctorProcedures != 1 || len(v.RoomStays) != 2 ||
		*v.RoomStays[1].DischargeStatus != "Sembuh" || *v.RoomStays[1].LengthOfStay != "3" {
		t.Errorf("visit %+v", v)
	}
}

func TestNonClaimablePayerIsNotApplicable(t *testing.T) {
	e := newEnv(t)
	e.read.sections = visitRows("UMU")
	w := e.post(body(number))
	var got Evaluation
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != 200 || got.Status != rules.StatusNotApplicable || got.Applicability.Applies ||
		!strings.Contains(w.Body.String(), `"findings":[]`) {
		t.Errorf("%d %s", w.Code, w.Body.String())
	}
}

func TestRejectsBadRequestsBeforeAnyRead(t *testing.T) {
	ref := `{"resource_type":"encounter","resource_id":"` + number + `"}`
	cases := map[string]struct{ body, code string }{
		"malformed":         {`{"rule_set":`, "invalid_request"},
		"unknown field":     {`{"rule_set":{"id":"claim-readiness"},"context":{"references":[` + ref + `]},"prompt":"x"}`, "invalid_request"},
		"unknown ref field": {`{"rule_set":{"id":"claim-readiness"},"context":{"references":[{"resource_type":"encounter","resource_id":"` + number + `","patient":"1"}]}}`, "invalid_request"},
		"trailing data":     {body(number) + `{}`, "invalid_request"},
		"no rule set":       {`{"context":{"references":[` + ref + `]}}`, "invalid_request"},
		"unknown rule set":  {`{"rule_set":{"id":"tariff-check"},"context":{"references":[` + ref + `]}}`, "unsupported_rule_set"},
		"retired version":   {`{"rule_set":{"id":"claim-readiness","version":2},"context":{"references":[` + ref + `]}}`, "unsupported_rule_set"},
		"no reference":      {`{"rule_set":{"id":"claim-readiness"},"context":{"references":[]}}`, "invalid_request"},
		"two references":    {`{"rule_set":{"id":"claim-readiness"},"context":{"references":[` + ref + `,` + ref + `]}}`, "invalid_request"},
		"patient reference": {`{"rule_set":{"id":"claim-readiness"},"context":{"references":[{"resource_type":"patient","resource_id":"000001"}]}}`, "invalid_request"},
		"bad encounter id":  {body(`1' OR '1'='1`), "invalid_request"},
		"oversize body":     {`{"rule_set":{"id":"claim-readiness"},"context":{"references":[` + ref + `]},"x":"` + strings.Repeat("a", maxBody) + `"}`, "invalid_request"},
	}
	for name, c := range cases {
		e := newEnv(t)
		w := e.post(c.body)
		if w.Code != 400 || errorCode(w) != c.code {
			t.Errorf("%s: %d %s", name, w.Code, w.Body.String())
		}
		if e.read.calls != 0 || len(e.audit.events) != 0 || len(e.asked) != 0 {
			t.Errorf("%s: nothing may be read, checked or audited", name)
		}
	}
	e := newEnv(t)
	if w := e.post(`{"rule_set":{"id":"claim-readiness","version":3},"context":{"references":[` + ref + `]}}`); w.Code != 200 {
		t.Errorf("the active version is accepted: %d", w.Code)
	}
}

func TestDataPermissionIsCheckedBeforeLookup(t *testing.T) {
	e := newEnv(t)
	e.allowed = false
	w := e.post(body("2099/01/01/999999")) // does not exist: the answer must not reveal that
	if w.Code != 403 || errorCode(w) != "reference_forbidden" || e.read.calls != 0 {
		t.Errorf("%d %s calls %d", w.Code, w.Body.String(), e.read.calls)
	}
	if ev := e.audit.events[0]; ev.Outcome != "denied" || ev.Detail["reason"] != "reference_forbidden" {
		t.Errorf("denial audited: %+v", ev)
	}
	e = newEnv(t)
	e.canErr = errors.New("iam down")
	if w := e.post(body(number)); w.Code != 503 || e.read.calls != 0 {
		t.Errorf("authorization outage: %d", w.Code)
	}
}

func TestNotFoundOutageAndFailClosed(t *testing.T) {
	e := newEnv(t)
	w := e.post(body("2099/01/01/999999"))
	if w.Code != 404 || errorCode(w) != "reference_not_found" {
		t.Errorf("not found: %d %s", w.Code, w.Body.String())
	}
	if ev := e.audit.events[0]; ev.Outcome != "failure" || ev.Detail["reason"] != "not_found" || ev.ResourceID != "2099/01/01/999999" {
		t.Errorf("not found audited as failure: %+v", ev)
	}

	e = newEnv(t)
	e.read.down = true
	if w := e.post(body(number)); w.Code != 503 || len(e.audit.events) != 0 {
		t.Errorf("legacy outage: %d %+v", w.Code, e.audit.events)
	}

	e = newEnv(t)
	e.audit.fail = true
	if w := e.post(body(number)); w.Code != 503 || strings.Contains(w.Body.String(), "findings") {
		t.Errorf("no audit, no result: %d %s", w.Code, w.Body.String())
	}
}

func TestStateChangeChecksAndRateLimit(t *testing.T) {
	e := newEnv(t)
	if w := e.post(body(number), func(r *http.Request) { r.Header.Set("Origin", "https://evil.invalid") }); w.Code != 403 ||
		errorCode(w) != "origin_not_allowed" {
		t.Errorf("foreign origin: %d %s", w.Code, w.Body.String())
	}
	if w := e.post(body(number), func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }); w.Code != 415 {
		t.Errorf("form post: %d", w.Code)
	}

	e = newEnv(t)
	e.h.limiter = httpx.NewWindowLimiter(2, time.Minute, time.Now)
	for i := 0; i < 2; i++ {
		if w := e.post(body(number)); w.Code != 200 {
			t.Fatalf("request %d: %d", i, w.Code)
		}
	}
	w := e.post(body(number))
	if w.Code != 429 || errorCode(w) != "too_many_requests" || w.Header().Get("Retry-After") == "" {
		t.Errorf("limit: %d %s", w.Code, w.Body.String())
	}
	other := e.post(body(number), func(r *http.Request) {
		*r = *r.WithContext(iam.WithPrincipal(r.Context(), iam.Principal{UserID: "user-2", FacilityID: "fac-1"}))
	})
	if other.Code != 200 {
		t.Errorf("the limit is per user: %d", other.Code)
	}
}

func TestRuleSetsAndRoutes(t *testing.T) {
	e := newEnv(t)
	w := httptest.NewRecorder()
	e.h.ruleSets(w, httptest.NewRequest(http.MethodGet, "/api/v1/assistant/rule-sets", nil))
	var got struct {
		RuleSets []map[string]any `json:"rule_sets"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != 200 || len(got.RuleSets) != 1 || got.RuleSets[0]["id"] != "claim-readiness" ||
		got.RuleSets[0]["version"] != float64(3) || got.RuleSets[0]["max_references"] != float64(1) ||
		len(got.RuleSets[0]["rules"].([]any)) != 9 {
		t.Errorf("rule sets: %s", w.Body.String())
	}

	mux := http.NewServeMux()
	e.h.Register(mux)
	for _, rq := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/api/v1/assistant/rule-sets", nil),
		httptest.NewRequest(http.MethodPost, "/api/v1/assistant/rules/evaluate", strings.NewReader(body(number))),
	} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, rq)
		if w.Code != 401 {
			t.Errorf("%s %s without a session: %d", rq.Method, rq.URL.Path, w.Code)
		}
	}
	if e.read.calls != 0 {
		t.Error("nothing read without a session")
	}
	if len(Permissions) != 1 || Permissions[0].Code != PermEvaluate {
		t.Errorf("permissions %+v", Permissions)
	}
}
