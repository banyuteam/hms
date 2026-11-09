package documents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"hms/services/clinical"
	"hms/services/core/config"
	"hms/services/core/httpx"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

const (
	origin   = "https://hms.test.invalid"
	visit    = "2026/10/26/000123"
	fileName = "Budi_Santoso_SEP.pdf" // a file name that carries patient data: it must never be stored or logged
	docID    = "0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a91"
)

type fakeScanner struct {
	infected bool
	err      error
	calls    int
}

func (f *fakeScanner) Scan(_ context.Context, _ []byte) (bool, string, error) {
	f.calls++
	return !f.infected, "ClamAV 1.4.2/27450", f.err
}

type fakeConverter struct {
	err   error
	calls int
}

func (f *fakeConverter) ToPDF(_ context.Context, _ []byte, _ string) ([]byte, error) {
	f.calls++
	return pdfOf(2, ""), f.err
}

type fakeStore struct {
	err    error
	docs   []Doc
	events []audit.Event
	owned  map[string]string // id -> owner
	purged []string
}

func (f *fakeStore) Insert(_ context.Context, d Doc, ev audit.Event) (time.Time, error) {
	if f.err != nil {
		return time.Time{}, f.err
	}
	f.docs, f.events = append(f.docs, d), append(f.events, ev)
	return time.Date(2026, 11, 16, 3, 15, 0, 0, time.UTC), nil
}

func (f *fakeStore) Owned(_ context.Context, id, user string) (string, bool, error) {
	for _, d := range f.docs {
		if d.ID == id && f.owned[id] == user {
			return d.StorageKey, true, nil
		}
	}
	return "", false, nil
}

func (f *fakeStore) MarkPurged(_ context.Context, id string, ev audit.Event) error {
	f.purged, f.events = append(f.purged, id), append(f.events, ev)
	return nil
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
	scan    *fakeScanner
	conv    *fakeConverter
	store   *fakeStore
	audit   *fakeAudit
	vol     Volume
	logs    *bytes.Buffer
	allowed bool
}

func newEnv(t *testing.T) *env {
	t.Helper()
	u, _ := url.Parse(origin)
	e := &env{scan: &fakeScanner{}, conv: &fakeConverter{}, store: &fakeStore{owned: map[string]string{}},
		audit: &fakeAudit{}, vol: Volume{Dir: t.TempDir()}, logs: &bytes.Buffer{}, allowed: true}
	e.h = NewHandler(e.store, e.audit, e.scan, e.conv, e.vol, iam.NewHandler(nil, iam.HTTPOptions{PublicOrigin: u}),
		config.Documents{Enabled: true, Retention: 7 * 24 * time.Hour}, slog.New(slog.NewTextHandler(e.logs, nil)))
	e.h.now = func() time.Time { return time.Date(2026, 11, 9, 3, 15, 0, 0, time.UTC) }
	e.h.newID = func() string { return docID }
	e.h.can = func(_ *http.Request, perm string) (bool, error) {
		if perm != clinical.PermClinicalRead {
			t.Errorf("unexpected permission check %s", perm)
		}
		return e.allowed, nil
	}
	return e
}

func multipartBody(t *testing.T, visitNumber string, file []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if visitNumber != "" {
		_ = mw.WriteField("visit_number", visitNumber)
	}
	if file != nil {
		fw, _ := mw.CreateFormFile("file", fileName)
		_, _ = fw.Write(file)
	}
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func (e *env) upload(t *testing.T, file []byte, edit ...func(*http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	body, ct := multipartBody(t, visit, file)
	r := httptest.NewRequest(http.MethodPost, "/api/v1/assistant/documents", body)
	r.Header.Set("Origin", origin)
	r.Header.Set("Content-Type", ct)
	r = r.WithContext(iam.WithPrincipal(r.Context(), iam.Principal{UserID: "user-1", OrganizationID: "org-1", FacilityID: "fac-1"}))
	for _, f := range edit {
		f(r)
	}
	w := httptest.NewRecorder()
	e.h.upload(w, r)
	return w
}

func errCode(w *httptest.ResponseRecorder) string {
	var b httpx.ErrorBody
	_ = json.Unmarshal(w.Body.Bytes(), &b)
	return b.Error.Code
}

// noFileName fails if the user's file name appears anywhere it could be kept.
func (e *env) noFileName(t *testing.T) {
	t.Helper()
	all, _ := json.Marshal(struct {
		D []Doc
		S []audit.Event
		A []audit.Event
	}{e.store.docs, e.store.events, e.audit.events})
	for _, where := range []string{string(all), e.logs.String()} {
		if strings.Contains(where, "Budi") || strings.Contains(where, fileName) {
			t.Errorf("file name leaked: %s", where)
		}
	}
}

func TestUploadsAPDF(t *testing.T) {
	e := newEnv(t)
	w := e.upload(t, pdfOf(3, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	var got Uploaded
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if got.DocumentID != docID || got.MediaType != TypePDF || got.UploadedMediaType != TypePDF || *got.PageCount != 3 ||
		!got.ExpiresAt.Equal(time.Date(2026, 11, 16, 3, 15, 0, 0, time.UTC)) {
		t.Errorf("answer %+v", got)
	}
	d := e.store.docs[0]
	if d.UserID != "user-1" || d.FacilityID != "fac-1" || d.VisitNumber != visit || d.StorageKey != "2026/11/"+docID ||
		d.ScanEngine != "ClamAV 1.4.2/27450" || len(d.SHA256) != 32 || d.Retention != 7*24*time.Hour {
		t.Errorf("metadata %+v", d)
	}
	stored, err := os.ReadFile(filepath.Join(e.vol.Dir, "2026", "11", docID))
	if err != nil || !bytes.Equal(stored, pdfOf(3, "")) {
		t.Errorf("stored file: %v", err)
	}
	ev := e.store.events[0]
	if ev.Action != "assistant.document.upload" || ev.Outcome != "success" || ev.ResourceID != docID ||
		ev.Detail["visit"] != visit || ev.Detail["pages"] != "3" || ev.Detail["scan_engine"] == "" {
		t.Errorf("audit %+v", ev)
	}
	if e.scan.calls != 1 || e.conv.calls != 0 {
		t.Errorf("scanner %d converter %d", e.scan.calls, e.conv.calls)
	}
	e.noFileName(t)
}

func TestOfficeFilesAreScannedThenConvertedAndStoredAsPDF(t *testing.T) {
	e := newEnv(t)
	w := e.upload(t, docx(t))
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	d := e.store.docs[0]
	if d.UploadedType != TypeDOCX || d.StoredType != TypePDF || *d.Pages != 2 || e.conv.calls != 1 {
		t.Errorf("docx %+v converter %d", d, e.conv.calls)
	}
	// An infected Office file never reaches the converter.
	e = newEnv(t)
	e.scan.infected = true
	if w := e.upload(t, docx(t)); w.Code != http.StatusUnprocessableEntity || errCode(w) != RejectMalware || e.conv.calls != 0 {
		t.Errorf("infected docx: %d %s converter %d", w.Code, errCode(w), e.conv.calls)
	}
}

func TestImagesAreStoredReencoded(t *testing.T) {
	e := newEnv(t)
	if w := e.upload(t, jpegWithExif(t)); w.Code != http.StatusCreated {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	stored, _ := os.ReadFile(filepath.Join(e.vol.Dir, "2026", "11", docID))
	if bytes.Contains(stored, []byte("GPS-LAT")) || e.store.docs[0].Pages != nil {
		t.Error("image stored with its metadata, or with a page count")
	}
}

func TestRejectedFilesAreAuditedAndNotStored(t *testing.T) {
	for name, tc := range map[string]struct {
		file     []byte
		infected bool
		status   int
		code     string
	}{
		"malware":     {pdfOf(1, ""), true, 422, RejectMalware},
		"executable":  {[]byte("MZ\x90\x00 not a document"), false, 415, RejectUnsupported},
		"legacy .doc": {[]byte("\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1rest"), false, 415, RejectLegacyOffice},
		"javascript":  {pdfOf(1, "/OpenAction << /S /JavaScript /JS (x) >>"), false, 422, RejectActiveContent},
		"51 pages":    {pdfOf(51, ""), false, 422, RejectTooManyPages},
	} {
		e := newEnv(t)
		e.scan.infected = tc.infected
		w := e.upload(t, tc.file)
		if w.Code != tc.status || errCode(w) != tc.code {
			t.Errorf("%s: %d %s", name, w.Code, errCode(w))
		}
		if len(e.store.docs) != 0 {
			t.Errorf("%s: stored", name)
		}
		if entries, _ := os.ReadDir(e.vol.Dir); len(entries) != 0 {
			t.Errorf("%s: a file was written", name)
		}
		if len(e.audit.events) != 1 || e.audit.events[0].Outcome != "failure" || e.audit.events[0].Detail["reason"] != tc.code {
			t.Errorf("%s: audit %+v", name, e.audit.events)
		}
		e.noFileName(t)
	}
}

func TestUploadLimitsAndChecks(t *testing.T) {
	e := newEnv(t)
	big := append(pdfOf(1, ""), bytes.Repeat([]byte(" "), MaxFileBytes)...)
	if w := e.upload(t, big); w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("over 10 MiB: %d %s", w.Code, errCode(w))
	}
	e = newEnv(t)
	e.allowed = false
	if w := e.upload(t, pdfOf(1, "")); w.Code != http.StatusForbidden || errCode(w) != "reference_forbidden" ||
		e.scan.calls != 0 || e.audit.events[0].Outcome != "denied" {
		t.Errorf("no data permission: %d %s scanned %d", w.Code, errCode(w), e.scan.calls)
	}
	e = newEnv(t)
	if w := e.upload(t, pdfOf(1, ""), func(r *http.Request) { r.Header.Set("Origin", "https://evil.test.invalid") }); w.Code != 403 {
		t.Errorf("foreign origin: %d", w.Code)
	}
	if w := e.upload(t, pdfOf(1, ""), func(r *http.Request) { r.Header.Set("Content-Type", "application/json") }); w.Code != 415 {
		t.Errorf("not multipart: %d", w.Code)
	}
	for name, mk := range map[string]func() (*bytes.Buffer, string){
		"no visit":  func() (*bytes.Buffer, string) { return multipartBody(t, "", pdfOf(1, "")) },
		"bad visit": func() (*bytes.Buffer, string) { return multipartBody(t, "../1", pdfOf(1, "")) },
		"no file":   func() (*bytes.Buffer, string) { return multipartBody(t, visit, nil) },
	} {
		body, ct := mk()
		r := httptest.NewRequest(http.MethodPost, "/api/v1/assistant/documents", body)
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", ct)
		r = r.WithContext(iam.WithPrincipal(r.Context(), iam.Principal{UserID: "u", OrganizationID: "o", FacilityID: "f"}))
		w := httptest.NewRecorder()
		e.h.upload(w, r)
		if w.Code != 400 {
			t.Errorf("%s: %d", name, w.Code)
		}
	}
}

func TestUnavailableDependenciesRefuseTheFile(t *testing.T) {
	e := newEnv(t)
	e.scan.err = ErrScannerUnavailable
	if w := e.upload(t, pdfOf(1, "")); w.Code != 503 || errCode(w) != "scan_unavailable" || len(e.store.docs) != 0 {
		t.Errorf("scanner down: %d %s", w.Code, errCode(w))
	}
	e = newEnv(t)
	e.conv.err = ErrConverterUnavailable
	if w := e.upload(t, docx(t)); w.Code != 503 || errCode(w) != "conversion_unavailable" {
		t.Errorf("converter down: %d %s", w.Code, errCode(w))
	}
	// Metadata not stored: the file is removed again, nothing is left on the volume.
	e = newEnv(t)
	e.store.err = errors.New("db down")
	if w := e.upload(t, pdfOf(1, "")); w.Code != 503 {
		t.Errorf("store down: %d", w.Code)
	}
	if _, err := os.Stat(filepath.Join(e.vol.Dir, "2026", "11", docID)); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("orphan file left: %v", err)
	}
	// A rejection that cannot be audited is not answered as a rejection.
	e = newEnv(t)
	e.audit.fail, e.scan.infected = true, true
	if w := e.upload(t, pdfOf(1, "")); w.Code != 503 {
		t.Errorf("unaudited rejection: %d", w.Code)
	}
}

func TestDeleteRemovesOnlyTheCallersOwnDocument(t *testing.T) {
	e := newEnv(t)
	if w := e.upload(t, pdfOf(1, "")); w.Code != 201 {
		t.Fatal(w.Body.String())
	}
	e.store.owned[docID] = "user-1"
	del := func(id, user string) int {
		r := httptest.NewRequest(http.MethodDelete, "/api/v1/assistant/documents/"+id, nil)
		r.SetPathValue("id", id)
		r.Header.Set("Origin", origin)
		r = r.WithContext(iam.WithPrincipal(r.Context(), iam.Principal{UserID: user, OrganizationID: "org-1", FacilityID: "fac-1"}))
		w := httptest.NewRecorder()
		e.h.remove(w, r)
		return w.Code
	}
	if code := del(docID, "user-2"); code != 404 {
		t.Errorf("someone else's document: %d", code)
	}
	if code := del("../../etc", "user-1"); code != 404 {
		t.Errorf("bad id: %d", code)
	}
	if code := del(docID, "user-1"); code != 204 {
		t.Fatalf("own document: %d", code)
	}
	if _, err := os.Stat(filepath.Join(e.vol.Dir, "2026", "11", docID)); !errors.Is(err, os.ErrNotExist) {
		t.Error("file still on the volume")
	}
	if len(e.store.purged) != 1 || e.store.events[len(e.store.events)-1].Action != "assistant.document.delete" {
		t.Errorf("purge not recorded: %v", e.store.purged)
	}
}

func TestDocumentRoutesNeedASession(t *testing.T) {
	e := newEnv(t)
	mux := http.NewServeMux()
	e.h.Register(mux)
	body, ct := multipartBody(t, visit, pdfOf(1, ""))
	for _, r := range []*http.Request{
		httptest.NewRequest(http.MethodPost, "/api/v1/assistant/documents", body),
		httptest.NewRequest(http.MethodDelete, "/api/v1/assistant/documents/"+docID, nil),
	} {
		r.Header.Set("Content-Type", ct)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s without a session: %d", r.Method, w.Code)
		}
	}
	if e.scan.calls != 0 || len(e.store.docs) != 0 {
		t.Error("nothing is processed without a session")
	}
	if len(Permissions) != 1 || Permissions[0].Code != PermAnalyze {
		t.Errorf("permissions %+v", Permissions)
	}
}
