package catalogue

// Catalogue commands and queries against PostgreSQL. Development/CI database only: HMS_TEST_DATABASE_URL (runtime
// login) and HMS_TEST_ADMIN_DATABASE_URL (superuser: fixtures and inspection). Skipped when unset.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/platform/tenancy"
)

type pgEnv struct{ rt, admin *pgxpool.Pool }

func pgSetup(t *testing.T) pgEnv {
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
	return pgEnv{rt, admin}
}

func (e pgEnv) caller(t *testing.T) Caller {
	t.Helper()
	ctx := context.Background()
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	tag := strings.ToUpper(hex.EncodeToString(b))
	org, err := tenancy.Ensure(ctx, e.rt, tenancy.Setup{OrganizationCode: "C" + tag, OrganizationName: "Catalogue test",
		FacilityCode: "C" + tag + "-F", FacilityName: "Facility", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	var userID string
	if err := e.admin.QueryRow(ctx, `INSERT INTO iam.users (organization_id, display_name) VALUES ($1, 'Catalogue Manager')
		RETURNING id::text`, org.OrganizationID).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	return Caller{UserID: userID, OrganizationID: org.OrganizationID, FacilityID: org.FacilityID, RequestID: "test-" + tag, Channel: "web"}
}

type removals struct{ keys []string }

func (r *removals) Remove(key string) error { r.keys = append(r.keys, key); return nil }

func TestPGCatalogue(t *testing.T) {
	e := pgSetup(t)
	ctx := context.Background()
	c, other := e.caller(t), e.caller(t)
	rm := &removals{}
	svc := NewService(e.rt, rm, nil)

	link, err := svc.Create(ctx, c, Input{Title: "Synthetic guideline", Type: TypeURL, URL: str("https://example.org/guide"),
		Publisher: str("Synthetic ministry"), DataTitles: []string{"Chapter 1", "Chapter 2"}})
	if err != nil {
		t.Fatal(err)
	}
	if link.Version != 1 || link.File != nil || len(link.DataTitles) != 2 || link.DataTitles[1] != "Chapter 2" {
		t.Errorf("created link: %+v", link)
	}
	book, err := svc.Create(ctx, c, Input{Title: "Synthetic tariff workbook", Type: TypeExcel, DataTitles: []string{"Rawat jalan"}})
	if err != nil {
		t.Fatal(err)
	}

	page, err := svc.List(ctx, c, Filter{Limit: 1})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != book.ID || page.NextAfter == "" {
		t.Fatalf("first page (newest first): %+v %v", page, err)
	}
	page, err = svc.List(ctx, c, Filter{Limit: 1, After: page.NextAfter})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != link.ID || page.NextAfter != "" {
		t.Errorf("second page: %+v %v", page, err)
	}
	for q, want := range map[string]int{"workbook": 1, "chapter 2": 1, "ministry": 1, "nothing like this": 0, "100%": 0} {
		if p, err := svc.List(ctx, c, Filter{Query: q, Limit: 50}); err != nil || len(p.Items) != want {
			t.Errorf("search %q: %d items, want %d (%v)", q, len(p.Items), want, err)
		}
	}
	if p, _ := svc.List(ctx, c, Filter{Type: TypeExcel, Limit: 50}); len(p.Items) != 1 || p.Items[0].ID != book.ID {
		t.Errorf("type filter: %+v", p.Items)
	}
	if p, _ := svc.List(ctx, other, Filter{Limit: 50}); len(p.Items) != 0 {
		t.Errorf("another organization sees nothing: %+v", p.Items)
	}
	if _, err := svc.Get(ctx, other, link.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("another organization's source must not be found: %v", err)
	}

	updated, err := svc.Update(ctx, c, link.ID, Update{Version: 1, Title: "Renamed guideline", URL: str("https://example.org/v2"),
		DataTitles: []string{"Only chapter"}})
	if err != nil || updated.Version != 2 || *updated.URL != "https://example.org/v2" || len(updated.DataTitles) != 1 {
		t.Errorf("update: %+v %v", updated, err)
	}
	if _, err := svc.Update(ctx, c, link.ID, Update{Version: 1, Title: "Stale"}); !errors.Is(err, ErrVersionConflict) {
		t.Errorf("stale version: %v", err)
	}
	if _, err := svc.Update(ctx, other, link.ID, Update{Version: 2, Title: "Theirs", URL: str("https://e.org")}); !errors.Is(err, ErrNotFound) {
		t.Errorf("another organization cannot edit: %v", err)
	}

	// A stored file (written by the upload path; inserted directly here) is removed from the volume with its source.
	key := "catalogue/2026/11/" + strings.ToLower("0195f0c4-0000-7000-8000-") + strings.ToLower(hexTag(t))
	if _, err := e.admin.Exec(ctx, `INSERT INTO catalogue.files (source_id, storage_key, media_type, size_bytes, content_sha256,
		uploaded_by_user_id) VALUES ($1, $2, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 10, sha256('x'), $3)`,
		book.ID, key, c.UserID); err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.Get(ctx, c, book.ID); got.File == nil || got.File.SizeBytes != 10 {
		t.Errorf("file metadata: %+v", got.File)
	}
	if err := svc.Delete(ctx, c, book.ID, 1); err != nil {
		t.Fatal(err)
	}
	if len(rm.keys) != 1 || rm.keys[0] != key {
		t.Errorf("stored file removed after the delete: %v", rm.keys)
	}
	if _, err := svc.Get(ctx, c, book.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted: %v", err)
	}

	_, err = svc.Import(ctx, c, ImportDocument{Format: "hms-catalogue", Version: 1, Sources: []Input{
		{Title: "Fine", Type: TypePDF}, {Title: "Bad link", Type: TypeURL, URL: str("http://plain.example")}}})
	var ie ImportError
	if !errors.As(err, &ie) || len(ie.Problems) != 1 || ie.Problems[0].Index != 1 || ie.Problems[0].Code != "invalid_url" {
		t.Errorf("import problems: %v", err)
	}
	if p, _ := svc.List(ctx, c, Filter{Query: "Fine", Limit: 50}); len(p.Items) != 0 {
		t.Errorf("a refused import creates nothing: %+v", p.Items)
	}
	n, err := svc.Import(ctx, c, ImportDocument{Format: "hms-catalogue", Version: 1, Sources: []Input{
		{Title: "Imported PDF", Type: TypePDF}, {Title: "Imported image", Type: TypeImage, DataTitles: []string{"Plan"}}}})
	if err != nil || n != 2 {
		t.Errorf("import: %d %v", n, err)
	}

	var audits int
	if err := e.admin.QueryRow(ctx, `SELECT count(*) FROM audit.audit_events WHERE organization_id = $1 AND actor_id = $2
		AND category = 'administration' AND action LIKE 'catalogue.%'`, c.OrganizationID, c.UserID).Scan(&audits); err != nil || audits != 5 {
		t.Errorf("audit events = %d, want 5 (2 created, 1 updated, 1 deleted, 1 import): %v", audits, err)
	}
}

func hexTag(t *testing.T) string {
	t.Helper()
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
