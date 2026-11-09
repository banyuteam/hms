package iam

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"
)

type fixture struct {
	store *memStore
	ver   *fakeVerifier
	clock *clock
	svc   *Service
}

func newFixture() *fixture {
	f := &fixture{store: newMemStore(), ver: newFakeVerifier(), clock: &clock{t: time.Date(2026, 11, 8, 8, 0, 0, 0, time.UTC)}}
	f.svc = NewService(f.store, f.ver, Options{
		OrganizationID: "org-1", FacilityID: "fac-1",
		IdleTimeout: 15 * time.Minute, AbsoluteTTL: 12 * time.Hour, ActiveCacheTTL: 5 * time.Minute,
		Lockout: LockoutPolicy{Failures: 5, Window: 15 * time.Minute, Duration: 15 * time.Minute},
		Now:     f.clock.Now, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return f
}

var ri = RequestInfo{RequestID: "req-test-0001", ClientAddr: "10.0.0.1", ClientType: "web"}

func TestSignInProvisionsOnceWithNoAccess(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	first, err := f.svc.SignIn(ctx, "D001", "correct-horse", ri)
	if err != nil {
		t.Fatal(err)
	}
	if first.Principal.DisplayName != "dr. Test" || first.Principal.OrganizationID != "org-1" || len(first.Permissions) != 0 {
		t.Errorf("unexpected principal %+v perms %v", first.Principal, first.Permissions)
	}
	second, err := f.svc.SignIn(ctx, "D001", "correct-horse", ri)
	if err != nil || second.Principal.UserID != first.Principal.UserID {
		t.Fatalf("second sign-in must reuse the user: %v %v", second.Principal.UserID, err)
	}
	if first.Token == second.Token || len(first.Token) != 43 {
		t.Errorf("tokens must be fresh 256-bit values: %q %q", first.Token, second.Token)
	}
	want := []string{"iam.user.provisioned:success", "session.sign_in:success", "session.sign_in:success"}
	if got := f.store.auditActions(); !slices.Equal(got, want) {
		t.Errorf("audit = %v, want %v", got, want)
	}
	for _, s := range f.store.sessions {
		if string(s.IDHash) == first.Token {
			t.Error("the raw token must never be stored")
		}
	}
}

func TestSignInFailures(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	if _, err := f.svc.SignIn(ctx, "D001", "wrong", ri); !errors.Is(err, ErrInvalidCredentials) {
		t.Errorf("wrong password: %v", err)
	}
	if _, err := f.svc.SignIn(ctx, "nobody", "x", ri); !errors.Is(err, ErrInvalidCredentials) {
		t.Errorf("unknown user: %v", err)
	}
	for _, e := range f.store.audit {
		if e.ActorID != "" || e.Detail["reason"] != "invalid_credentials" || e.ActorType != "anonymous" {
			t.Errorf("failed sign-in audit must not identify the typed user: %+v", e)
		}
	}
	f.ver.down = true
	if _, err := f.svc.SignIn(ctx, "D001", "correct-horse", ri); !errors.Is(err, ErrUnavailable) {
		t.Errorf("legacy outage must be unavailable, not invalid: %v", err)
	}
}

func TestLockoutBlocksEvenTheRightPassword(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		_, _ = f.svc.SignIn(ctx, "D001", "wrong", ri)
	}
	if _, err := f.svc.SignIn(ctx, "d001 ", "correct-horse", ri); !errors.Is(err, ErrLockedOut) {
		t.Errorf("locked account (any case/spacing) must be refused: %v", err)
	}
	f.clock.Advance(16 * time.Minute)
	if _, err := f.svc.SignIn(ctx, "D001", "correct-horse", ri); err != nil {
		t.Errorf("lock must expire: %v", err)
	}
}

func TestSuspendedUserCannotSignIn(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	res, _ := f.svc.SignIn(ctx, "3301", "battery-staple", ri)
	f.store.users["legacy-hms:pegawai|17"].Status = "suspended"
	if _, err := f.svc.SignIn(ctx, "3301", "battery-staple", ri); !errors.Is(err, ErrAccountDisabled) {
		t.Errorf("suspended: %v", err)
	}
	if _, err := f.svc.Authenticate(ctx, res.Token, ri); !errors.Is(err, ErrNoSession) {
		t.Errorf("existing session of a suspended user must end: %v", err)
	}
	if !slices.Contains(f.store.revokeCalls, "user_deactivated") {
		t.Errorf("revocations = %v", f.store.revokeCalls)
	}
}

func TestAuthenticateLimits(t *testing.T) {
	ctx := context.Background()

	t.Run("valid and touched", func(t *testing.T) {
		f := newFixture()
		res, _ := f.svc.SignIn(ctx, "D001", "correct-horse", ri)
		f.clock.Advance(10 * time.Minute)
		p, err := f.svc.Authenticate(ctx, res.Token, ri)
		if err != nil || p.UserID != res.Principal.UserID || p.FacilityID != "fac-1" {
			t.Fatalf("%+v %v", p, err)
		}
		f.clock.Advance(10 * time.Minute) // 20 min since sign-in, 10 since last use
		if _, err := f.svc.Authenticate(ctx, res.Token, ri); err != nil {
			t.Errorf("activity must extend the idle limit: %v", err)
		}
	})
	t.Run("idle timeout", func(t *testing.T) {
		f := newFixture()
		res, _ := f.svc.SignIn(ctx, "D001", "correct-horse", ri)
		f.clock.Advance(15 * time.Minute)
		if _, err := f.svc.Authenticate(ctx, res.Token, ri); !errors.Is(err, ErrNoSession) {
			t.Errorf("idle: %v", err)
		}
		if !slices.Equal(f.store.revokeCalls, []string{"idle_timeout"}) {
			t.Errorf("revocations = %v", f.store.revokeCalls)
		}
	})
	t.Run("absolute limit", func(t *testing.T) {
		f := newFixture()
		res, _ := f.svc.SignIn(ctx, "D001", "correct-horse", ri)
		for i := 0; i < 48; i++ { // stay active every 14 minutes for 11.2 hours
			f.clock.Advance(14 * time.Minute)
			if _, err := f.svc.Authenticate(ctx, res.Token, ri); err != nil {
				t.Fatalf("active session ended early at step %d: %v", i, err)
			}
		}
		f.clock.Advance(50 * time.Minute)
		if _, err := f.svc.Authenticate(ctx, res.Token, ri); !errors.Is(err, ErrNoSession) {
			t.Errorf("absolute: %v", err)
		}
	})
	t.Run("signed out", func(t *testing.T) {
		f := newFixture()
		res, _ := f.svc.SignIn(ctx, "D001", "correct-horse", ri)
		if err := f.svc.SignOut(ctx, res.Principal, ri); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.Authenticate(ctx, res.Token, ri); !errors.Is(err, ErrNoSession) {
			t.Errorf("after sign-out: %v", err)
		}
	})
	t.Run("malformed and unknown tokens", func(t *testing.T) {
		f := newFixture()
		for _, tok := range []string{"", "abc", "not-base64-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"} {
			if _, err := f.svc.Authenticate(ctx, tok, ri); !errors.Is(err, ErrNoSession) {
				t.Errorf("token %q: %v", tok, err)
			}
		}
	})
}

func TestLegacyInactiveEndsSessionWithinCacheTTL(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	res, _ := f.svc.SignIn(ctx, "D001", "correct-horse", ri)
	f.ver.inactive["D001"] = true // the doctor leaves the hospital

	f.clock.Advance(4 * time.Minute)
	if _, err := f.svc.Authenticate(ctx, res.Token, ri); err != nil {
		t.Errorf("within the cache TTL the earlier answer is reused: %v", err)
	}
	if f.ver.activeCalls != 0 {
		t.Errorf("sign-in already confirmed activity; calls = %d", f.ver.activeCalls)
	}
	f.clock.Advance(2 * time.Minute)
	if _, err := f.svc.Authenticate(ctx, res.Token, ri); !errors.Is(err, ErrNoSession) {
		t.Errorf("inactive identity must end the session: %v", err)
	}
	if !slices.Contains(f.store.revokeCalls, "identity_inactive") || !slices.Contains(f.store.auditActions(), "session.revoked:success") {
		t.Errorf("revocations %v, audit %v", f.store.revokeCalls, f.store.auditActions())
	}
}

func TestLegacyOutageFailsClosed(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	res, _ := f.svc.SignIn(ctx, "D001", "correct-horse", ri)
	f.clock.Advance(6 * time.Minute)
	f.ver.down = true
	if _, err := f.svc.Authenticate(ctx, res.Token, ri); !errors.Is(err, ErrUnavailable) {
		t.Errorf("cannot confirm the identity: must be unavailable, got %v", err)
	}
	if len(f.store.revokeCalls) != 0 {
		t.Error("an outage must not end sessions")
	}
}

func TestAuthorizeAuditsDenials(t *testing.T) {
	f := newFixture()
	ctx := context.Background()
	res, _ := f.svc.SignIn(ctx, "D001", "correct-horse", ri)
	f.store.perms[res.Principal.UserID+"|fac-1"] = []string{"patient.read"}
	if ok, err := f.svc.Authorize(ctx, res.Principal, "patient.read", ri); !ok || err != nil {
		t.Errorf("granted: %v %v", ok, err)
	}
	if ok, _ := f.svc.Authorize(ctx, res.Principal, "billing.post", ri); ok {
		t.Error("not granted must be denied")
	}
	if got := f.store.auditActions(); got[len(got)-1] != "permission.check:denied" {
		t.Errorf("denial not audited: %v", got)
	}
}
