package iam

// Integration tests against a migrated hms_database (development or CI only: they leave synthetic rows behind, and
// audit rows can never be deleted). Run with:
//
//	HMS_TEST_DATABASE_URL        connection as the runtime role (hms_meta_runtime)
//	HMS_TEST_ADMIN_DATABASE_URL  superuser connection, used only to inspect results
//
// Skipped when either is unset.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/integrations/legacyhms"
	"hms/services/platform/tenancy"
)

type pgEnv struct {
	rt, admin *pgxpool.Pool
	tag       string // unique per run, keeps runs apart
	orgID     string
	facA      string
	facB      string
}

func setupPG(t *testing.T) *pgEnv {
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
	e := &pgEnv{rt: rt, admin: admin, tag: strings.ToUpper(hex.EncodeToString(b))}

	org := "T" + e.tag
	resA, err := tenancy.Ensure(ctx, rt, tenancy.Setup{OrganizationCode: org, OrganizationName: "Test Org " + e.tag,
		FacilityCode: org + "-A", FacilityName: "Facility A", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	if !resA.OrganizationCreated || !resA.FacilityCreated {
		t.Fatalf("first setup must create both: %+v", resA)
	}
	again, err := tenancy.Ensure(ctx, rt, tenancy.Setup{OrganizationCode: org, OrganizationName: "Renamed?",
		FacilityCode: org + "-A", FacilityName: "Renamed?", Timezone: "Asia/Jakarta"})
	if err != nil || again.OrganizationCreated || again.FacilityCreated || again.FacilityID != resA.FacilityID {
		t.Fatalf("setup must be idempotent: %+v %v", again, err)
	}
	resB, err := tenancy.Ensure(ctx, rt, tenancy.Setup{OrganizationCode: org, OrganizationName: "x",
		FacilityCode: org + "-B", FacilityName: "Facility B", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	if o, f, err := tenancy.Resolve(ctx, rt, org, org+"-A"); err != nil || o != resA.OrganizationID || f != resA.FacilityID {
		t.Fatalf("resolve: %s %s %v", o, f, err)
	}
	e.orgID, e.facA, e.facB = resA.OrganizationID, resA.FacilityID, resB.FacilityID
	return e
}

func (e *pgEnv) service(v Verifier, now func() time.Time) *Service {
	return NewService(NewPgStore(e.rt), v, Options{
		OrganizationID: e.orgID, FacilityID: e.facA,
		IdleTimeout: 15 * time.Minute, AbsoluteTTL: 12 * time.Hour, ActiveCacheTTL: 0,
		Lockout: LockoutPolicy{Failures: 5, Window: 15 * time.Minute, Duration: 15 * time.Minute},
		Now:     now, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

func (e *pgEnv) scalar(t *testing.T, q string, args ...any) int {
	t.Helper()
	var n int
	if err := e.admin.QueryRow(context.Background(), q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

func TestPGLockout(t *testing.T) {
	e := setupPG(t)
	ctx := context.Background()
	s := NewPgStore(e.rt)
	key := accountKeyHash("lockout-" + e.tag)
	p := LockoutPolicy{Failures: 5, Window: 15 * time.Minute, Duration: 15 * time.Minute}
	t0 := time.Now().UTC().Truncate(time.Second)
	for i := 0; i < 4; i++ {
		if err := s.RecordFailure(ctx, key, t0.Add(time.Duration(i)*time.Minute), p); err != nil {
			t.Fatal(err)
		}
	}
	if until, _ := s.LockedUntil(ctx, key); !until.IsZero() {
		t.Fatalf("4 failures must not lock: %v", until)
	}
	_ = s.RecordFailure(ctx, key, t0.Add(4*time.Minute), p)
	until, _ := s.LockedUntil(ctx, key)
	if !until.Equal(t0.Add(19 * time.Minute)) {
		t.Fatalf("5th failure locks for 15 minutes: %v", until)
	}
	// A failure after the window starts a new count; the old lock stays as it was.
	_ = s.RecordFailure(ctx, key, t0.Add(40*time.Minute), p)
	if n := e.scalar(t, `SELECT failures FROM iam.signin_attempts WHERE account_key_hash = $1`, key); n != 1 {
		t.Errorf("new window count = %d", n)
	}
	if err := s.ClearFailures(ctx, key); err != nil {
		t.Fatal(err)
	}
	if n := e.scalar(t, `SELECT count(*) FROM iam.signin_attempts WHERE account_key_hash = $1`, key); n != 0 {
		t.Error("clear failed")
	}

	// Concurrent failures are all counted.
	key2 := accountKeyHash("burst-" + e.tag)
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _ = s.RecordFailure(ctx, key2, time.Now(), p) }()
	}
	wg.Wait()
	if n := e.scalar(t, `SELECT failures FROM iam.signin_attempts WHERE account_key_hash = $1`, key2); n != 10 {
		t.Errorf("concurrent failures counted = %d, want 10", n)
	}
}

func TestPGSignInFlowAndAudit(t *testing.T) {
	e := setupPG(t)
	ctx := context.Background()
	v := newFakeVerifier()
	doc := "D" + e.tag
	v.logins[doc] = "pw-" + e.tag
	v.identities[doc] = legacyhms.Identity{Issuer: legacyhms.IssuerDoctor, Subject: doc, DisplayName: "dr. " + e.tag}
	svc := e.service(v, time.Now)
	ri := RequestInfo{RequestID: "it-" + e.tag, ClientAddr: "10.1.2.3", ClientType: "web"}

	if _, err := svc.SignIn(ctx, doc, "wrong", ri); err != ErrInvalidCredentials {
		t.Fatalf("wrong password: %v", err)
	}
	res, err := svc.SignIn(ctx, doc, "pw-"+e.tag, ri)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Permissions) != 0 {
		t.Errorf("a provisioned user starts with no permissions: %v", res.Permissions)
	}
	if n := e.scalar(t, `SELECT count(*) FROM iam.users u JOIN iam.external_identities x ON x.user_id = u.id
                         WHERE x.issuer = $1 AND x.subject = $2 AND u.organization_id = $3::uuid AND u.status = 'active'`,
		legacyhms.IssuerDoctor, doc, e.orgID); n != 1 {
		t.Errorf("provisioned users = %d", n)
	}
	if n := e.scalar(t, `SELECT count(*) FROM iam.role_assignments a JOIN iam.users u ON u.id = a.user_id
                         WHERE u.id = $1::uuid`, res.Principal.UserID); n != 0 {
		t.Errorf("provisioning must grant nothing: %d assignments", n)
	}
	if n := e.scalar(t, `SELECT count(*) FROM iam.sessions WHERE id_hash = sha256(convert_to($1, 'UTF8'))
                         AND user_id = $2::uuid AND facility_id = $3::uuid`, res.Token, res.Principal.UserID, e.facA); n != 1 {
		t.Error("session must be stored by SHA-256 of the token")
	}

	p, err := svc.Authenticate(ctx, res.Token, ri)
	if err != nil || p.UserID != res.Principal.UserID {
		t.Fatalf("authenticate: %v", err)
	}

	// Authorization: nothing, then a facility grant, then an organization-wide grant.
	perm := "test_" + strings.ToLower(e.tag) + ".read"
	if ok, _ := svc.Authorize(ctx, p, perm, ri); ok {
		t.Error("no grant yet")
	}
	mustExec(t, e.rt, `INSERT INTO iam.permissions (code, description) VALUES ($1, 'integration test')`, perm)
	var roleID string
	if err := e.rt.QueryRow(ctx, `INSERT INTO iam.roles (code, name) VALUES ($1, 'Integration test') RETURNING id::text`,
		"it-"+strings.ToLower(e.tag)).Scan(&roleID); err != nil {
		t.Fatal(err)
	}
	mustExec(t, e.rt, `INSERT INTO iam.role_permissions (role_id, permission_code) VALUES ($1::uuid, $2)`, roleID, perm)
	mustExec(t, e.rt, `INSERT INTO iam.role_assignments (user_id, role_id, organization_id, facility_id)
                      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`, p.UserID, roleID, e.orgID, e.facB)
	if ok, _ := svc.Authorize(ctx, p, perm, ri); ok {
		t.Error("a grant at facility B must not apply to a session at facility A")
	}
	store := NewPgStore(e.rt)
	if ok, _ := store.Can(ctx, p.UserID, perm, e.facB); !ok {
		t.Error("grant at facility B applies at B")
	}
	mustExec(t, e.rt, `INSERT INTO iam.role_assignments (user_id, role_id, organization_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`,
		p.UserID, roleID, e.orgID)
	if ok, _ := svc.Authorize(ctx, p, perm, ri); !ok {
		t.Error("organization-wide grant applies at facility A")
	}
	if perms, _ := svc.Permissions(ctx, p); len(perms) != 1 || perms[0] != perm {
		t.Errorf("permissions = %v", perms)
	}

	// Suspension ends the session at the next request.
	mustExec(t, e.rt, `UPDATE iam.users SET status = 'suspended', status_reason = 'integration test' WHERE id = $1::uuid`, p.UserID)
	if _, err := svc.Authenticate(ctx, res.Token, ri); err != ErrNoSession {
		t.Errorf("suspended: %v", err)
	}
	if n := e.scalar(t, `SELECT count(*) FROM iam.sessions WHERE id_hash = sha256(convert_to($1, 'UTF8'))
                         AND revoke_reason = 'user_deactivated'`, res.Token); n != 1 {
		t.Error("session not revoked as user_deactivated")
	}

	// Audit trail: expected events, no typed IDs or passwords, chain intact.
	rows, err := e.admin.Query(ctx, `SELECT action || ':' || outcome FROM audit.audit_events WHERE request_id = $1 ORDER BY seq`, ri.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		got = append(got, s)
	}
	want := []string{"session.sign_in:failure", "iam.user.provisioned:success", "session.sign_in:success",
		"permission.check:denied", "permission.check:denied", "session.revoked:success"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("audit:\n got  %v\n want %v", got, want)
	}
	if n := e.scalar(t, `SELECT count(*) FROM audit.audit_events WHERE request_id = $1
                         AND (detail::text LIKE '%' || $2 || '%' OR coalesce(actor_id, '') = $3 OR detail::text LIKE '%pw-%')`,
		ri.RequestID, doc, doc); n != 0 {
		t.Errorf("%d audit rows contain the typed user ID or a password", n)
	}
	if n := e.scalar(t, `SELECT count(*) FROM audit.verify_chain() WHERE first_invalid_seq IS NULL`); n != 1 {
		t.Error("audit chain broken")
	}
}

func TestPGConcurrentFirstSignIns(t *testing.T) {
	e := setupPG(t)
	ctx := context.Background()
	v := newFakeVerifier()
	emp := "E" + e.tag
	v.logins[emp] = "pw"
	v.identities[emp] = legacyhms.Identity{Issuer: legacyhms.IssuerEmployee, Subject: emp, DisplayName: "Employee " + e.tag}
	svc := e.service(v, time.Now)

	var wg sync.WaitGroup
	ids := make([]string, 8)
	errs := make([]error, 8)
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res, err := svc.SignIn(ctx, emp, "pw", RequestInfo{RequestID: "it-race-" + e.tag, ClientType: "web"})
			ids[i], errs[i] = res.Principal.UserID, err
		}(i)
	}
	wg.Wait()
	for i := range ids {
		if errs[i] != nil || ids[i] != ids[0] {
			t.Fatalf("sign-in %d: user %s err %v (first %s)", i, ids[i], errs[i], ids[0])
		}
	}
	if n := e.scalar(t, `SELECT count(*) FROM iam.users WHERE display_name = $1`, "Employee "+e.tag); n != 1 {
		t.Errorf("concurrent first sign-ins created %d users, want 1", n)
	}
	if n := e.scalar(t, `SELECT count(*) FROM iam.sessions s JOIN iam.users u ON u.id = s.user_id WHERE u.display_name = $1`,
		"Employee "+e.tag); n != 8 {
		t.Errorf("sessions = %d, want 8", n)
	}
}

func TestPGSessionLifecycle(t *testing.T) {
	e := setupPG(t)
	ctx := context.Background()
	v := newFakeVerifier()
	doc := "S" + e.tag
	v.logins[doc] = "pw"
	v.identities[doc] = legacyhms.Identity{Issuer: legacyhms.IssuerDoctor, Subject: doc}
	c := &clock{t: time.Now().UTC()}
	svc := e.service(v, c.Now)
	ri := RequestInfo{RequestID: "it-life-" + e.tag, ClientType: "web"}

	res, err := svc.SignIn(ctx, doc, "pw", ri)
	if err != nil {
		t.Fatal(err)
	}
	if res.Principal.DisplayName != "Staff "+doc {
		t.Errorf("empty legacy name falls back: %q", res.Principal.DisplayName)
	}
	c.Advance(2 * time.Minute)
	if _, err := svc.Authenticate(ctx, res.Token, ri); err != nil {
		t.Fatal(err)
	}
	var lastSeen time.Time
	_ = e.admin.QueryRow(ctx, `SELECT last_seen_at FROM iam.sessions WHERE id_hash = sha256(convert_to($1, 'UTF8'))`, res.Token).Scan(&lastSeen)
	if !lastSeen.Equal(c.Now().Truncate(time.Microsecond)) {
		t.Errorf("last_seen_at not touched: %v vs %v", lastSeen, c.Now())
	}
	v.inactive[doc] = true
	if _, err := svc.Authenticate(ctx, res.Token, ri); err != ErrNoSession {
		t.Errorf("legacy-inactive identity: %v", err)
	}

	res2, _ := svc.SignIn(ctx, "D001", "correct-horse", ri)
	if err := svc.SignOut(ctx, res2.Principal, ri); err != nil {
		t.Fatal(err)
	}
	if err := svc.SignOut(ctx, res2.Principal, ri); err != nil {
		t.Fatal("second sign-out must be a no-op")
	}
	if n := e.scalar(t, `SELECT count(*) FROM audit.audit_events WHERE request_id = $1 AND action = 'session.sign_out'`, ri.RequestID); n != 1 {
		t.Errorf("sign-out audited %d times, want 1", n)
	}
}

func mustExec(t *testing.T, db *pgxpool.Pool, q string, args ...any) {
	t.Helper()
	if _, err := db.Exec(context.Background(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}
