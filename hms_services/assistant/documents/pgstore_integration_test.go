package documents

// PostgreSQL integration tests for document metadata (schema assistant, hms_database migration 0007). Development/CI
// database only:
//
//	HMS_TEST_DATABASE_URL        connection as the runtime role (hms_meta_runtime)
//	HMS_TEST_ADMIN_DATABASE_URL  superuser connection, used only to set up users and inspect or age rows
//
// Skipped when either is unset. Rows are synthetic and tagged per run.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/platform/audit"
	"hms/services/platform/tenancy"
)

type pgDocs struct {
	rt, admin   *pgxpool.Pool
	store       *PgStore
	vol         Volume
	org, fac    string
	user, other string
}

func setupDocsPG(t *testing.T) *pgDocs {
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
	res, err := tenancy.Ensure(ctx, rt, tenancy.Setup{OrganizationCode: code, OrganizationName: "Test Org " + code,
		FacilityCode: code + "-A", FacilityName: "Facility A", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	e := &pgDocs{rt: rt, admin: admin, store: NewPgStore(rt), vol: Volume{Dir: t.TempDir()}, org: res.OrganizationID,
		fac: res.FacilityID}
	for _, u := range []*string{&e.user, &e.other} {
		if err := admin.QueryRow(ctx, `INSERT INTO iam.users (organization_id, display_name) VALUES ($1::uuid, 'Test user')
RETURNING id::text`, e.org).Scan(u); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

func (e *pgDocs) count(t *testing.T, sql string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := e.admin.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// age rewrites timestamps as the superuser, bypassing the update guard (test setup only).
func (e *pgDocs) age(t *testing.T, sql string, args ...any) {
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

// stored saves a synthetic PDF and records it as the user's document.
func (e *pgDocs) stored(t *testing.T) (string, string) {
	t.Helper()
	id, data := newID(), pdfOf(1, "")
	key, err := e.vol.Save(time.Now(), id, data)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	pages := 1
	d := Doc{ID: id, OrganizationID: e.org, FacilityID: e.fac, UserID: e.user, VisitNumber: "2026/10/26/000123",
		UploadedType: TypePDF, StoredType: TypePDF, Size: int64(len(data)), Pages: &pages, SHA256: sum[:],
		StorageKey: key, ScanEngine: "ClamAV test", Retention: 7 * 24 * time.Hour}
	ev := audit.Event{Category: audit.CategoryDataAccess, Action: "assistant.document.upload", Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorUser, ActorID: e.user, OrganizationID: e.org, FacilityID: e.fac,
		ResourceType: "AssistantDocument", ResourceID: id, Channel: "web"}
	expires, err := e.store.Insert(context.Background(), d, ev)
	if err != nil {
		t.Fatal(err)
	}
	if d := time.Until(expires); d < 6*24*time.Hour || d > 8*24*time.Hour {
		t.Errorf("expires in %v, want about 7 days", d)
	}
	return id, key
}

func TestPGDocumentLifecycle(t *testing.T) {
	e := setupDocsPG(t)
	ctx := context.Background()
	id, key := e.stored(t)
	if n := e.count(t, `SELECT count(*) FROM audit.audit_events WHERE action = 'assistant.document.upload' AND resource_id = $1`, id); n != 1 {
		t.Errorf("upload audit events: %d", n)
	}
	if k, ok, err := e.store.Owned(ctx, id, e.user); err != nil || !ok || k != key {
		t.Fatalf("owner: %q %v %v", k, ok, err)
	}
	if _, ok, _ := e.store.Owned(ctx, id, e.other); ok {
		t.Error("another user sees the document")
	}
	ev := audit.Event{Category: audit.CategoryDataAccess, Action: "assistant.document.delete", Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorUser, ActorID: e.user, OrganizationID: e.org, FacilityID: e.fac,
		ResourceType: "AssistantDocument", ResourceID: id, Channel: "web"}
	if err := e.store.MarkPurged(ctx, id, ev); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := e.store.Owned(ctx, id, e.user); ok {
		t.Error("a purged document is still listed")
	}
	if err := e.store.MarkPurged(ctx, id, ev); err != nil {
		t.Errorf("marking twice is harmless: %v", err)
	}
}

func TestPGDocumentRetention(t *testing.T) {
	e := setupDocsPG(t)
	ctx := context.Background()
	expired, expiredKey := e.stored(t)
	fresh, freshKey := e.stored(t)
	e.age(t, `UPDATE assistant.documents SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
WHERE id = $1::uuid`, expired)

	res, err := e.store.Purge(ctx, time.Now(), e.vol)
	if err != nil {
		t.Fatal(err)
	}
	if res["files"] < 1 {
		t.Errorf("purged %v", res)
	}
	if _, err := os.Stat(filepath.Join(e.vol.Dir, filepath.FromSlash(expiredKey))); !errors.Is(err, os.ErrNotExist) {
		t.Error("expired file still on the volume")
	}
	if _, err := os.Stat(filepath.Join(e.vol.Dir, filepath.FromSlash(freshKey))); err != nil {
		t.Errorf("fresh file removed: %v", err)
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.documents WHERE id = $1::uuid AND purged_at IS NOT NULL`, expired); n != 1 {
		t.Error("expired document not marked purged")
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.documents WHERE id = $1::uuid AND purged_at IS NULL`, fresh); n != 1 {
		t.Error("fresh document marked purged")
	}

	// After twelve months: the reading goes, then the metadata of its (already purged) document.
	reading := newID()
	if _, err := e.admin.Exec(ctx, `INSERT INTO assistant.document_readings (id, request_id, organization_id, facility_id,
user_id, visit_number, status, model, bridge_version) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
'2026/10/26/000123', 'answered', 'claude-opus-5-5', '0.1.0')`, reading, newID(), e.org, e.fac, e.user); err != nil {
		t.Fatal(err)
	}
	if _, err := e.admin.Exec(ctx, `INSERT INTO assistant.document_reading_files VALUES ($1::uuid, $2::uuid)`, reading, expired); err != nil {
		t.Fatal(err)
	}
	e.age(t, `UPDATE assistant.document_readings SET created_at = now() - interval '13 months' WHERE id = $1::uuid`, reading)
	// Both timestamps move: the database keeps a file at most 30 days after it was created, even for a superuser.
	e.age(t, `UPDATE assistant.documents SET created_at = now() - interval '13 months',
expires_at = now() - interval '13 months' + interval '7 days', purged_at = now() - interval '13 months' + interval '7 days'
WHERE id = $1::uuid`, expired)
	if _, err := e.store.Purge(ctx, time.Now(), e.vol); err != nil {
		t.Fatal(err)
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.document_readings WHERE id = $1::uuid`, reading); n != 0 {
		t.Error("old reading kept")
	}
	if n := e.count(t, `SELECT count(*) FROM assistant.documents WHERE id = $1::uuid`, expired); n != 0 {
		t.Error("old document metadata kept")
	}
	if n := e.count(t, `SELECT count(*) FROM audit.audit_events WHERE action = 'assistant.documents.purge'
AND occurred_at > now() - interval '1 minute'`); n < 1 {
		t.Error("purge not audited")
	}
}
