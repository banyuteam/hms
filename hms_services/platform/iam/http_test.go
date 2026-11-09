package iam

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"hms/services/core/httpx"
)

const origin = "https://hms.test.invalid"

func newServer(t *testing.T, f *fixture, perIP int) (*httptest.Server, *Handler) {
	t.Helper()
	u, _ := url.Parse(origin)
	h := NewHandler(f.svc, HTTPOptions{PublicOrigin: u, SecureCookies: true, SignInPerIP: perIP, Now: f.clock.Now})
	mux := http.NewServeMux()
	h.Register(mux)
	mux.Handle("GET /api/v1/test/patients", h.RequireSession(h.RequirePermission("patient.read",
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))))
	srv := httptest.NewServer(httpx.Middleware(slog.New(slog.NewTextHandler(io.Discard, nil)), mux))
	t.Cleanup(srv.Close)
	return srv, h
}

func post(t *testing.T, srv *httptest.Server, path, body string, hdr map[string]string, cookie *http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+path, strings.NewReader(body))
	req.Header.Set("Origin", origin)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func get(t *testing.T, srv *httptest.Server, path string, cookie *http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func errorCode(t *testing.T, r *http.Response) string {
	t.Helper()
	var b httpx.ErrorBody
	_ = json.NewDecoder(r.Body).Decode(&b)
	return b.Error.Code
}

func sessionCookie(r *http.Response) *http.Cookie {
	for _, c := range r.Cookies() {
		if c.Name == "__Host-hms_session" {
			return c
		}
	}
	return nil
}

func TestSignInSessionSignOut(t *testing.T) {
	f := newFixture()
	srv, _ := newServer(t, f, 100)

	r := post(t, srv, "/api/v1/auth/sign-in", `{"user_id":"D001","password":"correct-horse"}`, nil, nil)
	if r.StatusCode != http.StatusOK {
		t.Fatalf("sign-in status %d", r.StatusCode)
	}
	c := sessionCookie(r)
	if c == nil || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode || c.Path != "/" || c.MaxAge <= 0 {
		t.Fatalf("session cookie flags wrong: %+v", c)
	}
	var body sessionResponse
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.User.DisplayName != "dr. Test" || body.Permissions == nil {
		t.Errorf("body %+v", body)
	}
	if r.Header.Get("Cache-Control") != "no-store" {
		t.Error("auth responses must not be cached")
	}

	if g := get(t, srv, "/api/v1/auth/session", c); g.StatusCode != http.StatusOK {
		t.Errorf("session status %d", g.StatusCode)
	}
	if g := get(t, srv, "/api/v1/test/patients", c); g.StatusCode != http.StatusForbidden || errorCode(t, g) != "forbidden" {
		t.Errorf("a new user has no permissions: %d", g.StatusCode)
	}
	f.store.perms[body.User.ID+"|fac-1"] = []string{"patient.read"}
	if g := get(t, srv, "/api/v1/test/patients", c); g.StatusCode != http.StatusOK {
		t.Errorf("granted permission: %d", g.StatusCode)
	}

	o := post(t, srv, "/api/v1/auth/sign-out", "", map[string]string{"Content-Type": ""}, c)
	if o.StatusCode != http.StatusNoContent {
		t.Errorf("sign-out status %d", o.StatusCode)
	}
	if cleared := sessionCookie(o); cleared == nil || cleared.MaxAge >= 0 && cleared.Value != "" {
		t.Errorf("cookie not cleared: %+v", cleared)
	}
	if g := get(t, srv, "/api/v1/auth/session", c); g.StatusCode != http.StatusUnauthorized {
		t.Errorf("after sign-out: %d", g.StatusCode)
	}
}

func TestSignInErrorsDoNotRevealWhichPartWasWrong(t *testing.T) {
	f := newFixture()
	srv, _ := newServer(t, f, 100)
	wrongPw := post(t, srv, "/api/v1/auth/sign-in", `{"user_id":"D001","password":"nope"}`, nil, nil)
	unknown := post(t, srv, "/api/v1/auth/sign-in", `{"user_id":"X999","password":"nope"}`, nil, nil)
	a, _ := io.ReadAll(wrongPw.Body)
	b, _ := io.ReadAll(unknown.Body)
	if wrongPw.StatusCode != http.StatusUnauthorized || string(a) != string(b) {
		t.Errorf("responses differ: %d %s / %d %s", wrongPw.StatusCode, a, unknown.StatusCode, b)
	}
}

func TestRequestGuards(t *testing.T) {
	f := newFixture()
	srv, _ := newServer(t, f, 100)
	good := `{"user_id":"D001","password":"correct-horse"}`
	cases := []struct {
		name   string
		body   string
		hdr    map[string]string
		status int
		code   string
	}{
		{"cross-site origin", good, map[string]string{"Origin": "https://evil.test.invalid"}, 403, "origin_not_allowed"},
		{"no origin, cross-site fetch", good, map[string]string{"Origin": "", "Sec-Fetch-Site": "cross-site"}, 403, "origin_not_allowed"},
		{"form post", good, map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, 415, "unsupported_media_type"},
		{"unknown field", `{"user_id":"D001","password":"x","role":"admin"}`, nil, 400, "invalid_request"},
		{"bad user id", `{"user_id":"' OR 1=1 --","password":"x"}`, nil, 400, "invalid_request"},
		{"empty password", `{"user_id":"D001","password":""}`, nil, 400, "invalid_request"},
		{"oversized body", `{"user_id":"D001","password":"` + strings.Repeat("x", 5000) + `"}`, nil, 400, "invalid_request"},
	}
	for _, tc := range cases {
		r := post(t, srv, "/api/v1/auth/sign-in", tc.body, tc.hdr, nil)
		if r.StatusCode != tc.status || errorCode(t, r) != tc.code {
			t.Errorf("%s: got %d", tc.name, r.StatusCode)
		}
	}
	if r := post(t, srv, "/api/v1/auth/sign-in", good, map[string]string{"Origin": "", "Sec-Fetch-Site": "same-origin"}, nil); r.StatusCode != 200 {
		t.Errorf("same-origin fetch without Origin must be allowed: %d", r.StatusCode)
	}
	if g := get(t, srv, "/api/v1/auth/session", nil); g.StatusCode != http.StatusUnauthorized || errorCode(t, g) != "unauthenticated" {
		t.Errorf("no cookie: %d", g.StatusCode)
	}
}

func TestSignOutRequiresSameOrigin(t *testing.T) {
	f := newFixture()
	srv, _ := newServer(t, f, 100)
	c := sessionCookie(post(t, srv, "/api/v1/auth/sign-in", `{"user_id":"D001","password":"correct-horse"}`, nil, nil))
	if r := post(t, srv, "/api/v1/auth/sign-out", "", map[string]string{"Origin": "https://evil.test.invalid"}, c); r.StatusCode != 403 {
		t.Errorf("cross-site sign-out: %d", r.StatusCode)
	}
}

func TestPerIPRateLimitAndLockoutStatus(t *testing.T) {
	f := newFixture()
	srv, _ := newServer(t, f, 3)
	for i := 0; i < 3; i++ {
		post(t, srv, "/api/v1/auth/sign-in", `{"user_id":"D001","password":"wrong"}`, nil, nil)
	}
	r := post(t, srv, "/api/v1/auth/sign-in", `{"user_id":"D001","password":"correct-horse"}`, nil, nil)
	if r.StatusCode != http.StatusTooManyRequests || errorCode(t, r) != "too_many_requests" || r.Header.Get("Retry-After") == "" {
		t.Errorf("per-IP limit: %d", r.StatusCode)
	}

	f2 := newFixture()
	srv2, _ := newServer(t, f2, 100)
	for i := 0; i < 5; i++ {
		post(t, srv2, "/api/v1/auth/sign-in", `{"user_id":"D001","password":"wrong"}`, nil, nil)
	}
	r = post(t, srv2, "/api/v1/auth/sign-in", `{"user_id":"D001","password":"correct-horse"}`, nil, nil)
	if r.StatusCode != http.StatusTooManyRequests || errorCode(t, r) != "too_many_attempts" {
		t.Errorf("account lockout: %d", r.StatusCode)
	}
}

func TestPlainHTTPDevCookie(t *testing.T) {
	f := newFixture()
	u, _ := url.Parse("http://127.0.0.1:5173")
	h := NewHandler(f.svc, HTTPOptions{PublicOrigin: u, SecureCookies: false, SignInPerIP: 10, Now: f.clock.Now})
	if h.cookie != "hms_session" {
		t.Errorf("dev cookie name %q (the __Host- prefix requires HTTPS)", h.cookie)
	}
}
