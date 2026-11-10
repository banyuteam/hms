package patientsync

// The legacy bridge against PostgreSQL with a synthetic legacy source. Development/CI database only:
// HMS_TEST_BRIDGE_DATABASE_URL (legacy bridge login), HMS_TEST_DATABASE_URL (runtime login) and
// HMS_TEST_ADMIN_DATABASE_URL (superuser: fixtures, the cutover procedure and inspection). Skipped when unset.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/canonical/recordtx"
	"hms/services/integrations/legacyhms"
	"hms/services/platform/tenancy"
)

// fakeSource is a `pasien` table in memory, scanned in key order like legacyhms.Clinical.PatientScan.
type fakeSource struct {
	rows map[string]legacyhms.PatientRow
}

func (f *fakeSource) PatientScan(_ context.Context, after string, limit int) ([]legacyhms.PatientRow, error) {
	keys := make([]string, 0, len(f.rows))
	for k := range f.rows {
		if k > after {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var out []legacyhms.PatientRow
	for _, k := range keys {
		if len(out) == limit {
			break
		}
		out = append(out, f.rows[k])
	}
	return out, nil
}

func pools(t *testing.T) (bridge, rt, admin *pgxpool.Pool) {
	t.Helper()
	bURL, rtURL, adminURL := os.Getenv("HMS_TEST_BRIDGE_DATABASE_URL"), os.Getenv("HMS_TEST_DATABASE_URL"), os.Getenv("HMS_TEST_ADMIN_DATABASE_URL")
	if bURL == "" || rtURL == "" || adminURL == "" {
		t.Skip("HMS_TEST_BRIDGE_DATABASE_URL / HMS_TEST_DATABASE_URL / HMS_TEST_ADMIN_DATABASE_URL not set")
	}
	ctx := context.Background()
	var err error
	for _, p := range []struct {
		dst **pgxpool.Pool
		url string
	}{{&bridge, bURL}, {&rt, rtURL}, {&admin, adminURL}} {
		if *p.dst, err = pgxpool.New(ctx, p.url); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { bridge.Close(); rt.Close(); admin.Close() })
	return bridge, rt, admin
}

// authority runs the cutover procedure as the owner would: every domain starts at `initial`; moves follow.
func authority(t *testing.T, admin *pgxpool.Pool, orgID, initial string, moves ...string) {
	t.Helper()
	ctx := context.Background()
	tx, err := admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('hms.organization_id', $1, true), set_config('hms.actor_service', 'cutover-operator', true),
       set_config('hms.change_reason', 'integration test cutover', true)`, orgID); err != nil {
		t.Fatal(err)
	}
	if initial != "" {
		if _, err := tx.Exec(ctx, `INSERT INTO integration.domain_authority (organization_id, domain, authority, decision_reference)
SELECT $1::uuid, code, $2, 'TEST' FROM integration.record_domains`, orgID, initial); err != nil {
			t.Fatal(err)
		}
	}
	for _, m := range moves {
		if _, err := tx.Exec(ctx, `UPDATE integration.domain_authority SET authority = $2 WHERE organization_id = $1::uuid AND domain = 'patient'`,
			orgID, m); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func sp(s string) *string { return &s }

func TestPGBridgeMapsLegacyPatientsUntilCutover(t *testing.T) {
	bridge, rt, admin := pools(t)
	ctx := context.Background()
	if err := recordtx.CheckLayerRole(ctx, bridge, true); err != nil {
		t.Fatalf("bridge login: %v", err)
	}
	if err := recordtx.CheckLayerRole(ctx, rt, true); err == nil {
		t.Fatal("the runtime login must not pass as the legacy bridge")
	}

	b := make([]byte, 4)
	_, _ = rand.Read(b)
	tag := strings.ToUpper(hex.EncodeToString(b))
	org, err := tenancy.Ensure(ctx, rt, tenancy.Setup{OrganizationCode: "B" + tag, OrganizationName: "Bridge test",
		FacilityCode: "B" + tag + "-F", FacilityName: "Facility", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	authority(t, admin, org.OrganizationID, recordtx.AuthorityLegacy)

	nik := "3374010101800001" // unique per organization, and every run uses a new one
	src := &fakeSource{rows: map[string]legacyhms.PatientRow{
		"T0001": {MRN: sp("T0001"), Name: sp("Siti Aminah"), Sex: sp("P"), BirthDate: sp("1980-04-05"), BirthPlace: sp("Semarang"), NIK: sp(nik)},
		"T0002": {MRN: sp("T0002"), Name: sp("Budi"), Sex: sp("X"), BirthDate: sp("1981-01-01"), NIK: sp("123")},
		"T0003": {MRN: sp("T0003"), Name: sp("-"), Sex: sp("L")},
		"T0004": {MRN: sp("T0004"), Name: sp("Dewi"), Sex: sp("P"), NIK: sp(nik)}, // the same NIK as T0001
	}}
	w, err := New(bridge, src, Options{OrganizationID: org.OrganizationID, OrganizationCode: "B" + tag, Batch: 3,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: func() time.Time { return time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatal(err)
	}

	st, err := w.RunBatch(ctx)
	if err != nil || st.Created != 2 || st.Rejected != 1 || st.CycleComplete {
		t.Fatalf("first batch: %+v %v", st, err)
	}
	st, err = w.RunBatch(ctx)
	if err != nil || st.Created != 1 || !st.CycleComplete {
		t.Fatalf("second batch (duplicate NIK dropped, pass complete): %+v %v", st, err)
	}

	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := admin.QueryRow(ctx, q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM patient.patients WHERE organization_id = $1 AND record_origin = 'legacy'`, org.OrganizationID); n != 3 {
		t.Errorf("legacy-origin patients = %d, want 3", n)
	}
	if n := count(`SELECT count(*) FROM patient.resource_versions WHERE organization_id = $1 AND actor_service = 'legacy-bridge'
                    AND resource_type = 'Patient'`, org.OrganizationID); n != 3 {
		t.Errorf("history attributed to legacy-bridge = %d, want 3", n)
	}
	if n := count(`SELECT count(*) FROM integration.legacy_record_links WHERE organization_id = $1 AND mapping_version = $2`,
		org.OrganizationID, MappingVersion); n != 3 {
		t.Errorf("crosswalk links = %d, want 3", n)
	}
	if n := count(`SELECT count(*) FROM patient.identifiers WHERE organization_id = $1 AND system_uri = 'https://fhir.kemkes.go.id/id/nik' AND active`,
		org.OrganizationID); n != 1 {
		t.Errorf("active NIKs = %d, want 1 (the duplicate is dropped)", n)
	}
	issues := func() map[string]string {
		rows, err := admin.Query(ctx, `SELECT source_key || ':' || reason_code, kind || ':' || status FROM integration.bridge_issues
WHERE organization_id = $1`, org.OrganizationID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		out := map[string]string{}
		for rows.Next() {
			var k, v string
			if err := rows.Scan(&k, &v); err != nil {
				t.Fatal(err)
			}
			out[k] = v
		}
		return out
	}
	got := issues()
	for k, v := range map[string]string{"T0002:invalid_nik": "partial:open", "T0002:unknown_sex_code": "partial:open",
		"T0003:missing_name": "rejected:open", "T0004:duplicate_nik": "partial:open"} {
		if got[k] != v {
			t.Errorf("issue %s = %q, want %q (all: %v)", k, got[k], v, got)
		}
	}

	// Next pass: unchanged rows are not written again; a fixed row is created and its issue resolved; a changed row
	// is updated as a new version.
	src.rows["T0003"] = legacyhms.PatientRow{MRN: sp("T0003"), Name: sp("Eko"), Sex: sp("L")}
	src.rows["T0001"] = legacyhms.PatientRow{MRN: sp("T0001"), Name: sp("Siti Aminah"), Sex: sp("P"), BirthDate: sp("1980-04-05"),
		BirthPlace: sp("Kudus"), NIK: sp(nik)}
	st, err = w.RunBatch(ctx)
	if err != nil || st.Updated != 1 || st.Unchanged != 1 || st.Created != 1 {
		t.Fatalf("third batch: %+v %v", st, err)
	}
	if got := issues(); got["T0003:missing_name"] != "rejected:resolved" {
		t.Errorf("fixed row's issue: %v", got)
	}
	var place string
	var version int
	if err := admin.QueryRow(ctx, `SELECT p.birth_place, p.version FROM patient.patients p JOIN integration.legacy_record_links l
ON l.resource_id = p.id WHERE l.organization_id = $1 AND l.source_key = 'T0001'`, org.OrganizationID).Scan(&place, &version); err != nil ||
		place != "Kudus" || version != 2 {
		t.Errorf("updated patient: %q v%d %v", place, version, err)
	}

	// Cutover: the bridge stops writing; a later legacy change is reported, not applied.
	authority(t, admin, org.OrganizationID, "", recordtx.AuthorityCutover, recordtx.AuthorityNative)
	src.rows["T0001"] = legacyhms.PatientRow{MRN: sp("T0001"), Name: sp("Siti Aminah"), Sex: sp("P"), BirthDate: sp("1980-04-05"),
		BirthPlace: sp("Solo"), NIK: sp(nik)}
	src.rows["T0005"] = legacyhms.PatientRow{MRN: sp("T0005"), Name: sp("Late Registration"), Sex: sp("L")}
	for range 2 {
		if _, err := w.RunBatch(ctx); err != nil {
			t.Fatal(err)
		}
	}
	got = issues()
	if got["T0001:changed_after_cutover"] != "not_applied:open" || got["T0005:new_after_cutover"] != "not_applied:open" {
		t.Errorf("post-cutover issues: %v", got)
	}
	if err := admin.QueryRow(ctx, `SELECT p.birth_place FROM patient.patients p JOIN integration.legacy_record_links l
ON l.resource_id = p.id WHERE l.organization_id = $1 AND l.source_key = 'T0001'`, org.OrganizationID).Scan(&place); err != nil || place != "Kudus" {
		t.Errorf("post-cutover change must not be applied: %q %v", place, err)
	}
	var runs, failed int
	if err := admin.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE status <> 'succeeded') FROM integration.sync_runs
WHERE stream_name = $1`, w.Stream()).Scan(&runs, &failed); err != nil || runs != 5 || failed != 0 {
		t.Errorf("sync runs: %d (%d not succeeded) %v", runs, failed, err)
	}
}
