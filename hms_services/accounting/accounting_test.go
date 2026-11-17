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