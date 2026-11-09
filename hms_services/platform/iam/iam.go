// Package iam implements sign-in, sessions and authorization checks against the iam schema (hms_database migration
// 0005, ADR-DB-003). hms_services is the authorization authority; the database persists grants.
//
// Sign-in is verified by the legacy HMS (no credential is stored here). On a first successful sign-in the person is
// provisioned as an HMS user with no roles (owner decision 2026-11-08): they can sign in but are permitted nothing
// until an administrator grants a role.
package iam

import (
	"context"
	"errors"
	"time"

	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrLockedOut          = errors.New("too many failed sign-ins")
	ErrAccountDisabled    = errors.New("account disabled")
	ErrUnavailable        = errors.New("identity service unavailable")
	ErrNoSession          = errors.New("no valid session")
)

// Verifier checks legacy logins (legacyhms.Checker).
type Verifier interface {
	Verify(ctx context.Context, userID, password string) (legacyhms.Identity, error)
	Active(ctx context.Context, issuer, subject string) (bool, error)
}

// User is an iam.users row.
type User struct {
	ID             string
	OrganizationID string
	DisplayName    string
	Status         string // active | suspended | deactivated
}

// LinkedUser is a user reached through an active external identity link.
type LinkedUser struct {
	User
	IdentityID string
}

// NewSession is what CreateSession persists.
type NewSession struct {
	IDHash            []byte
	UserID            string
	IdentityID        string
	FacilityID        string
	ClientType        string
	AuthMethod        string
	CreatedAt         time.Time
	AbsoluteExpiresAt time.Time
}

// SessionRecord is a stored session with what validation needs.
type SessionRecord struct {
	IDHash            []byte
	User              User
	IdentityIssuer    string
	IdentitySubject   string
	FacilityID        string
	LastSeenAt        time.Time
	AbsoluteExpiresAt time.Time
	Revoked           bool
}

// LockoutPolicy is the failed sign-in rule: Failures within Window lock the account key for Duration.
type LockoutPolicy struct {
	Failures int
	Window   time.Duration
	Duration time.Duration
}

// Store is the iam persistence the service needs (PgStore in production).
type Store interface {
	LockedUntil(ctx context.Context, keyHash []byte) (time.Time, error)
	RecordFailure(ctx context.Context, keyHash []byte, now time.Time, p LockoutPolicy) error
	ClearFailures(ctx context.Context, keyHash []byte) error

	FindByIdentity(ctx context.Context, issuer, subject string) (LinkedUser, bool, error)
	// Provision creates a user and its identity link with the audit event in one transaction. If another request
	// linked the identity first it returns that user.
	Provision(ctx context.Context, organizationID, displayName, issuer, subject string, ev audit.Event) (LinkedUser, error)
	UpdateDisplayName(ctx context.Context, userID, name string) error

	// CreateSession stores the session, stamps the identity's last authentication and writes ev, atomically.
	CreateSession(ctx context.Context, s NewSession, ev audit.Event) error
	LookupSession(ctx context.Context, idHash []byte) (SessionRecord, bool, error)
	TouchSession(ctx context.Context, idHash []byte, now time.Time) error
	// RevokeSession revokes an active session and writes ev (when not nil) atomically.
	RevokeSession(ctx context.Context, idHash []byte, now time.Time, reason string, ev *audit.Event) error

	Permissions(ctx context.Context, userID, facilityID string) ([]string, error)
	Can(ctx context.Context, userID, permission, facilityID string) (bool, error)

	WriteAudit(ctx context.Context, ev audit.Event) error
}

// Principal is the authenticated caller of a request.
type Principal struct {
	UserID         string
	OrganizationID string
	FacilityID     string
	DisplayName    string
	ExpiresAt      time.Time
	sessionHash    []byte
}

type principalKey struct{}

// WithPrincipal stores the principal in the request context.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

// PrincipalFrom returns the authenticated caller, if any.
func PrincipalFrom(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}
