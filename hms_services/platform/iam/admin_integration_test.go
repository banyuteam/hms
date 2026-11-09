package iam

// IAM administration over HTTP against PostgreSQL (see pgstore_integration_test.go for the environment variables).

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"hms/services/core/httpx"
	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/tenancy"
)

type adminEnv struct {
	*pgEnv
	srv   *httptest.Server
	store *PgStore
	ver   *fakeVerifier
}

func setupAdmin(t *testing.T) *adminEnv {
	e := setupPG(t)
	v := newFakeVerifier()
	svc := e.service(v, time.Now)
	store := NewPgStore(e.rt)
	u, _ := url.Parse(origin)
	h := NewHandler(svc, HTTPOptions{PublicOrigin: u, SecureCookies: true, SignInPerIP: 1000})
	mux := http.NewServeMux()
	h.Register(mux)
	h.RegisterAdmin(mux, NewAdmin(store, nil))
	srv := httptest.NewServer(httpx.Middleware(slog.New(slog.NewTextHandler(io.Discard, nil)), mux))
	t.Cleanup(srv.Close)
	if _, err := store.SyncPermissions(context.Background(), Registry, audit.Event{Category: audit.CategoryAdministration,
		Action: "iam.permission.registered", Outcome: audit.OutcomeSuccess, ActorType: audit.ActorSystem, Channel: "system"}); err != nil {
		t.Fatal(err)
	}
	return &adminEnv{pgEnv: e, srv: srv, store: store, ver: v}
}

// person registers a legacy staff member in the fake legacy HMS and signs them in.
func (a *adminEnv) person(t *testing.T, name string) (userID string, cookie *http.Cookie) {
	t.Helper()
	login := name + a.tag
	a.ver.mu.Lock()
	a.ver.logins[login] = "pw"
	a.ver.identities[login] = legacyhms.Identity{Issuer: legacyhms.IssuerEmployee, Subject: login, DisplayName: name + " " + a.tag}
	a.ver.mu.Unlock()
	return a.signIn(t, login)
}

func (a *adminEnv) signIn(t *testing.T, login string) (string, *http.Cookie) {
	t.Helper()
	r := post(t, a.srv, "/api/v1/auth/sign-in", fmt.Sprintf(`{"user_id":%q,"password":"pw"}`, login), nil, nil)
	if r.StatusCode != http.StatusOK {
		t.Fatalf("sign-in %s: %d", login, r.StatusCode)
	}
	var body sessionResponse
	_ = json.NewDecoder(r.Body).Decode(&body)
	return body.User.ID, sessionCookie(r)
}

func (a *adminEnv) call(t *testing.T, method, path, body string, c *http.Cookie) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(method, a.srv.URL+path, strings.NewReader(body))
	req.Header.Set("Origin", origin)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if c != nil {
		req.AddCookie(c)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func errCode(m map[string]any) string {
	if e, ok := m["error"].(map[string]any); ok {
		return fmt.Sprint(e["code"])
	}
	return ""
}

func (a *adminEnv) expect(t *testing.T, label string, wantStatus int, wantCode string, status int, body map[string]any) {
	t.Helper()
	if status != wantStatus || (wantCode != "" && errCode(body) != wantCode) {
		t.Errorf("%s: got %d %s, want %d %s", label, status, errCode(body), wantStatus, wantCode)
	}
}

func TestPGAdministration(t *testing.T) {
	a := setupAdmin(t)
	ctx := context.Background()
	alice, aliceC := a.person(t, "Alice")
	bob, bobC := a.person(t, "Bob")
	carol, carolC := a.person(t, "Carol")

	// Nobody is an administrator yet.
	s, b := a.call(t, "GET", "/api/v1/iam/users", "", bobC)
	a.expect(t, "no permission", 403, "forbidden", s, b)

	// Bootstrap: once only.
	ev := audit.Event{Category: audit.CategoryAdministration, Action: "iam.role.assigned", Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorSystem, OrganizationID: a.orgID, Channel: "system", RequestID: "it-boot-" + a.tag}
	if _, err := a.store.BootstrapAdmin(ctx, a.orgID, alice, ev); err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.BootstrapAdmin(ctx, a.orgID, bob, ev); err != ErrConflict {
		t.Errorf("second bootstrap must be refused: %v", err)
	}

	// Listing is organization-scoped and paginated.
	s, b = a.call(t, "GET", "/api/v1/iam/users", "", aliceC)
	if s != 200 || len(b["users"].([]any)) != 3 {
		t.Fatalf("admin lists the 3 users of the organization: %d %v", s, b)
	}
	s, b = a.call(t, "GET", "/api/v1/iam/users?limit=2", "", aliceC)
	next, _ := b["next_after"].(string)
	if s != 200 || len(b["users"].([]any)) != 2 || next == "" {
		t.Errorf("first page: %d %v", s, b)
	}
	if s, b = a.call(t, "GET", "/api/v1/iam/users?limit=2&after="+next, "", aliceC); len(b["users"].([]any)) != 1 {
		t.Errorf("second page: %d %v", s, b)
	}

	// Another organization's user is invisible.
	other, err := tenancy.Ensure(ctx, a.rt, tenancy.Setup{OrganizationCode: "O" + a.tag, OrganizationName: "Other",
		FacilityCode: "O" + a.tag + "-F", FacilityName: "Other facility", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	var outsider string
	if err := a.rt.QueryRow(ctx, `INSERT INTO iam.users (organization_id, display_name) VALUES ($1::uuid, 'Outsider') RETURNING id::text`,
		other.OrganizationID).Scan(&outsider); err != nil {
		t.Fatal(err)
	}
	s, b = a.call(t, "GET", "/api/v1/iam/users/"+outsider, "", aliceC)
	a.expect(t, "other organization's user", 404, "not_found", s, b)

	// Roles.
	perm := "test_" + strings.ToLower(a.tag) + ".read"
	mustExec(t, a.rt, `INSERT INTO iam.permissions (code, description) VALUES ($1, 'integration test')`, perm)
	nurseBody := fmt.Sprintf(`{"code":"nurse-%s","name":"Nurse","permissions":[%q]}`, strings.ToLower(a.tag), perm)
	s, b = a.call(t, "POST", "/api/v1/iam/roles", nurseBody, aliceC)
	if s != 201 {
		t.Fatalf("create role: %d %v", s, b)
	}
	nurse := b["id"].(string)
	s, b = a.call(t, "POST", "/api/v1/iam/roles", nurseBody, aliceC)
	a.expect(t, "duplicate role code", 409, "conflict", s, b)
	s, b = a.call(t, "POST", "/api/v1/iam/roles", `{"code":"x-`+strings.ToLower(a.tag)+`","name":"X","permissions":["no.such"]}`, aliceC)
	a.expect(t, "unknown permission", 400, "invalid_request", s, b)
	s, b = a.call(t, "POST", "/api/v1/iam/roles", `{"code":"iam-admin","name":"X","permissions":[]}`, aliceC)
	a.expect(t, "system role code", 403, "system_role", s, b)
	s, b = a.call(t, "GET", "/api/v1/iam/roles", "", aliceC)
	var adminRole string
	for _, r := range b["roles"].([]any) {
		if m := r.(map[string]any); m["code"] == AdminRole {
			adminRole = m["id"].(string)
		}
	}
	s, b = a.call(t, "PUT", "/api/v1/iam/roles/"+adminRole+"/permissions", `{"permissions":[]}`, aliceC)
	a.expect(t, "edit iam-admin", 403, "system_role", s, b)

	// Grants.
	grant := func(who, role, facility, extra string, c *http.Cookie) (int, map[string]any) {
		fac := "null"
		if facility != "" {
			fac = fmt.Sprintf("%q", facility)
		}
		return a.call(t, "POST", "/api/v1/iam/users/"+who+"/role-assignments",
			fmt.Sprintf(`{"role_id":%q,"facility_id":%s,"reason":"integration test"%s}`, role, fac, extra), c)
	}
	s, b = grant(bob, nurse, a.facA, "", aliceC)
	if s != 201 {
		t.Fatalf("grant nurse to Bob at facility A: %d %v", s, b)
	}
	bobNurse := b["id"].(string)
	s, b = grant(bob, nurse, a.facA, "", aliceC)
	a.expect(t, "duplicate grant", 409, "conflict", s, b)
	s, b = grant(alice, nurse, a.facA, "", aliceC)
	a.expect(t, "self grant", 403, "self_change_not_allowed", s, b)
	s, b = grant(bob, nurse, other.FacilityID, "", aliceC)
	a.expect(t, "facility of another organization", 404, "not_found", s, b)
	s, b = grant(outsider, nurse, "", "", aliceC)
	a.expect(t, "user of another organization", 404, "not_found", s, b)
	s, b = grant(carol, nurse, "", `,"valid_until":"2020-01-01T00:00:00Z"`, aliceC)
	a.expect(t, "expired validity", 400, "invalid_request", s, b)
	s, b = a.call(t, "GET", "/api/v1/auth/session", "", bobC)
	if perms := fmt.Sprint(b["permissions"]); !strings.Contains(perms, perm) {
		t.Errorf("Bob's session shows the granted permission: %v", perms)
	}

	// A read-only viewer can list but change nothing.
	viewer := a.createRole(t, aliceC, "viewer", PermUsersRead)
	if s, b = grant(bob, viewer, a.facA, "", aliceC); s != 201 {
		t.Fatalf("grant viewer: %d %v", s, b)
	}
	if s, _ = a.call(t, "GET", "/api/v1/iam/users", "", bobC); s != 200 {
		t.Errorf("viewer lists users: %d", s)
	}
	s, b = a.call(t, "PATCH", "/api/v1/iam/users/"+carol, `{"status":"suspended","reason":"x"}`, bobC)
	a.expect(t, "viewer suspends", 403, "forbidden", s, b)
	s, b = a.call(t, "POST", "/api/v1/iam/roles", `{"code":"v-`+strings.ToLower(a.tag)+`","name":"V","permissions":[]}`, bobC)
	a.expect(t, "viewer creates role", 403, "forbidden", s, b)
	s, b = a.call(t, "PUT", "/api/v1/iam/roles/"+nurse+"/permissions", `{"permissions":[]}`, bobC)
	a.expect(t, "viewer edits role", 403, "forbidden", s, b)
	s, b = grant(carol, nurse, "", "", bobC)
	a.expect(t, "viewer grants", 403, "forbidden", s, b)

	// A second administrator; self and last-admin guards.
	s, b = grant(carol, adminRole, "", "", aliceC)
	if s != 201 {
		t.Fatalf("grant iam-admin to Carol: %d %v", s, b)
	}
	u := a.userView(t, alice, carolC)
	aliceAdmin := u.Assignments[0].ID
	s, b = a.call(t, "POST", "/api/v1/iam/role-assignments/"+aliceAdmin+"/revoke", `{"reason":"test"}`, aliceC)
	a.expect(t, "revoke own assignment", 403, "self_change_not_allowed", s, b)
	s, b = a.call(t, "PATCH", "/api/v1/iam/users/"+carol, `{"status":"suspended","reason":"test"}`, carolC)
	a.expect(t, "suspend self", 403, "self_change_not_allowed", s, b)
	s, b = a.call(t, "POST", "/api/v1/iam/role-assignments/"+aliceAdmin+"/revoke", `{"reason":""}`, carolC)
	a.expect(t, "revoke without reason", 400, "invalid_request", s, b)
	s, b = a.call(t, "POST", "/api/v1/iam/role-assignments/"+aliceAdmin+"/revoke", `{"reason":"rotation"}`, carolC)
	a.expect(t, "Carol revokes Alice's admin", 204, "", s, b)
	s, b = a.call(t, "GET", "/api/v1/iam/users", "", aliceC)
	a.expect(t, "Alice is no longer admin", 403, "forbidden", s, b)

	// Carol is now the only administrator. A user manager may not suspend her; a grantor may not revoke her.
	mgr := a.createRole(t, carolC, "mgr", PermUsersRead, PermUsersManage, PermAssignmentsManage)
	if s, b = grant(bob, mgr, "", "", carolC); s != 201 {
		t.Fatalf("grant manager to Bob: %d %v", s, b)
	}
	s, b = a.call(t, "PATCH", "/api/v1/iam/users/"+carol, `{"status":"suspended","reason":"test"}`, bobC)
	a.expect(t, "suspend the last admin", 409, "last_admin", s, b)
	carolAdmin := a.userView(t, carol, bobC).Assignments[0].ID
	s, b = a.call(t, "POST", "/api/v1/iam/role-assignments/"+carolAdmin+"/revoke", `{"reason":"test"}`, bobC)
	a.expect(t, "revoke the last admin", 409, "last_admin", s, b)

	// Suspension ends sessions at once and blocks sign-in; reactivation restores sign-in.
	s, b = a.call(t, "PATCH", "/api/v1/iam/users/"+alice, `{"status":"suspended"}`, carolC)
	a.expect(t, "suspend without reason", 400, "invalid_request", s, b)
	s, b = a.call(t, "PATCH", "/api/v1/iam/users/"+alice, `{"status":"suspended","reason":"left the unit"}`, carolC)
	if s != 200 || b["status"] != "suspended" {
		t.Fatalf("suspend Alice: %d %v", s, b)
	}
	s, b = a.call(t, "GET", "/api/v1/auth/session", "", aliceC)
	a.expect(t, "suspended session", 401, "unauthenticated", s, b)
	r := post(t, a.srv, "/api/v1/auth/sign-in", fmt.Sprintf(`{"user_id":"Alice%s","password":"pw"}`, a.tag), nil, nil)
	if r.StatusCode != 403 {
		t.Errorf("suspended sign-in: %d", r.StatusCode)
	}
	if s, _ = a.call(t, "PATCH", "/api/v1/iam/users/"+alice, `{"status":"active"}`, carolC); s != 200 {
		t.Errorf("reactivate: %d", s)
	}
	a.signIn(t, "Alice"+a.tag)

	// Revoke Bob's nurse grant: the permission disappears from his session.
	if s, _ = a.call(t, "POST", "/api/v1/iam/role-assignments/"+bobNurse+"/revoke", `{"reason":"test"}`, carolC); s != 204 {
		t.Errorf("revoke nurse: %d", s)
	}
	_, b = a.call(t, "GET", "/api/v1/auth/session", "", bobC)
	if strings.Contains(fmt.Sprint(b["permissions"]), perm) {
		t.Error("revoked permission still in force")
	}

	// Every change is audited and the chain is intact.
	for _, action := range []string{"iam.role.created", "iam.role.assigned", "iam.role.revoked", "iam.user.status_changed"} {
		if n := a.scalar(t, `SELECT count(*) FROM audit.audit_events WHERE organization_id = $1::uuid AND action = $2
                             AND actor_type = 'user'`, a.orgID, action); n == 0 {
			t.Errorf("no %s audit event", action)
		}
	}
	if n := a.scalar(t, `SELECT count(*) FROM audit.verify_chain() WHERE first_invalid_seq IS NULL`); n != 1 {
		t.Error("audit chain broken")
	}
}

func (a *adminEnv) userView(t *testing.T, id string, c *http.Cookie) UserView {
	t.Helper()
	req, _ := http.NewRequest("GET", a.srv.URL+"/api/v1/iam/users/"+id, nil)
	req.AddCookie(c)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("get user %s: %v %v", id, err, resp.StatusCode)
	}
	defer resp.Body.Close()
	var u UserView
	_ = json.NewDecoder(resp.Body).Decode(&u)
	return u
}

func (a *adminEnv) createRole(t *testing.T, c *http.Cookie, name string, perms ...string) string {
	t.Helper()
	q := make([]string, len(perms))
	for i, p := range perms {
		q[i] = fmt.Sprintf("%q", p)
	}
	s, b := a.call(t, "POST", "/api/v1/iam/roles",
		fmt.Sprintf(`{"code":"%s-%s","name":%q,"permissions":[%s]}`, name, strings.ToLower(a.tag), name, strings.Join(q, ",")), c)
	if s != 201 {
		t.Fatalf("create role %s: %d %v", name, s, b)
	}
	return b["id"].(string)
}
