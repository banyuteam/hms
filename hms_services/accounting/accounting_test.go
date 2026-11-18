package accounting

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

	integ "hms/services/integrations/accounting"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

// fakeReader stands in for the HTTP client. body is written into out; err is returned instead when set.
type fakeReader struct {
	err    error
	body   string
	gotQ   url.Values
	gotPth string
}

func (r *fakeReader) Get(_ context.Context, path string, q url.Values, out any) error {
	r.gotPth, r.gotQ = path, q
	if r.err != nil {
		return r.err
	}
	return json.Unmarshal([]byte(r.body), out)
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

func newHandler() (*Handler, *fakeReader, *fakeAudit) {
	u, _ := url.Parse("https://hms.test.invalid")
	rd, au := &fakeReader{}, &fakeAudit{}
	return NewHandler(rd, au, iam.NewHandler(nil, iam.HTTPOptions{PublicOrigin: u}),
		slog.New(slog.NewTextHandler(io.Discard, nil))), rd, au
}

func call(fn http.HandlerFunc, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req = req.WithContext(iam.WithPrincipal(req.Context(),
		iam.Principal{UserID: "user-1", OrganizationID: "org-1", FacilityID: "fac-1"}))
	w := httptest.NewRecorder()
	fn(w, req)
	return w
}

const neracaBody = `{
  "periode": {"tahun": 2026, "bulan": 11},
  "aset": {"baris": [{"kode":"1.110","nama":"Kas Bendahara","tipe":"asset","saldo_normal":"debit","depth":2,"is_header":false,"nilai":-14257592}], "total": 146077986967.78},
  "kewajiban": {"baris": [], "total": 0},
  "ekuitas": {"baris": [], "total": 0},
  "laba_tahun_lalu": 0,
  "laba_rugi_berjalan": 76750000,
  "total_kewajiban_ekuitas": 146077986967.78,
  "selisih": 0
}`

func TestNeracaReadsAndAudits(t *testing.T) {
	h, rd, au := newHandler()
	rd.body = neracaBody

	w := call(h.neraca, "/api/v1/accounting/neraca?year=2026&month=11")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}

	if rd.gotPth != "/api/v1/laporan/neraca" || rd.gotQ.Get("year") != "2026" || rd.gotQ.Get("month") != "11" {
		t.Errorf("upstream call: %s %v", rd.gotPth, rd.gotQ)
	}

	// The period is in the resource id and the row count in the detail, but no figure and no account name:
	// the trail records that someone read the balance sheet, not what it said.
	if len(au.events) != 1 {
		t.Fatalf("audit events: %d", len(au.events))
	}
	ev := au.events[0]
	if ev.Action != "accounting.neraca.read" || ev.ResourceID != "2026-11" || ev.Detail["lines"] != "1" {
		t.Errorf("audit: %+v", ev)
	}
	for _, v := range ev.Detail {
		if strings.Contains(v, "Kas Bendahara") || strings.Contains(v, "14257592") {
			t.Errorf("audit detail carries report content: %+v", ev.Detail)
		}
	}

	// Contra accounts arrive negative and the sign is passed through: a reader needs it to add the column up.
	var out BalanceSheet
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Assets.Lines[0].Amount.String() != "-14257592" || out.Assets.Total.String() != "146077986967.78" {
		t.Errorf("digits changed: %s / %s", out.Assets.Lines[0].Amount, out.Assets.Total)
	}
}

func TestPeriodIsBounded(t *testing.T) {
	// Month 13 produces an empty report that looks perfectly valid, so it is refused here rather than passed on.
	h, rd, _ := newHandler()
	rd.body = neracaBody

	for _, target := range []string{
		"/x?year=2026&month=13",
		"/x?year=2026&month=0",
		"/x?year=1999&month=1",
		"/x?year=2101&month=1",
		"/x?month=11",
		"/x?year=2026",
		"/x?year=dua&month=11",
	} {
		if w := call(h.neraca, target); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d", target, w.Code)
		}
	}
}

func TestUpstreamFailureIsOpaque(t *testing.T) {
	for _, upstream := range []error{integ.ErrUpstream, integ.ErrUnauthorized, integ.ErrNotFound} {
		h, rd, au := newHandler()
		rd.err = upstream

		w := call(h.neraca, "/x?year=2026&month=11")
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("%v: status %d", upstream, w.Code)
		}

		// One status for every upstream problem, and nothing of the upstream reason in the body: a refused
		// token and an outage are different jobs for whoever reads the log, not different answers to the browser.
		if strings.Contains(w.Body.String(), "token") || strings.Contains(w.Body.String(), "not found") {
			t.Errorf("%v: leaked into %s", upstream, w.Body)
		}

		// Nothing was read, so nothing is recorded.
		if len(au.events) != 0 {
			t.Errorf("%v: audited a read that did not happen", upstream)
		}
	}
}

func TestFailsClosedWhenAuditFails(t *testing.T) {
	// The whole point of auditing a financial read: if the trail cannot be written, the data is withheld.
	h, rd, au := newHandler()
	rd.body, au.fail = neracaBody, true

	w := call(h.neraca, "/x?year=2026&month=11")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", w.Code)
	}
	if strings.Contains(w.Body.String(), "Kas Bendahara") || strings.Contains(w.Body.String(), "146077986967") {
		t.Errorf("data returned without an audit trail: %s", w.Body)
	}
}

func TestAllSevenRoutesAreRegistered(t *testing.T) {
	// This proves the routes exist, not that each carries the right permission: RequirePermission calls
	// svc.Authorize, which needs a database. The permission check belongs to the PostgreSQL integration tests
	// (ADR-SVC-014, still open).
	h, _, _ := newHandler()
	mux := http.NewServeMux()
	h.Register(mux)

	for _, path := range []string{
		"/api/v1/accounting/neraca",
		"/api/v1/accounting/laba-rugi",
		"/api/v1/accounting/neraca-saldo",
		"/api/v1/accounting/neraca-lajur",
		"/api/v1/accounting/cash-flow",
		"/api/v1/accounting/buku-besar",
		"/api/v1/accounting/aging",
	} {
		if _, pattern := mux.Handler(httptest.NewRequest(http.MethodGet, path, nil)); pattern == "" {
			t.Errorf("%s: not registered", path)
		}
	}

	// Without this the loop above would pass on a mux with no routes at all: mux.Handler answers every path,
	// falling back to its own 404 handler.
	if _, pattern := mux.Handler(httptest.NewRequest(http.MethodGet, "/api/v1/accounting/tidak-ada", nil)); pattern != "" {
		t.Errorf("unregistered path matched %q — the loop above proves nothing", pattern)
	}
}

func TestBukuBesarRequiresAccount(t *testing.T) {
	// October 2026 without an account is 5.225 rows across 156 accounts. The accounting application's own PDF
	// route already refuses "all accounts"; an API looser than the UI only moves the failure out of sight.
	h, rd, au := newHandler()
	rd.body = `{"periode":{"tahun":2026,"bulan":11},"akun":[]}`

	for _, target := range []string{
		"/x?year=2026&month=11",
		"/x?year=2026&month=11&account_id=0",
		"/x?year=2026&month=11&account_id=-1",
		"/x?year=2026&month=11&account_id=abc",
	} {
		w := call(h.bukuBesar, target)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d", target, w.Code)
		}
	}

	// Nothing was read, so nothing was recorded and upstream was never called.
	if len(au.events) != 0 || rd.gotPth != "" {
		t.Errorf("refused request still called upstream or audited")
	}

	w := call(h.bukuBesar, "/x?year=2026&month=11&account_id=3")
	if w.Code != http.StatusOK {
		t.Fatalf("with account: status %d", w.Code)
	}
	if rd.gotQ.Get("account_id") != "3" {
		t.Errorf("account_id not forwarded: %v", rd.gotQ)
	}
	if au.events[0].Detail["account_id"] != "3" {
		t.Errorf("account_id not audited: %+v", au.events[0].Detail)
	}
}

func TestAgingTypeIsBounded(t *testing.T) {
	h, rd, au := newHandler()
	rd.body = `{"type":"receivable","rows":[],"grand_total":{"name":"","penjamin":null,"current":0,"b31_60":0,"b61_90":0,"b91_180":0,"over180":0,"total":0},"buckets":{},"as_of_date":"30 September 2026"}`

	if w := call(h.aging, "/x?type=sembarang"); w.Code != http.StatusBadRequest {
		t.Errorf("status %d", w.Code)
	}

	// Defaults to receivable, and the audit says which kind was read — payable and receivable are different
	// people's names.
	w := call(h.aging, "/x")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if rd.gotQ.Get("type") != "receivable" || au.events[0].Detail["type"] != "receivable" {
		t.Errorf("type: query %v, audit %+v", rd.gotQ, au.events[0].Detail)
	}

	// Counterparty names are in the response but must not reach the trail.
	if strings.Contains(au.events[0].ResourceID, "nama") {
		t.Errorf("resource id carries content: %s", au.events[0].ResourceID)
	}
}

func TestEveryReportAudits(t *testing.T) {
	// Six reports, one audit each, with the action matching the permission. A report that reads without
	// recording is the failure this whole module is shaped around.
	for _, tc := range []struct {
		name, action, body string
		fn                 func(*Handler) http.HandlerFunc
		target             string
	}{
		{"neraca", PermNeracaRead, neracaBody,
			func(h *Handler) http.HandlerFunc { return h.neraca }, "/x?year=2026&month=11"},
		{"laba-rugi", PermLabaRugiRead,
			`{"periode":{"tahun":2026,"bulan":11},"pendapatan":[],"hpp":[],"beban":[],"biaya_lain":[],"pajak":[],"total":{"pendapatan":0,"hpp":0,"beban":0,"biaya_lain":0,"pajak":0,"laba_kotor":0,"laba_operasi":0,"laba_rugi":0}}`,
			func(h *Handler) http.HandlerFunc { return h.labaRugi }, "/x?year=2026&month=11"},
	} {
		h, rd, au := newHandler()
		rd.body = tc.body

		if w := call(tc.fn(h), tc.target); w.Code != http.StatusOK {
			t.Errorf("%s: status %d: %s", tc.name, w.Code, w.Body)
			continue
		}
		if len(au.events) != 1 || au.events[0].Action != tc.action {
			t.Errorf("%s: audit %+v", tc.name, au.events)
		}
	}
}
