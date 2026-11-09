package iam

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
)

const (
	tokenBytes       = 32
	touchInterval    = time.Minute // last_seen_at is written at most once a minute per session
	maxDisplayName   = 200
	authMethodLegacy = "legacy_hms_login"
)

type Options struct {
	OrganizationID string // tenant that new users are provisioned into
	FacilityID     string // facility context of new sessions
	IdleTimeout    time.Duration
	AbsoluteTTL    time.Duration
	ActiveCacheTTL time.Duration
	Lockout        LockoutPolicy
	Now            func() time.Time
	Logger         *slog.Logger
}

type Service struct {
	store    Store
	verifier Verifier
	opt      Options
	active   activeCache
}

func NewService(store Store, verifier Verifier, opt Options) *Service {
	if opt.Now == nil {
		opt.Now = time.Now
	}
	if opt.Logger == nil {
		opt.Logger = slog.Default()
	}
	return &Service{store: store, verifier: verifier, opt: opt, active: activeCache{entries: map[string]activeEntry{}}}
}

// RequestInfo describes the request for audit purposes.
type RequestInfo struct {
	RequestID  string
	ClientAddr string
	ClientType string // web | android | ios
}

type SignInResult struct {
	Token       string // session token for the client; only its hash is stored
	Principal   Principal
	Permissions []string
}

// SignIn verifies a legacy login, provisions the user on first sign-in and opens a session.
func (s *Service) SignIn(ctx context.Context, userID, password string, ri RequestInfo) (SignInResult, error) {
	now := s.opt.Now()
	keyHash := accountKeyHash(userID)
	fail := func(outcome, reason, actorID string) {
		ev := s.event(ri, audit.CategoryAuthentication, "session.sign_in", outcome)
		ev.Detail = map[string]string{"reason": reason}
		if actorID != "" {
			ev.ActorType, ev.ActorID = audit.ActorUser, actorID
		}
		s.auditBestEffort(ctx, ev)
	}

	lockedUntil, err := s.store.LockedUntil(ctx, keyHash)
	if err != nil {
		s.opt.Logger.Error("sign-in lockout lookup failed", "err", err)
		return SignInResult{}, ErrUnavailable
	}
	if now.Before(lockedUntil) {
		fail(audit.OutcomeDenied, "locked_out", "")
		return SignInResult{}, ErrLockedOut
	}

	ident, err := s.verifier.Verify(ctx, userID, password)
	switch {
	case errors.Is(err, legacyhms.ErrInvalid):
		if err := s.store.RecordFailure(ctx, keyHash, now, s.opt.Lockout); err != nil {
			s.opt.Logger.Error("recording failed sign-in failed", "err", err)
		}
		fail(audit.OutcomeFailure, "invalid_credentials", "")
		return SignInResult{}, ErrInvalidCredentials
	case err != nil:
		s.opt.Logger.Error("legacy login check failed", "err", err)
		fail(audit.OutcomeFailure, "legacy_unavailable", "")
		return SignInResult{}, ErrUnavailable
	}
	if err := s.store.ClearFailures(ctx, keyHash); err != nil {
		s.opt.Logger.Warn("clearing failed sign-ins failed", "err", err)
	}
	s.active.put(cacheKey(ident.Issuer, ident.Subject), true, now.Add(s.opt.ActiveCacheTTL))

	name := displayName(ident)
	linked, found, err := s.store.FindByIdentity(ctx, ident.Issuer, ident.Subject)
	if err != nil {
		s.opt.Logger.Error("identity lookup failed", "err", err)
		return SignInResult{}, ErrUnavailable
	}
	if !found {
		ev := s.event(ri, audit.CategoryAdministration, "iam.user.provisioned", audit.OutcomeSuccess)
		ev.ActorType = audit.ActorSystem
		ev.ResourceType = "User"
		ev.Detail = map[string]string{"issuer": ident.Issuer}
		if linked, err = s.store.Provision(ctx, s.opt.OrganizationID, name, ident.Issuer, ident.Subject, ev); err != nil {
			s.opt.Logger.Error("user provisioning failed", "err", err)
			return SignInResult{}, ErrUnavailable
		}
	} else if linked.DisplayName != name && strings.TrimSpace(ident.DisplayName) != "" {
		if err := s.store.UpdateDisplayName(ctx, linked.ID, name); err != nil {
			s.opt.Logger.Warn("display name update failed", "err", err)
		} else {
			linked.DisplayName = name
		}
	}
	if linked.Status != "active" {
		fail(audit.OutcomeDenied, "account_"+linked.Status, linked.ID)
		return SignInResult{}, ErrAccountDisabled
	}

	token, hash, err := newToken()
	if err != nil {
		return SignInResult{}, ErrUnavailable
	}
	ns := NewSession{
		IDHash: hash, UserID: linked.ID, IdentityID: linked.IdentityID, FacilityID: s.opt.FacilityID,
		ClientType: ri.ClientType, AuthMethod: authMethodLegacy, CreatedAt: now, AbsoluteExpiresAt: now.Add(s.opt.AbsoluteTTL),
	}
	ev := s.event(ri, audit.CategoryAuthentication, "session.sign_in", audit.OutcomeSuccess)
	ev.ActorType, ev.ActorID = audit.ActorUser, linked.ID
	ev.Detail = map[string]string{"issuer": ident.Issuer}
	if err := s.store.CreateSession(ctx, ns, ev); err != nil {
		s.opt.Logger.Error("session creation failed", "err", err)
		return SignInResult{}, ErrUnavailable
	}
	perms, err := s.store.Permissions(ctx, linked.ID, s.opt.FacilityID)
	if err != nil {
		s.opt.Logger.Error("permission lookup failed", "err", err)
		return SignInResult{}, ErrUnavailable
	}
	return SignInResult{
		Token: token,
		Principal: Principal{
			UserID: linked.ID, OrganizationID: linked.OrganizationID, FacilityID: s.opt.FacilityID,
			DisplayName: linked.DisplayName, ExpiresAt: ns.AbsoluteExpiresAt, sessionHash: hash,
		},
		Permissions: perms,
	}, nil
}

// Authenticate validates a session token: not revoked, within its idle and absolute limits, user active in HMS and
// identity still active in the legacy HMS (re-checked at most every ActiveCacheTTL).
func (s *Service) Authenticate(ctx context.Context, token string, ri RequestInfo) (Principal, error) {
	hash, ok := tokenHash(token)
	if !ok {
		return Principal{}, ErrNoSession
	}
	now := s.opt.Now()
	rec, found, err := s.store.LookupSession(ctx, hash)
	if err != nil {
		s.opt.Logger.Error("session lookup failed", "err", err)
		return Principal{}, ErrUnavailable
	}
	if !found || rec.Revoked || !now.Before(rec.AbsoluteExpiresAt) {
		return Principal{}, ErrNoSession
	}
	revoke := func(reason string, withAudit bool) {
		var ev *audit.Event
		if withAudit {
			e := s.event(ri, audit.CategoryAuthentication, "session.revoked", audit.OutcomeSuccess)
			e.ActorType, e.ActorID = audit.ActorSystem, ""
			e.ResourceType, e.ResourceID = "User", rec.User.ID
			e.Detail = map[string]string{"reason": reason}
			ev = &e
		}
		if err := s.store.RevokeSession(ctx, hash, now, reason, ev); err != nil {
			s.opt.Logger.Error("session revocation failed", "err", err)
		}
	}
	if now.Sub(rec.LastSeenAt) >= s.opt.IdleTimeout {
		revoke("idle_timeout", false)
		return Principal{}, ErrNoSession
	}
	if rec.User.Status != "active" {
		revoke("user_deactivated", true)
		return Principal{}, ErrNoSession
	}
	active, err := s.identityActive(ctx, rec.IdentityIssuer, rec.IdentitySubject, now)
	if err != nil {
		s.opt.Logger.Error("legacy active check failed", "err", err)
		return Principal{}, ErrUnavailable
	}
	if !active {
		revoke("identity_inactive", true)
		return Principal{}, ErrNoSession
	}
	if now.Sub(rec.LastSeenAt) >= touchInterval {
		if err := s.store.TouchSession(ctx, hash, now); err != nil {
			s.opt.Logger.Warn("session touch failed", "err", err)
		}
	}
	return Principal{
		UserID: rec.User.ID, OrganizationID: rec.User.OrganizationID, FacilityID: rec.FacilityID,
		DisplayName: rec.User.DisplayName, ExpiresAt: rec.AbsoluteExpiresAt, sessionHash: hash,
	}, nil
}

// SignOut revokes the caller's session.
func (s *Service) SignOut(ctx context.Context, p Principal, ri RequestInfo) error {
	ev := s.event(ri, audit.CategoryAuthentication, "session.sign_out", audit.OutcomeSuccess)
	ev.ActorType, ev.ActorID = audit.ActorUser, p.UserID
	if err := s.store.RevokeSession(ctx, p.sessionHash, s.opt.Now(), "sign_out", &ev); err != nil {
		s.opt.Logger.Error("sign-out failed", "err", err)
		return ErrUnavailable
	}
	return nil
}

// Permissions lists the caller's permissions in force at the session's facility.
func (s *Service) Permissions(ctx context.Context, p Principal) ([]string, error) {
	perms, err := s.store.Permissions(ctx, p.UserID, p.FacilityID)
	if err != nil {
		s.opt.Logger.Error("permission lookup failed", "err", err)
		return nil, ErrUnavailable
	}
	return perms, nil
}

// Authorize decides whether the caller holds permission at the session's facility. A denial is audited.
func (s *Service) Authorize(ctx context.Context, p Principal, permission string, ri RequestInfo) (bool, error) {
	ok, err := s.store.Can(ctx, p.UserID, permission, p.FacilityID)
	if err != nil {
		s.opt.Logger.Error("authorization check failed", "err", err)
		return false, ErrUnavailable
	}
	if !ok {
		ev := s.event(ri, audit.CategoryAuthorization, "permission.check", audit.OutcomeDenied)
		ev.ActorType, ev.ActorID = audit.ActorUser, p.UserID
		ev.FacilityID = p.FacilityID
		ev.Detail = map[string]string{"permission": permission}
		s.auditBestEffort(ctx, ev)
	}
	return ok, nil
}

func (s *Service) identityActive(ctx context.Context, issuer, subject string, now time.Time) (bool, error) {
	if !strings.HasPrefix(issuer, "legacy-hms:") {
		return true, nil // OIDC identities are checked by their issuer at sign-in
	}
	key := cacheKey(issuer, subject)
	if active, ok := s.active.get(key, now); ok {
		return active, nil
	}
	active, err := s.verifier.Active(ctx, issuer, subject)
	if err != nil {
		return false, err
	}
	if active {
		s.active.put(key, true, now.Add(s.opt.ActiveCacheTTL))
	}
	return active, nil
}

func (s *Service) event(ri RequestInfo, category, action, outcome string) audit.Event {
	return audit.Event{
		OccurredAt: s.opt.Now(), Category: category, Action: action, Outcome: outcome,
		ActorType: audit.ActorAnonymous, OrganizationID: s.opt.OrganizationID, FacilityID: s.opt.FacilityID,
		Channel: ri.ClientType, RequestID: ri.RequestID, ClientAddr: ri.ClientAddr,
	}
}

func (s *Service) auditBestEffort(ctx context.Context, ev audit.Event) {
	if err := s.store.WriteAudit(ctx, ev); err != nil {
		s.opt.Logger.Error("audit write failed", "action", ev.Action, "err", err)
	}
}

// accountKeyHash keys lockout counters by the identifier as typed (case-insensitive), never storing it.
func accountKeyHash(userID string) []byte {
	h := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(userID))))
	return h[:]
}

func newToken() (token string, hash []byte, err error) {
	b := make([]byte, tokenBytes)
	if _, err = rand.Read(b); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(token))
	return token, h[:], nil
}

func tokenHash(token string) ([]byte, bool) {
	if b, err := base64.RawURLEncoding.DecodeString(token); err != nil || len(b) != tokenBytes {
		return nil, false
	}
	h := sha256.Sum256([]byte(token))
	return h[:], true
}

func displayName(id legacyhms.Identity) string {
	name := strings.Join(strings.Fields(id.DisplayName), " ")
	if name == "" {
		name = "Staff " + id.Subject
	}
	if utf8.RuneCountInString(name) > maxDisplayName {
		name = string([]rune(name)[:maxDisplayName])
	}
	return name
}

func cacheKey(issuer, subject string) string { return issuer + "\x00" + subject }

type activeEntry struct {
	active bool
	until  time.Time
}

type activeCache struct {
	mu      sync.Mutex
	entries map[string]activeEntry
}

func (c *activeCache) get(key string, now time.Time) (bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || !now.Before(e.until) {
		delete(c.entries, key)
		return false, false
	}
	return e.active, true
}

func (c *activeCache) put(key string, active bool, until time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = activeEntry{active: active, until: until}
}
