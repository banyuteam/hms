package catalogue

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

	"hms/services/platform/iam"
)

func str(v string) *string { return &v }

func TestCheckMirrorsTheDatabaseRules(t *testing.T) {
	ok := []struct {
		name                  string
		title, kind           string
		publisher, desc, link *string
		titles                []string
	}{
		{"link", " Pedoman Nasional ", TypeURL, str("Kemenkes"), nil, str("https://example.org/a?b=1"), nil},
		{"excel with data titles", "Tarif", TypeExcel, nil, str("line 1\nline 2"), nil, []string{"Sheet A", " Sheet B "}},
		{"empty optional text is absent", "PDF", TypePDF, str("  "), str(""), str(""), nil},
	}
	for _, c := range ok {
		f, err := check(c.title, c.kind, c.publisher, c.desc, c.link, c.titles)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
		}
		if f.title != strings.TrimSpace(c.title) {
			t.Errorf("%s: title not trimmed: %q", c.name, f.title)
		}
	}
	f, _ := check("PDF", TypePDF, str("  "), str(""), str(""), nil)
	if f.publisher != nil || f.description != nil || f.url != nil || f.dataTitles == nil {
		t.Errorf("blank optional text must be stored as absent: %+v", f)
	}

	bad := []struct {
		name, field, code string
		title, kind       string
		link              *string
		titles            []string
	}{
		{"blank title", "title", "required", "   ", TypePDF, nil, nil},
		{"long title", "title", "too_long", strings.Repeat("a", 301), TypePDF, nil, nil},
		{"control character", "title", "invalid_text", "a\x00b", TypePDF, nil, nil},
		{"unknown type", "type", "invalid_type", "x", "video", nil, nil},
		{"link without URL", "url", "required", "x", TypeURL, nil, nil},
		{"http link", "url", "invalid_url", "x", TypeURL, str("http://example.org"), nil},
		{"javascript link", "url", "invalid_url", "x", TypeURL, str("javascript:alert(1)"), nil},
		{"link with credentials", "url", "invalid_url", "x", TypeURL, str("https://u:p@example.org"), nil},
		{"file with URL", "url", "not_allowed", "x", TypeWord, str("https://example.org"), nil},
		{"empty data title", "data_titles", "required", "x", TypeExcel, nil, []string{"ok", " "}},
		{"too many data titles", "data_titles", "too_many", "x", TypeExcel, nil, make([]string, 201)},
	}
	for _, c := range bad {
		_, err := check(c.title, c.kind, nil, nil, c.link, c.titles)
		var ve ValidationError
		if !errors.As(err, &ve) || ve.Field != c.field || ve.Code != c.code {
			t.Errorf("%s: got %v, want %s/%s", c.name, err, c.field, c.code)
		}
	}
}

func TestFilterAndCursor(t *testing.T) {
	if _, err := ParseFilter("tarif", "excel", "", "20"); err != nil {
		t.Fatal(err)
	}
	for _, c := range [][4]string{{"", "video", "", ""}, {"", "", "", "0"}, {"", "", "", "101"}, {"", "", "not-a-cursor", ""},
		{strings.Repeat("q", 101), "", "", ""}} {
		if _, err := ParseFilter(c[0], c[1], c[2], c[3]); err == nil {
			t.Errorf("accepted %v", c)
		}
	}
	src := Source{ID: "0195f0c4-0000-7000-8000-000000000001", UpdatedAt: time.Date(2026, 11, 11, 8, 0, 0, 123456000, time.UTC)}
	ts, id, err := decodeCursor(encodeCursor(src))
	if err != nil || id != src.ID || !ts.Equal(src.UpdatedAt) {
		t.Errorf("cursor round trip: %v %s %v", ts, id, err)
	}
	if got := likePattern(`50%_off\`); got != `%50\%\_off\\%` {
		t.Errorf("ILIKE escaping: %s", got)
	}
}

type fakeStore struct {
	page    Page
	src     Source
	err     error
	deleted int
	imports []ImportDocument
	caller  Caller
}

func (f *fakeStore) List(_ context.Context, c Caller, _ Filter) (Page, error) {
	f.caller = c
	return f.page, f.err
}
func (f *fakeStore) Get(_ context.Context, c Caller, _ string) (Source, error) {
	f.caller = c
	return f.src, f.err
}
func (f *fakeStore) Create(_ context.Context, c Caller, _ Input) (Source, error) {
	f.caller = c
	return f.src, f.err
}
func (f *fakeStore) Update(_ context.Context, c Caller, _ string, _ Update) (Source, error) {
	f.caller = c
	return f.src, f.err
}
func (f *fakeStore) Delete(_ context.Context, c Caller, _ string, v int) error {
	f.caller, f.deleted = c, v
	return f.err
}
func (f *fakeStore) Import(_ context.Context, c Caller, doc ImportDocument) (int, error) {
	f.caller = c
	f.imports = append(f.imports, doc)
	return len(doc.Sources), f.err
}

const origin = "https://hms.test.invalid"

func newHandler() (*Handler, *fakeStore) {
	u, _ := url.Parse(origin)
	st := &fakeStore{}
	return NewHandler(st, iam.NewHandler(nil, iam.HTTPOptions{PublicOrigin: u}), slog.New(slog.NewTextHandler(io.Discard, nil))), st
}

func call(fn http.HandlerFunc, method, target, body string, path map[string]string) *httptest.ResponseRecorder {
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet {
		req.Header.Set("Origin", origin)
	}
	req = req.WithContext(iam.WithPrincipal(req.Context(), iam.Principal{UserID: "user-1", OrganizationID: "org-1", FacilityID: "fac-1"}))
	for k, v := range path {
		req.SetPathValue(k, v)
	}
	w := httptest.NewRecorder()
	fn(w, req)
	return w
}

func TestHandlersMapErrorsAndBodies(t *testing.T) {
	h, st := newHandler()
	st.page = Page{Items: []Source{{ID: "s1", Title: "T", Type: TypeURL, DataTitles: []string{}}}, NextAfter: "c"}
	w := call(h.list, http.MethodGet, "/x?q=tarif&type=url&limit=10", "", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"next_after":"c"`) || st.caller.OrganizationID != "org-1" {
		t.Errorf("list: %d %s %+v", w.Code, w.Body, st.caller)
	}
	if w := call(h.list, http.MethodGet, "/x?type=video", "", nil); w.Code != 400 {
		t.Errorf("bad filter: %d", w.Code)
	}

	for err, want := range map[error]int{ErrNotFound: 404, ErrVersionConflict: 409,
		ValidationError{"title", "required", "x"}: 400, errors.New("db down"): 503} {
		st.err = err
		if w := call(h.get, http.MethodGet, "/x", "", map[string]string{"id": "s1"}); w.Code != want {
			t.Errorf("%v: %d, want %d", err, w.Code, want)
		}
	}
	st.err = nil

	if w := call(h.create, http.MethodPost, "/x", `{"title":"T","type":"url","url":"https://e.org"}`, nil); w.Code != 201 {
		t.Errorf("create: %d %s", w.Code, w.Body)
	}
	if w := call(h.create, http.MethodPost, "/x", `{"title":"T","type":"url","extra":1}`, nil); w.Code != 400 {
		t.Errorf("unknown fields are refused: %d", w.Code)
	}
	if w := call(h.create, http.MethodPost, "/x", `{"title":"T","type":"url"}{"x":1}`, nil); w.Code != 400 {
		t.Errorf("trailing JSON is refused: %d", w.Code)
	}
	if w := call(h.delete, http.MethodDelete, "/x?version=3", "", map[string]string{"id": "s1"}); w.Code != 204 || st.deleted != 3 {
		t.Errorf("delete: %d %d", w.Code, st.deleted)
	}
	if w := call(h.delete, http.MethodDelete, "/x", "", map[string]string{"id": "s1"}); w.Code != 400 {
		t.Errorf("delete without version: %d", w.Code)
	}

	st.err = ImportError{Problems: []Problem{{Index: 2, Field: "url", Code: "invalid_url"}}}
	w = call(h.importDocument, http.MethodPost, "/x", `{"format":"hms-catalogue","version":1,"sources":[]}`, nil)
	var body struct {
		Error    struct{ Code string }
		Problems []Problem
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != 400 || body.Error.Code != "invalid_request" || len(body.Problems) != 1 || body.Problems[0].Index != 2 {
		t.Errorf("import problems: %d %s", w.Code, w.Body)
	}
}

func TestStateChangesNeedTheSameOrigin(t *testing.T) {
	h, _ := newHandler()
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"title":"T","type":"pdf"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	req = req.WithContext(iam.WithPrincipal(req.Context(), iam.Principal{UserID: "u", OrganizationID: "o"}))
	w := httptest.NewRecorder()
	h.create(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("cross-origin create: %d", w.Code)
	}
}
