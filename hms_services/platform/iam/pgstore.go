package iam

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/platform/audit"
)

// PgStore is the Store on PostgreSQL, connected as the runtime role (hms_iam_rw, hms_audit_append). Every statement
// is schema-qualified; multi-step writes run in one READ COMMITTED transaction (the audit chain requires it).
type PgStore struct{ db *pgxpool.Pool }

func NewPgStore(db *pgxpool.Pool) *PgStore { return &PgStore{db: db} }

func (s *PgStore) LockedUntil(ctx context.Context, keyHash []byte) (time.Time, error) {
	var until *time.Time
	err := s.db.QueryRow(ctx,
		`SELECT locked_until FROM iam.signin_attempts WHERE account_key_hash = $1`, keyHash).Scan(&until)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && until == nil) {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	return *until, nil
}

// RecordFailure counts a failure in the current window (a new window starts when the old one has passed) and locks
// the key when the count reaches the policy limit. One atomic statement, safe under concurrency.
func (s *PgStore) RecordFailure(ctx context.Context, keyHash []byte, now time.Time, p LockoutPolicy) error {
	_, err := s.db.Exec(ctx, `
INSERT INTO iam.signin_attempts AS a (account_key_hash, failures, window_started_at, last_failure_at)
VALUES ($1, 1, $2, $2)
ON CONFLICT (account_key_hash) DO UPDATE SET
    failures = CASE WHEN a.window_started_at <= $2 - make_interval(secs => $3) THEN 1 ELSE a.failures + 1 END,
    window_started_at = CASE WHEN a.window_started_at <= $2 - make_interval(secs => $3) THEN $2 ELSE a.window_started_at END,
    last_failure_at = $2,
    locked_until = CASE
        WHEN a.window_started_at > $2 - make_interval(secs => $3) AND a.failures + 1 >= $4
        THEN $2 + make_interval(secs => $5) ELSE a.locked_until END`,
		keyHash, now, p.Window.Seconds(), p.Failures, p.Duration.Seconds())
	return err
}

func (s *PgStore) ClearFailures(ctx context.Context, keyHash []byte) error {
	_, err := s.db.Exec(ctx, `DELETE FROM iam.signin_attempts WHERE account_key_hash = $1`, keyHash)
	return err
}

const linkedUserSQL = `
SELECT u.id::text, u.organization_id::text, u.display_name, u.status, x.id::text
FROM iam.external_identities x
JOIN iam.users u ON u.id = x.user_id
WHERE x.issuer = $1 AND x.subject = $2 AND x.revoked_at IS NULL`

func (s *PgStore) FindByIdentity(ctx context.Context, issuer, subject string) (LinkedUser, bool, error) {
	return scanLinked(s.db.QueryRow(ctx, linkedUserSQL, issuer, subject))
}

func scanLinked(row pgx.Row) (LinkedUser, bool, error) {
	var u LinkedUser
	err := row.Scan(&u.ID, &u.OrganizationID, &u.DisplayName, &u.Status, &u.IdentityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return LinkedUser{}, false, nil
	}
	return u, err == nil, err
}

func (s *PgStore) Provision(ctx context.Context, organizationID, displayName, issuer, subject string, ev audit.Event) (LinkedUser, error) {
	err := pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		var userID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO iam.users (organization_id, display_name) VALUES ($1::uuid, $2) RETURNING id::text`,
			organizationID, displayName).Scan(&userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO iam.external_identities (user_id, provider_type, issuer, subject)
                                   VALUES ($1::uuid, 'legacy_hms', $2, $3)`, userID, issuer, subject); err != nil {
			return err
		}
		ev.ResourceID = userID
		return audit.Write(ctx, tx, ev)
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		// A concurrent first sign-in linked this identity first: use that user.
		u, found, ferr := s.FindByIdentity(ctx, issuer, subject)
		if ferr == nil && found {
			return u, nil
		}
	}
	if err != nil {
		return LinkedUser{}, fmt.Errorf("provision user: %w", err)
	}
	u, found, err := s.FindByIdentity(ctx, issuer, subject)
	if err == nil && !found {
		err = errors.New("provisioned identity not found")
	}
	return u, err
}

func (s *PgStore) UpdateDisplayName(ctx context.Context, userID, name string) error {
	_, err := s.db.Exec(ctx, `UPDATE iam.users SET display_name = $2 WHERE id = $1::uuid`, userID, name)
	return err
}

func (s *PgStore) CreateSession(ctx context.Context, n NewSession, ev audit.Event) error {
	return pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
INSERT INTO iam.sessions (id_hash, user_id, external_identity_id, facility_id, client_type, auth_method,
                          created_at, last_seen_at, absolute_expires_at)
VALUES ($1, $2::uuid, $3::uuid, NULLIF($4, '')::uuid, $5, $6, $7, $7, $8)`,
			n.IDHash, n.UserID, n.IdentityID, n.FacilityID, n.ClientType, n.AuthMethod, n.CreatedAt, n.AbsoluteExpiresAt); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE iam.external_identities SET last_authenticated_at = $2 WHERE id = $1::uuid`,
			n.IdentityID, n.CreatedAt); err != nil {
			return err
		}
		return audit.Write(ctx, tx, ev)
	})
}

func (s *PgStore) LookupSession(ctx context.Context, idHash []byte) (SessionRecord, bool, error) {
	r := SessionRecord{IDHash: idHash}
	var facility *string
	err := s.db.QueryRow(ctx, `
SELECT u.id::text, u.organization_id::text, u.display_name, u.status, x.issuer, x.subject,
       s.facility_id::text, s.last_seen_at, s.absolute_expires_at, s.revoked_at IS NOT NULL
FROM iam.sessions s
JOIN iam.users u ON u.id = s.user_id
JOIN iam.external_identities x ON x.id = s.external_identity_id
WHERE s.id_hash = $1`, idHash).Scan(&r.User.ID, &r.User.OrganizationID, &r.User.DisplayName, &r.User.Status,
		&r.IdentityIssuer, &r.IdentitySubject, &facility, &r.LastSeenAt, &r.AbsoluteExpiresAt, &r.Revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return SessionRecord{}, false, nil
	}
	if err != nil {
		return SessionRecord{}, false, err
	}
	if facility != nil {
		r.FacilityID = *facility
	}
	return r, true, nil
}

func (s *PgStore) TouchSession(ctx context.Context, idHash []byte, now time.Time) error {
	_, err := s.db.Exec(ctx, `UPDATE iam.sessions SET last_seen_at = $2
                             WHERE id_hash = $1 AND revoked_at IS NULL AND last_seen_at < $2`, idHash, now)
	return err
}

func (s *PgStore) RevokeSession(ctx context.Context, idHash []byte, now time.Time, reason string, ev *audit.Event) error {
	return pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE iam.sessions SET revoked_at = $2, revoke_reason = $3
                                 WHERE id_hash = $1 AND revoked_at IS NULL`, idHash, now, reason)
		if err != nil || tag.RowsAffected() == 0 || ev == nil {
			return err // already revoked: nothing to audit
		}
		return audit.Write(ctx, tx, *ev)
	})
}

// permissionsSQL applies the scope rule of iam.effective_permissions: a grant for facility F or for the whole
// organization of F.
const permissionsSQL = `
SELECT DISTINCT e.permission_code
FROM iam.effective_permissions e
JOIN platform.facilities f ON f.id = $2::uuid AND f.organization_id = e.organization_id
WHERE e.user_id = $1::uuid AND (e.facility_id IS NULL OR e.facility_id = f.id)`

func (s *PgStore) Permissions(ctx context.Context, userID, facilityID string) ([]string, error) {
	perms := []string{}
	if facilityID == "" {
		return perms, nil
	}
	rows, err := s.db.Query(ctx, permissionsSQL+` ORDER BY 1`, userID, facilityID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			rows.Close()
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, rows.Err()
}

func (s *PgStore) Can(ctx context.Context, userID, permission, facilityID string) (bool, error) {
	if facilityID == "" {
		return false, nil
	}
	var ok bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS (`+permissionsSQL+` AND e.permission_code = $3)`,
		userID, facilityID, permission).Scan(&ok)
	return ok, err
}

func (s *PgStore) WriteAudit(ctx context.Context, ev audit.Event) error {
	return audit.Write(ctx, s.db, ev)
}
