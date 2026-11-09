package tariffs

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

	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

func r(vals ...string) []*string {
	out := make([]*string, len(vals))
	for i, v := range vals {
		if v != "<nil>" {
			v := v
			out[i] = &v
		}
	}
	return out
}

// Synthetic tariff rows (head: code, name, category code/name, payer code/name, place code/name, class, unit, status).
func outpatientRow(code string) []*string {
	return r(code, "Konsultasi", "K01", "Konsultasi", "UMU", "UMUM", "P01", "Poli Umum", "<nil>", "<nil>", "1",
		"0.00", "0.00", "50000.00", "0.00", "0.00", "5000.00", "55000.00", "0.00", "55000.00")
}

type fakeReader struct {
	down   bool
	rows   legacyhms.TextRows
	filter legacyhms.TariffFilter
}

func (f *fakeReader) List(_ context.Context, _ legacyhms.TariffKind, filter legacyhms.TariffFilter) (legacyhms.TextRows, error) {
	f.filter = filter
	if f.down {
		return nil, errors.New("legacy down")
	}
	return f.rows, nil
}

func (f *fakeReader) LabItems(_ context.Context, code string) (legacyhms.TextRows, bool, error) {
	return legacyhms.TextRows{r("11", "Hemoglobin", "g/dL", "1000.00", "0.00", "0.00", "0.00", "4000.00", "0.00", "0.00", "5000.00")}, false, nil
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
	return NewHandler(rd, au, iam.NewHandler(nil, iam.HTTPOptions{PublicOrigin: u}), slog.New(slog.NewTextHandler(io.Discard, nil))), rd, au
}

func call(fn http.HandlerFunc, target string, path map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req = req.WithContext(iam.WithPrincipal(req.Context(), iam.Principal{UserID: "user-1", OrganizationID: "org-1", FacilityID: "fac-1"}))
	for k, v := range path {
		req.SetPathValue(k, v)
	}
	w := httptest.NewRecorder()
	fn(w, req)
	return w
}

func TestMapItem(t *testing.T) {
	k, _ := legacyhms.TariffKindNamed("outpatient_procedure")
	it := MapItem(k, outpatientRow("RJ001"))
	if it.Code != "RJ001" || *it.Name != "Konsultasi" || it.Category.Code != "K01" || it.Payer.Code != "UMU" ||
		it.Place == nil || it.Place.Type != "clinic" || it.Place.Code != "P01" || it.Class != nil || !it.Active {
		t.Errorf("head: %+v", it)
	}
	if len(it.Components) != 6 || it.Components[2].Name != "doctor_fee" || it.Components[2].Amount != "50000.00" ||
		len(it.Prices) != 3 || it.Prices[0].Name != "doctor" || it.Prices[2].Amount != "55000.00" {
		t.Errorf("amounts: %+v %+v", it.Components, it.Prices)
	}
	d, _ := legacyhms.TariffKindNamed("drug")
	row := r("B001", "Parasetamol", "J01", "Obat", "<nil>", "<nil>", "<nil>", "<nil>", "<nil>", "Tablet", "0",
		"450.00", "460.00", "470.00", "480.00", "490.00", "500.00", "510.00", "600.00", "650.00", "420.00")
	drug := MapItem(d, row)
	if drug.Payer != nil || drug.Place != nil || *drug.Unit != "Tablet" || drug.Active || len(drug.Components) != 0 ||
		len(drug.Prices) != 10 || drug.Prices[9].Name != "karyawan" || drug.Prices[9].Amount != "420.00" {
		t.Errorf("drug: %+v", drug)
	}
}

func TestFiltersAreValidatedPerKind(t *testing.T) {
	h, rd, _ := newHandler()
	for target, want := range map[string]int{
		"/x?payer=UMU&place=P01&q=konsul&status=all&limit=10": 200,
		"/x?class=Kelas%201":              400, // outpatient procedures have no class
		"/x?payer=TOOLONG":                400,
		"/x?status=deleted":               400,
		"/x?limit=101":                    400,
		"/x?q=" + strings.Repeat("a", 65): 400,
		"/x?after=a%00b":                  400,
	} {
		w := call(h.list, target, map[string]string{"kind": "outpatient_procedure"})
		if w.Code != want {
			t.Errorf("%s: %d, want %d", target, w.Code, want)
		}
	}
	_ = call(h.list, "/x?payer=UMU&place=P01&q=konsul&status=all&limit=10", map[string]string{"kind": "outpatient_procedure"})
	if f := rd.filter; f.Payer != "UMU" || f.Place != "P01" || f.Query != "konsul" || f.Status != "all" || f.Limit != 10 {
		t.Errorf("filter: %+v", f)
	}
	_ = call(h.list, "/x", map[string]string{"kind": "drug"})
	if rd.filter.Status != "active" || rd.filter.Limit != 50 {
		t.Errorf("defaults: %+v", rd.filter)
	}
	if w := call(h.list, "/x?payer=UMU", map[string]string{"kind": "drug"}); w.Code != 400 {
		t.Errorf("drugs have no payer: %d", w.Code)
	}
	if w := call(h.list, "/x", map[string]string{"kind": "parking"}); w.Code != 404 {
		t.Errorf("unknown kind: %d", w.Code)
	}
}

func TestListPagesAuditsAndFailsClosed(t *testing.T) {
	h, rd, au := newHandler()
	rd.rows = legacyhms.TextRows{outpatientRow("RJ001"), outpatientRow("RJ002")}
	w := call(h.list, "/x?limit=2", map[string]string{"kind": "outpatient_procedure"})
	var body struct {
		Items     []Item `json:"items"`
		NextAfter string `json:"next_after"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != 200 || len(body.Items) != 2 || body.NextAfter != "RJ002" {
		t.Errorf("page: %d %s", w.Code, w.Body.String())
	}
	if ev := au.events[0]; ev.Action != "tariff.search" || ev.ResourceType != "Tariff" || ev.ResourceID != "outpatient_procedure" ||
		ev.Detail["results"] != "2" || ev.Category != "data_access" {
		t.Errorf("audit: %+v", ev)
	}
	if w := call(h.list, "/x?limit=3", map[string]string{"kind": "outpatient_procedure"}); strings.Contains(w.Body.String(), "next_after") {
		t.Error("a short page is the last page")
	}
	au.fail = true
	if w := call(h.list, "/x", map[string]string{"kind": "outpatient_procedure"}); w.Code != 503 || strings.Contains(w.Body.String(), "RJ001") {
		t.Errorf("audit down must withhold data: %d", w.Code)
	}
	au.fail, rd.down = false, true
	if w := call(h.list, "/x", map[string]string{"kind": "outpatient_procedure"}); w.Code != 503 {
		t.Errorf("legacy down: %d", w.Code)
	}
}

func TestLabItemsAndKinds(t *testing.T) {
	h, _, au := newHandler()
	w := call(h.labItems, "/x", map[string]string{"code": "LAB01"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"template_id":11`) || !strings.Contains(w.Body.String(), `"price":"5000.00"`) ||
		au.events[0].ResourceID != "laboratory:LAB01" {
		t.Errorf("lab items: %d %s", w.Code, w.Body.String())
	}
	if w := call(h.labItems, "/x", map[string]string{"code": "x' OR 1"}); w.Code != 404 {
		t.Errorf("malformed code: %d", w.Code)
	}
	w = call(h.kinds, "/x", nil)
	if w.Code != 200 || strings.Count(w.Body.String(), `"kind":`) != 6 || !strings.Contains(w.Body.String(), `"place":"ward"`) {
		t.Errorf("kinds: %s", w.Body.String())
	}
}
