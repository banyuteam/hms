package clinical

// Full stack over HTTP against PostgreSQL (real sessions, permissions and audit trail) with a synthetic legacy reader.
// Development/CI database only: HMS_TEST_DATABASE_URL (runtime role) and HMS_TEST_ADMIN_DATABASE_URL (superuser,
// inspection only). Skipped when unset.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/core/httpx"
	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
	"hms/services/platform/tenancy"
)

type staff struct{}

func (staff) Verify(_ context.Context, userID, password string) (legacyhms.Identity, error) {
	if password != "pw" {
		return legacyhms.Identity{}, legacyhms.ErrInvalid
	}
	return legacyhms.Identity{Issuer: legacyhms.IssuerEmployee, Subject: userID, DisplayName: "Staff " + userID}, nil
}

func (staff) Active(context.Context, string, string) (bool, error) { return true, nil }

func TestPGClinicalReadPermissionsAndAudit(t *testing.T) {
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
	tag := strings.ToUpper(hex.EncodeToString(b))
	org, err := tenancy.Ensure(ctx, rt, tenancy.Setup{OrganizationCode: "C" + tag, OrganizationName: "Clinical test",
		FacilityCode: "C" + tag + "-F", FacilityName: "Facility", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}

	store := iam.NewPgStore(rt)
	if _, err := store.SyncPermissions(ctx, append(append([]iam.PermissionDef{}, iam.Registry...), Permissions...),
		systemEvent(org.OrganizationID)); err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := iam.NewService(store, staff{}, iam.Options{OrganizationID: org.OrganizationID, FacilityID: org.FacilityID,
		IdleTimeout: 15 * time.Minute, AbsoluteTTL: time.Hour, Lockout: iam.LockoutPolicy{Failures: 5, Window: time.Minute, Duration: time.Minute},
		Logger: logger})
	origin, _ := url.Parse("https://hms.test.invalid")
	ih := iam.NewHandler(svc, iam.HTTPOptions{PublicOrigin: origin, SecureCookies: true, SignInPerIP: 100})
	mux := http.NewServeMux()
	ih.Register(mux)
	loc, _ := time.LoadLocation("Asia/Jakarta")
	NewHandler(&fakeReader{}, store, ih, loc, logger).Register(mux)
	srv := httptest.NewServer(httpx.Middleware(logger, mux))
	t.Cleanup(srv.Close)

	signIn := func(login string) (string, *http.Cookie) {
		req, _ := http.NewRequest("POST", srv.URL+"/api/v1/auth/sign-in", strings.NewReader(fmt.Sprintf(`{"user_id":%q,"password":"pw"}`, login)))
		req.Header.Set("Origin", origin.String())
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("sign-in %s: %v %v", login, err, resp.StatusCode)
		}
		defer resp.Body.Close()
		var body struct {
			User struct{ ID string } `json:"user"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return body.User.ID, resp.Cookies()[0]
	}
	get := func(c *http.Cookie, path string) (int, string) {
		req, _ := http.NewRequest("GET", srv.URL+path, nil)
		req.AddCookie(c)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	roles := 0
	grant := func(userID string, perms ...string) {
		roles++
		var roleID string
		if err := rt.QueryRow(ctx, `INSERT INTO iam.roles (code, name) VALUES ($1, 'Clinical test') RETURNING id::text`,
			"ct-"+strings.ToLower(tag)+"-"+fmt.Sprint(roles)).Scan(&roleID); err != nil {
			t.Fatal(err)
		}
		for _, p := range perms {
			if _, err := rt.Exec(ctx, `INSERT INTO iam.role_permissions (role_id, permission_code) VALUES ($1::uuid, $2)`, roleID, p); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := rt.Exec(ctx, `INSERT INTO iam.role_assignments (user_id, role_id, organization_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`,
			userID, roleID, org.OrganizationID); err != nil {
			t.Fatal(err)
		}
	}

	userID, c := signIn("CLIN" + tag)
	for _, p := range []string{"/api/v1/patients/000001", "/api/v1/patients?q=pasien", "/api/v1/encounters/2026%2F10%2F26%2F000123"} {
		if s, _ := get(c, p); s != 403 {
			t.Errorf("%s without permission: %d", p, s)
		}
	}

	grant(userID, PermPatientRead, PermEncounterRead)
	s, body := get(c, "/api/v1/patients/000001")
	if s != 200 || strings.Contains(body, "3273010210850002") || !strings.Contains(body, "3273••••••••0002") {
		t.Errorf("profile: %d %s", s, body)
	}
	if s, body := get(c, "/api/v1/encounters/2026%2F10%2F26%2F000123"); s != 200 || !strings.Contains(body, `"encounter_number":"2026/10/26/000123"`) {
		t.Errorf("encoded encounter number: %d %s", s, body)
	}
	if s, _ := get(c, "/api/v1/patients/000001/identifiers/nik"); s != 403 {
		t.Errorf("reveal needs its own permission: %d", s)
	}
	grant(userID, PermIdentifierReveal)
	if s, body := get(c, "/api/v1/patients/000001/identifiers/nik"); s != 200 || !strings.Contains(body, "3273010210850002") {
		t.Errorf("reveal: %d %s", s, body)
	}
	if s, _ := get(c, "/api/v1/patients?q=pasien"); s != 200 {
		t.Errorf("search: %d", s)
	}

	// The timeline and the bill each need their own permission; encounter.read covers neither (ADR-SVC-004).
	timeline, bill := "/api/v1/encounters/2026%2F10%2F26%2F000123/timeline", "/api/v1/encounters/2026%2F10%2F26%2F000123/bill"
	for _, p := range []string{timeline, bill} {
		if s, _ := get(c, p); s != 403 {
			t.Errorf("%s with encounter.read only: %d", p, s)
		}
	}
	grant(userID, PermClinicalRead)
	if s, body := get(c, timeline); s != 200 || !strings.Contains(body, `"entries":[]`) {
		t.Errorf("timeline: %d %s", s, body)
	}
	if s, _ := get(c, bill); s != 403 {
		t.Errorf("bill needs billing.read: %d", s)
	}
	grant(userID, PermBillingRead)
	if s, body := get(c, bill); s != 200 || !strings.Contains(body, `"saved_bill":null`) {
		t.Errorf("bill: %d %s", s, body)
	}

	var n int
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM audit.audit_events WHERE actor_id = $1 AND category = 'data_access'
        AND action IN ('patient.read', 'encounter.read', 'patient.identifier.reveal', 'patient.search', 'encounter.timeline.read',
        'encounter.bill.read')`, userID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 6 {
		t.Errorf("data-access audit events = %d, want 6", n)
	}
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM audit.audit_events WHERE actor_id = $1
        AND (detail::text LIKE '%3273010210850002%' OR detail::text ILIKE '%pasien%')`, userID).Scan(&n); err != nil || n != 0 {
		t.Errorf("audit rows contain a value or search text: %d %v", n, err)
	}
	if err := admin.QueryRow(ctx, `SELECT count(*) FROM audit.audit_events WHERE actor_id = $1 AND action = 'permission.check'
        AND outcome = 'denied'`, userID).Scan(&n); err != nil || n != 7 {
		t.Errorf("denied permission checks audited = %d, want 7 (%v)", n, err)
	}
}

func systemEvent(orgID string) audit.Event {
	return audit.Event{Category: audit.CategoryAdministration, Action: "iam.permission.registered",
		Outcome: audit.OutcomeSuccess, ActorType: audit.ActorSystem, OrganizationID: orgID, Channel: "system"}
}
