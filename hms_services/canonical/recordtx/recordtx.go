// Package recordtx runs transactions on canonical records (hms_database ADR-DB-005, ADR-DB-006) with the context the
// database requires: the organization (tenant row-level security), exactly one actor (a person or a service), the
// request id and, for corrections, the reason. Both layers of ADR-ROOT-002 use it: the native transaction layer acts
// as the signed-in user, the legacy bridge as service legacy-bridge. Which layer may write a domain is decided by
// the database (integration.domain_authority), not here.
package recordtx

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BridgeService is the actor service of the legacy bridge. The database reserves it to members of
// hms_legacy_bridge and requires those members to declare it.
const BridgeService = "legacy-bridge"

// Domain authorities (integration.domain_authority.authority).
const (
	AuthorityLegacy  = "legacy"
	AuthorityCutover = "cutover"
	AuthorityNative  = "native"
)

var (
	// ErrNotAuthoritative: the domain is not writable by this layer for the organization (SQLSTATE HM001).
	ErrNotAuthoritative = errors.New("record domain is not writable by this layer")
	// ErrConflict: a unique rule refused the write (SQLSTATE 23505), e.g. an identifier already in use.
	ErrConflict = errors.New("conflicts with an existing record")
	// ErrInvalid: a database rule refused the values (check, foreign key, not null, format).
	ErrInvalid = errors.New("refused by a record rule")
	// ErrNotFound: no such record in the organization.
	ErrNotFound = errors.New("record not found")
)

// Actor is who acts: a person (iam.users.id) or a service, never both.
type Actor struct {
	UserID  string
	Service string
}

func User(id string) Actor      { return Actor{UserID: id} }
func Service(name string) Actor { return Actor{Service: name} }

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Context is the transaction context (hms.* settings, transaction-local).
type Context struct {
	OrganizationID string
	Actor          Actor
	RequestID      string // no PHI
	ChangeReason   string // required to change a finalized record or mark one entered-in-error
}

// Beginner is a pgx pool or connection.
type Beginner interface {
	BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error)
}

var _ Beginner = (*pgxpool.Pool)(nil)

const setContextSQL = `SELECT set_config('hms.organization_id', $1, true), set_config('hms.actor_user_id', $2, true),
       set_config('hms.actor_service', $3, true), set_config('hms.request_id', $4, true),
       set_config('hms.change_reason', $5, true)`

// Write runs fn in a read-committed transaction with the context set, and classifies a database refusal as
// ErrNotAuthoritative, ErrConflict or ErrInvalid (the original error stays wrapped).
func Write(ctx context.Context, db Beginner, c Context, fn func(pgx.Tx) error) error {
	if !uuidPattern.MatchString(c.OrganizationID) || (c.Actor.UserID == "") == (c.Actor.Service == "") {
		return errors.New("recordtx: organization and exactly one actor are required")
	}
	return Classify(pgx.BeginTxFunc(ctx, db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, setContextSQL, c.OrganizationID, c.Actor.UserID, c.Actor.Service, c.RequestID, c.ChangeReason); err != nil {
			return err
		}
		return fn(tx)
	}))
}

// Read runs fn in a read-only transaction that sees only the organization's records.
func Read(ctx context.Context, db Beginner, organizationID string, fn func(pgx.Tx) error) error {
	if !uuidPattern.MatchString(organizationID) {
		return errors.New("recordtx: organization is required")
	}
	return Classify(pgx.BeginTxFunc(ctx, db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT set_config('hms.organization_id', $1, true)`, organizationID); err != nil {
			return err
		}
		return fn(tx)
	}))
}

// Classify maps a database refusal to the package errors.
func Classify(err error) error {
	var pe *pgconn.PgError
	if err == nil || !errors.As(err, &pe) {
		return err
	}
	switch {
	case pe.Code == "HM001":
		return fmt.Errorf("%w: %w", ErrNotAuthoritative, err)
	case pe.Code == "23505":
		return fmt.Errorf("%w: %w", ErrConflict, err)
	case pe.Code == "23514", pe.Code == "23503", pe.Code == "23502", pe.Code == "22P02", pe.Code == "22007", pe.Code == "22008":
		return fmt.Errorf("%w: %w", ErrInvalid, err)
	}
	return err
}

// Constraint returns the name of the constraint that refused err, or "".
func Constraint(err error) string {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.ConstraintName
	}
	return ""
}

// DomainAuthority returns the authority of a domain for the transaction's organization: legacy, cutover, native, or
// "" when none is assigned (then nobody may write it).
func DomainAuthority(ctx context.Context, tx pgx.Tx, domain string) (string, error) {
	var a string
	err := tx.QueryRow(ctx, `SELECT authority FROM integration.domain_authority
WHERE domain = $1 AND organization_id = nullif(current_setting('hms.organization_id', true), '')::uuid`, domain).Scan(&a)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return a, err
}

// CheckLayerRole verifies that the database login belongs to the expected layer: the legacy bridge must connect as
// a member of hms_legacy_bridge, the native runtime must not. A process started with the other layer's credentials
// refuses to run.
func CheckLayerRole(ctx context.Context, db *pgxpool.Pool, wantBridge bool) error {
	var isBridge bool
	if err := db.QueryRow(ctx, `SELECT pg_has_role(current_user, 'hms_legacy_bridge', 'MEMBER')`).Scan(&isBridge); err != nil {
		return fmt.Errorf("check database role: %w", err)
	}
	switch {
	case wantBridge && !isBridge:
		return errors.New("the legacy bridge must connect as the legacy bridge login (member of hms_legacy_bridge)")
	case !wantBridge && isBridge:
		return errors.New("the native runtime must not connect as the legacy bridge login")
	}
	return nil
}
