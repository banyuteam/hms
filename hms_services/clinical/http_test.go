package clinical

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

	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

// fakeReader is a synthetic legacy HMS.
type fakeReader struct {
	down       bool
	gotWords   []string
	gotBefore  string
	encounters []legacyhms.EncounterRow
	sections   legacyhms.SectionRows
	// payer history
	payerVisits []legacyhms.PayerVisitRow
	gotLimit    int
}

func (f *fakeReader) err() error {
	if f.down {
		return errors.New("legacy down")
	}
	return nil
}

func (f *fakeReader) Patient(_ context.Context, mrn string) (legacyhms.PatientRow, error) {
	if f.down {
		return legacyhms.PatientRow{}, f.err()
	}
	if mrn != "000001" {
		return legacyhms.PatientRow{}, legacyhms.ErrNotFound
	}
	return row(), nil
}

func (f *fakeReader) Identifiers(_ context.Context, mrn string) (legacyhms.IdentifierRow, error) {
	if mrn != "000001" {
		return legacyhms.IdentifierRow{}, legacyhms.ErrNotFound
	}
	r := row()
	return legacyhms.IdentifierRow{NIK: r.NIK, Phone: r.Phone, Email: s("-")}, f.err()
}

func (f *fakeReader) SearchPatients(_ context.Context, words []string, _ int) ([]legacyhms.PatientHitRow, error) {
	f.gotWords = words
	return []legacyhms.PatientHitRow{{MRN: s("000001"), Name: s("Pasien Contoh"), Sex: s("P")}}, f.err()
}

func (f *fakeReader) Encounter(_ context.Context, number string) (legacyhms.EncounterRow, error) {
	if number != "2026/10/26/000123" {
		return legacyhms.EncounterRow{}, legacyhms.ErrNotFound
	}
	return legacyhms.EncounterRow{Number: s(number), CareSetting: s("Ralan")}, f.err()
}

func (f *fakeReader) PatientEncounters(_ context.Context, _, before string, limit int) ([]legacyhms.EncounterRow, error) {
	f.gotBefore = before
	if len(f.encounters) > limit {
		return f.encounters[:limit], f.err()
	}
	return f.encounters, f.err()
}

func (f *fakeReader) SearchEncounters(context.Context, string, int) ([]legacyhms.EncounterRow, error) {
	return nil, f.err()
}

func (f *fakeReader) PayerVisits(_ context.Context, _ string, limit int) ([]legacyhms.PayerVisitRow, error) {
	f.gotLimit = limit
	if len(f.payerVisits) > limit {
		return f.payerVisits[:limit], f.err()
	}
	return f.payerVisits, f.err()
}

func (f *fakeReader) Timeline(_ context.Context, number string) (legacyhms.SectionRows, error) {
	if number != "2026/10/26/000123" {
		return legacyhms.SectionRows{}, legacyhms.ErrNotFound
	}
	return f.sections, f.err()
}

func (f *fakeReader) Bill(_ context.Context, number string) (legacyhms.SectionRows, error) {
	if number != "2026/10/26/000123" {
		return legacyhms.SectionRows{}, legacyhms.ErrNotFound
	}
	return f.sections, f.err()
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
	h     *Handler
	read  *fakeReader
	audit *fakeAudit
}

func newEnv(t *testing.T) *env {
	t.Helper()
	loc, _ := time.LoadLocation("Asia/Jakarta")
	u, _ := url.Parse("https://hms.test.invalid")
	ih := iam.NewHandler(nil, iam.HTTPOptions{PublicOrigin: u})
	e := &env{read: &fakeReader{}, audit: &fakeAudit{}}
	e.h = NewHandler(e.read, e.audit, ih, loc, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return e
}

// call invokes a handler as RequireSession/RequirePermission would after letting the request through.
func call(fn http.HandlerFunc, target string, path map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, target, nil)
	r = r.WithContext(iam.WithPrincipal(r.Context(), iam.Principal{UserID: "user-1", OrganizationID: "org-1", FacilityID: "fac-1"}))
	for k, v := range path {
		r.SetPathValue(k, v)
	}
	w := httptest.NewRecorder()
	fn(w, r)
	return w
}

func TestPatientIsMaskedAndAudited(t *testing.T) {
	e := newEnv(t)
	w := call(e.h.patient, "/api/v1/patients/000001", map[string]string{"mrn": "000001"})
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	body := w.Body.String()
	for _, secret := range []string{"3273010210850002", "081234563344", "contoh@example.com", "Jl. Melati No. 12"} {
		if strings.Contains(body, secret) {
			t.Errorf("full value %q sent to the client", secret)
		}
	}
	var p Patient
	_ = json.Unmarshal(w.Body.Bytes(), &p)
	if p.NIK.Masked != "3273••••••••0002" || p.Name != "Pasien Contoh" {
		t.Errorf("unexpected body %+v", p)
	}
	ev := e.audit.events[0]
	if ev.Action != "patient.read" || ev.Outcome != "success" || ev.ResourceID != "000001" || ev.ActorID != "user-1" ||
		ev.Category != "data_access" || ev.FacilityID != "fac-1" {
		t.Errorf("unexpected audit %+v", ev)
	}
}

func TestFailClosedAndFailures(t *testing.T) {
	e := newEnv(t)
	e.audit.fail = true
	w := call(e.h.patient, "/", map[string]string{"mrn": "000001"})
	if w.Code != 503 || strings.Contains(w.Body.String(), "Pasien") {
		t.Errorf("audit failure must withhold data: %d %s", w.Code, w.Body.String())
	}

	e = newEnv(t)
	if w := call(e.h.patient, "/", map[string]string{"mrn": "999999"}); w.Code != 404 {
		t.Errorf("missing patient: %d", w.Code)
	}
	if ev := e.audit.events[0]; ev.Outcome != "failure" || ev.Detail["reason"] != "not_found" || ev.ResourceID != "999999" {
		t.Errorf("a lookup of a missing record is audited as a failure: %+v", ev)
	}
	if w := call(e.h.patient, "/", map[string]string{"mrn": "../etc"}); w.Code != 404 {
		t.Errorf("malformed MRN: %d", w.Code)
	}
	e.read.down = true
	if w := call(e.h.patient, "/", map[string]string{"mrn": "000001"}); w.Code != 503 {
		t.Errorf("legacy outage: %d", w.Code)
	}
	if len(e.audit.events) != 1 {
		t.Errorf("an outage reads nothing, so nothing is audited as read: %+v", e.audit.events)
	}
}

func TestSearchValidatesAndNeverAuditsTheText(t *testing.T) {
	e := newEnv(t)
	for _, q := range []string{"a", strings.Repeat("x", 65), "a b c d e f", "ab\x00cd", ""} {
		if w := call(e.h.searchPatients, "/api/v1/patients?q="+url.QueryEscape(q), nil); w.Code != 400 {
			t.Errorf("q %q: %d", q, w.Code)
		}
	}
	if w := call(e.h.searchPatients, "/api/v1/patients?q=x&limit=26", nil); w.Code != 400 {
		t.Errorf("limit above 25 accepted: %d", w.Code)
	}
	w := call(e.h.searchPatients, "/api/v1/patients?q="+url.QueryEscape("  Pasien CONTOH pasien "), nil)
	if w.Code != 200 || len(e.read.gotWords) != 2 {
		t.Fatalf("status %d words %v", w.Code, e.read.gotWords)
	}
	ev := e.audit.events[0]
	if ev.Action != "patient.search" || ev.Detail["results"] != "1" || strings.Contains(strings.ToLower(fmtDetail(ev)), "pasien") {
		t.Errorf("search audit must hold the count, never the text: %+v", ev)
	}
}

func fmtDetail(ev audit.Event) string {
	b, _ := json.Marshal(ev.Detail)
	return string(b)
}

func TestRevealIsAuditedBeforeTheValue(t *testing.T) {
	e := newEnv(t)
	w := call(e.h.identifier, "/", map[string]string{"mrn": "000001", "kind": "nik"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), "3273010210850002") {
		t.Fatalf("reveal: %d %s", w.Code, w.Body.String())
	}
	ev := e.audit.events[0]
	if ev.Action != "patient.identifier.reveal" || ev.Detail["kind"] != "nik" || strings.Contains(fmtDetail(ev), "3273") {
		t.Errorf("reveal audit: %+v", ev)
	}
	if w := call(e.h.identifier, "/", map[string]string{"mrn": "000001", "kind": "email"}); w.Code != 404 {
		t.Errorf(`"-" e-mail is not recorded: %d`, w.Code)
	}
	if w := call(e.h.identifier, "/", map[string]string{"mrn": "000001", "kind": "password"}); w.Code != 404 {
		t.Errorf("unknown kind: %d", w.Code)
	}
	e.audit.fail = true
	if w := call(e.h.identifier, "/", map[string]string{"mrn": "000001", "kind": "nik"}); w.Code != 503 ||
		strings.Contains(w.Body.String(), "3273") {
		t.Errorf("no audit, no value: %d %s", w.Code, w.Body.String())
	}
}

func TestEncounterPagingAndLookup(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 3; i++ {
		e.read.encounters = append(e.read.encounters, legacyhms.EncounterRow{Number: s("2026/10/2" + string(rune('9'-i)) + "/000001"),
			RegDate: s("2026-10-26"), RegTime: s("08:15:00"), CareSetting: s("Ranap")})
	}
	w := call(e.h.patientEncounters, "/api/v1/patients/000001/encounters?limit=2", map[string]string{"mrn": "000001"})
	var page struct {
		Encounters []Encounter `json:"encounters"`
		NextBefore string      `json:"next_before"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &page)
	if w.Code != 200 || len(page.Encounters) != 2 || page.NextBefore != "2026/10/28/000001" ||
		*page.Encounters[0].RegisteredAt != "2026-10-26T08:15:00+07:00" {
		t.Fatalf("page: %d %+v", w.Code, page)
	}
	call(e.h.patientEncounters, "/x?before="+url.QueryEscape(page.NextBefore), map[string]string{"mrn": "000001"})
	if e.read.gotBefore != "2026/10/28/000001" {
		t.Errorf("before not passed: %q", e.read.gotBefore)
	}
	if w := call(e.h.patientEncounters, "/x?before=drop%20table", map[string]string{"mrn": "000001"}); w.Code != 400 {
		t.Errorf("bad before: %d", w.Code)
	}
	if w := call(e.h.encounter, "/", map[string]string{"number": "2026/10/26/000123"}); w.Code != 200 {
		t.Errorf("encounter: %d", w.Code)
	}
	if w := call(e.h.searchEncounters, "/api/v1/encounters?q=20", nil); w.Code != 400 {
		t.Errorf("prefix too short: %d", w.Code)
	}
}

func visit(number, date, tm, payer string, name *string) legacyhms.PayerVisitRow {
	return legacyhms.PayerVisitRow{Number: s(number), RegDate: s(date), RegTime: s(tm), CareSetting: s("Ralan"),
		Status: s("Sudah"), PayerCode: s(payer), PayerName: name}
}

func TestPayerHistoryGroupsByPayerLatestFirst(t *testing.T) {
	e := newEnv(t)
	// As the reader returns them: latest registration first.
	e.read.payerVisits = []legacyhms.PayerVisitRow{
		visit("2026/10/26/000123", "2026-10-26", "08:15:00", "BPJ", s("BPJS KESEHATAN")),
		visit("2026/09/01/000010", "2026-09-01", "10:00:00", "A01", s("UMUM")),
		visit("2026/08/14/000051", "2026-08-14", "09:30:00", "BPJ", s("BPJS KESEHATAN")),
		visit("2026/07/02/000002", "0000-00-00", "00:00:00", "-", nil),
		visit("2026/06/01/000001", "2026-06-01", "07:00:00", "X99", nil),
	}
	w := call(e.h.patientPayers, "/api/v1/patients/000001/payers", map[string]string{"mrn": "000001"})
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	var got PayerHistory
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if len(got.Payers) != 4 || got.Truncated {
		t.Fatalf("payers: %+v", got)
	}
	codes := []string{got.Payers[0].Code, got.Payers[1].Code, got.Payers[2].Code, got.Payers[3].Code}
	if strings.Join(codes, ",") != "BPJ,A01,,X99" {
		t.Errorf("order by latest visit: %v", codes)
	}
	bpjs := got.Payers[0]
	if *bpjs.Name != "BPJS KESEHATAN" || bpjs.VisitCount != 2 || *bpjs.LastVisitAt != "2026-10-26T08:15:00+07:00" ||
		bpjs.Encounters[0].Number != "2026/10/26/000123" || bpjs.Encounters[1].Number != "2026/08/14/000051" ||
		*bpjs.Encounters[0].PatientMRN != "000001" || bpjs.Encounters[0].CareSetting != "outpatient" {
		t.Errorf("BPJ group: %+v", bpjs)
	}
	if none := got.Payers[2]; none.Name != nil || none.LastVisitAt != nil || none.VisitCount != 1 {
		t.Errorf(`"-" payer is "not recorded", undated visit has no time: %+v`, none)
	}
	if unknown := got.Payers[3]; unknown.Name != nil {
		t.Errorf("a code with no penjab row has no name: %+v", unknown)
	}
	if e.read.gotLimit != MaxPayerVisits+1 {
		t.Errorf("reads one more than the cap to detect truncation: %d", e.read.gotLimit)
	}
	ev := e.audit.events[0]
	if ev.Action != "patient.payers.read" || ev.ResourceID != "000001" || ev.Detail["results"] != "5" ||
		ev.Detail["payers"] != "4" || strings.Contains(fmtDetail(ev), "BPJS") {
		t.Errorf("audit holds counts only: %+v", ev)
	}
}

func TestPayerHistoryTruncatesAndFailsClosed(t *testing.T) {
	e := newEnv(t)
	for i := 0; i <= MaxPayerVisits; i++ {
		e.read.payerVisits = append(e.read.payerVisits, visit("2026/01/01/000001", "2026-01-01", "08:00:00", "BPJ", nil))
	}
	w := call(e.h.patientPayers, "/", map[string]string{"mrn": "000001"})
	var got PayerHistory
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if !got.Truncated || got.Payers[0].VisitCount != MaxPayerVisits || e.audit.events[0].Detail["truncated"] != "visits" {
		t.Errorf("truncation: %+v %+v", got.Truncated, e.audit.events[0])
	}

	e = newEnv(t)
	w = call(e.h.patientPayers, "/", map[string]string{"mrn": "000001"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"payers":[]`) {
		t.Errorf("no visits is an empty list, not null: %d %s", w.Code, w.Body.String())
	}
	if w := call(e.h.patientPayers, "/", map[string]string{"mrn": "../etc"}); w.Code != 404 {
		t.Errorf("malformed MRN: %d", w.Code)
	}
	e.audit.fail = true
	e.read.payerVisits = []legacyhms.PayerVisitRow{visit("2026/10/26/000123", "2026-10-26", "08:15:00", "BPJ", s("BPJS KESEHATAN"))}
	if w := call(e.h.patientPayers, "/", map[string]string{"mrn": "000001"}); w.Code != 503 || strings.Contains(w.Body.String(), "BPJ") {
		t.Errorf("no audit, no data: %d %s", w.Code, w.Body.String())
	}
	e = newEnv(t)
	e.read.down = true
	if w := call(e.h.patientPayers, "/", map[string]string{"mrn": "000001"}); w.Code != 503 || len(e.audit.events) != 0 {
		t.Errorf("legacy outage: %d %+v", w.Code, e.audit.events)
	}
}
