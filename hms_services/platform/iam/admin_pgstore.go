package iam

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"hms/services/platform/audit"
)

// lockAdmins serializes changes that could affect who holds the iam-admin role in an organization, so two
// concurrent revocations or suspensions cannot both pass the "not the last administrator" check.
const lockAdminsSQL = `SELECT pg_advisory_xact_lock(hashtextextended('hms.iam.admins:' || $1::text, 0))`

// otherAdminsSQL counts active administrators (assignment in force, user active) other than the excluded
// assignment ($2) and user ($3); pass ” to exclude nothing.
const otherAdminsSQL = `
SELECT count(DISTINCT a.user_id)
FROM iam.role_assignments a
JOIN iam.roles r ON r.id = a.role_id AND r.code = 'iam-admin'
JOIN iam.users u ON u.id = a.user_id AND u.status = 'active'
WHERE a.organization_id = $1::uuid AND a.revoked_at IS NULL
  AND a.valid_from <= now() AND (a.valid_until IS NULL OR a.valid_until > now())
  AND a.id IS DISTINCT FROM NULLIF($2::text, '')::uuid
  AND a.user_id IS DISTINCT FROM NULLIF($3::text, '')::uuid`

func (s *PgStore) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, fn)
}

func detail(ev *audit.Event) map[string]string {
	if ev.Detail == nil {
		ev.Detail = map[string]string{}
	}
	return ev.Detail
}

func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func (s *PgStore) SyncPermissions(ctx context.Context, defs []PermissionDef, ev audit.Event) ([]string, error) {
	var added []string
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		added = nil
		for _, d := range defs {
			var code string
			err := tx.QueryRow(ctx, `INSERT INTO iam.permissions (code, description) VALUES ($1, $2)
                                    ON CONFLICT (code) DO NOTHING RETURNING code`, d.Code, d.Description).Scan(&code)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
			case err != nil:
				return err
			default:
				added = append(added, code)
			}
		}
		if len(added) == 0 {
			return nil
		}
		ev.Detail = map[string]string{"permissions": strings.Join(added, ",")}
		return audit.Write(ctx, tx, ev)
	})
	return added, err
}

func (s *PgStore) ListUsers(ctx context.Context, orgID, status, after string, limit int) ([]UserView, error) {
	rows, err := s.db.Query(ctx, `
SELECT id::text, display_name, status, status_reason, created_at
FROM iam.users
WHERE organization_id = $1::uuid AND ($2::text = '' OR status = $2::text)
  AND ($3::text = '' OR id > NULLIF($3::text, '')::uuid)
ORDER BY id
LIMIT $4`, orgID, status, after, limit)
	if err != nil {
		return nil, err
	}
	users, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (UserView, error) {
		var u UserView
		err := r.Scan(&u.ID, &u.DisplayName, &u.Status, &u.StatusReason, &u.CreatedAt)
		return u, err
	})
	if err != nil {
		return nil, err
	}
	return users, s.attachDetails(ctx, users)
}

func (s *PgStore) GetUser(ctx context.Context, orgID, userID string) (UserView, bool, error) {
	var u UserView
	err := s.db.QueryRow(ctx, `SELECT id::text, display_name, status, status_reason, created_at
                              FROM iam.users WHERE id = $1::uuid AND organization_id = $2::uuid`, userID, orgID).
		Scan(&u.ID, &u.DisplayName, &u.Status, &u.StatusReason, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserView{}, false, nil
	}
	if err != nil {
		return UserView{}, false, err
	}
	users := []UserView{u}
	if err := s.attachDetails(ctx, users); err != nil {
		return UserView{}, false, err
	}
	return users[0], true, nil
}

// attachDetails loads active identity links and active (not revoked) assignments for the listed users.
func (s *PgStore) attachDetails(ctx context.Context, users []UserView) error {
	if len(users) == 0 {
		return nil
	}
	ids := make([]string, len(users))
	index := map[string]int{}
	for i := range users {
		ids[i] = users[i].ID
		index[users[i].ID] = i
		users[i].Identities, users[i].Assignments = []IdentityView{}, []AssignmentView{}
	}
	rows, err := s.db.Query(ctx, `SELECT user_id::text, issuer, subject, last_authenticated_at
                                 FROM iam.external_identities
                                 WHERE user_id = ANY($1::text[]::uuid[]) AND revoked_at IS NULL ORDER BY linked_at`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var uid string
		var v IdentityView
		if err := rows.Scan(&uid, &v.Issuer, &v.Subject, &v.LastAuthenticatedAt); err != nil {
			rows.Close()
			return err
		}
		users[index[uid]].Identities = append(users[index[uid]].Identities, v)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = s.db.Query(ctx, `
SELECT a.user_id::text, a.id::text, a.role_id::text, r.code, a.facility_id::text, a.valid_from, a.valid_until, a.granted_at
FROM iam.role_assignments a JOIN iam.roles r ON r.id = a.role_id
WHERE a.user_id = ANY($1::text[]::uuid[]) AND a.revoked_at IS NULL
ORDER BY a.granted_at`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var uid string
		var v AssignmentView
		if err := rows.Scan(&uid, &v.ID, &v.RoleID, &v.RoleCode, &v.FacilityID, &v.ValidFrom, &v.ValidUntil, &v.GrantedAt); err != nil {
			rows.Close()
			return err
		}
		users[index[uid]].Assignments = append(users[index[uid]].Assignments, v)
	}
	return rows.Err()
}

func (s *PgStore) SetUserStatus(ctx context.Context, orgID, userID, status, reason string, ev audit.Event) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, lockAdminsSQL, orgID); err != nil {
			return err
		}
		var current string
		err := tx.QueryRow(ctx, `SELECT status FROM iam.users WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE`,
			userID, orgID).Scan(&current)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if status != "active" {
			var holds bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (
                SELECT 1 FROM iam.role_assignments a JOIN iam.roles r ON r.id = a.role_id AND r.code = 'iam-admin'
                WHERE a.user_id = $1::uuid AND a.revoked_at IS NULL)`, userID).Scan(&holds); err != nil {
				return err
			}
			var others int
			if err := tx.QueryRow(ctx, otherAdminsSQL, orgID, "", userID).Scan(&others); err != nil {
				return err
			}
			if holds && others == 0 {
				return ErrLastAdmin
			}
		}
		var stored any = reason
		if status == "active" {
			stored = nil
		}
		if _, err := tx.Exec(ctx, `UPDATE iam.users SET status = $2, status_reason = $3 WHERE id = $1::uuid`,
			userID, status, stored); err != nil {
			return err
		}
		if status != "active" {
			// End sessions now rather than at the next request.
			if _, err := tx.Exec(ctx, `UPDATE iam.sessions SET revoked_at = now(), revoke_reason = 'user_deactivated'
                                      WHERE user_id = $1::uuid AND revoked_at IS NULL`, userID); err != nil {
				return err
			}
		}
		detail(&ev)["previous_status"] = current
		return audit.Write(ctx, tx, ev)
	})
}

const rolesSQL = `
SELECT r.id::text, r.code, r.name, r.description, r.status,
       coalesce(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}')
FROM iam.roles r LEFT JOIN iam.role_permissions rp ON rp.role_id = r.id`

func scanRole(r pgx.CollectableRow) (RoleView, error) {
	var v RoleView
	err := r.Scan(&v.ID, &v.Code, &v.Name, &v.Description, &v.Status, &v.Permissions)
	v.System = v.Code == AdminRole
	return v, err
}

func (s *PgStore) ListRoles(ctx context.Context) ([]RoleView, error) {
	rows, err := s.db.Query(ctx, rolesSQL+` GROUP BY r.id ORDER BY r.code`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanRole)
}

func roleByID(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, id string) (RoleView, error) {
	rows, err := q.Query(ctx, rolesSQL+` WHERE r.id = $1::uuid GROUP BY r.id`, id)
	if err != nil {
		return RoleView{}, err
	}
	v, err := pgx.CollectExactlyOneRow(rows, scanRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return RoleView{}, ErrNotFound
	}
	return v, err
}

func (s *PgStore) ListPermissions(ctx context.Context) ([]PermissionView, error) {
	rows, err := s.db.Query(ctx, `SELECT code, description, status FROM iam.permissions ORDER BY code`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PermissionView, error) {
		var v PermissionView
		err := r.Scan(&v.Code, &v.Description, &v.Status)
		return v, err
	})
}

// insertPermissions adds the role's permissions; an unknown code is a validation error.
func insertPermissions(ctx context.Context, tx pgx.Tx, roleID string, perms []string) error {
	_, err := tx.Exec(ctx, `INSERT INTO iam.role_permissions (role_id, permission_code)
                           SELECT $1::uuid, unnest($2::text[]) ON CONFLICT DO NOTHING`, roleID, perms)
	if pgCode(err) == "23503" {
		return ValidationError{"unknown permission code"}
	}
	return err
}

func (s *PgStore) CreateRole(ctx context.Context, code, name, description string, perms []string, ev audit.Event) (RoleView, error) {
	var v RoleView
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx, `INSERT INTO iam.roles (code, name, description) VALUES ($1, $2, NULLIF($3, ''))
                                RETURNING id::text`, code, name, description).Scan(&id)
		if pgCode(err) == "23505" {
			return ErrConflict
		}
		if err != nil {
			return err
		}
		if err := insertPermissions(ctx, tx, id, perms); err != nil {
			return err
		}
		ev.ResourceID = id
		if err := audit.Write(ctx, tx, ev); err != nil {
			return err
		}
		v, err = roleByID(ctx, tx, id)
		return err
	})
	return v, err
}

func (s *PgStore) SetRolePermissions(ctx context.Context, roleID string, perms []string, ev audit.Event) (RoleView, error) {
	var v RoleView
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var code string
		err := tx.QueryRow(ctx, `SELECT code FROM iam.roles WHERE id = $1::uuid FOR UPDATE`, roleID).Scan(&code)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if code == AdminRole {
			return ErrSystemRole
		}
		if _, err := tx.Exec(ctx, `DELETE FROM iam.role_permissions WHERE role_id = $1::uuid AND permission_code <> ALL($2::text[])`,
			roleID, perms); err != nil {
			return err
		}
		if err := insertPermissions(ctx, tx, roleID, perms); err != nil {
			return err
		}
		detail(&ev)["role_code"] = code
		if err := audit.Write(ctx, tx, ev); err != nil {
			return err
		}
		v, err = roleByID(ctx, tx, roleID)
		return err
	})
	return v, err
}

func (s *PgStore) Assign(ctx context.Context, orgID string, g Grant, grantedBy string, ev audit.Event) (string, error) {
	var id string
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, lockAdminsSQL, orgID); err != nil {
			return err
		}
		var code, status string
		err := tx.QueryRow(ctx, `SELECT code, status FROM iam.roles WHERE id = $1::uuid`, g.RoleID).Scan(&code, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if status != "active" {
			return ValidationError{"the role is retired"}
		}
		err = tx.QueryRow(ctx, `
INSERT INTO iam.role_assignments (user_id, role_id, organization_id, facility_id, valid_until, granted_by_user_id, grant_reason)
VALUES ($1::uuid, $2::uuid, $3::uuid, NULLIF($4::text, '')::uuid, $5, $6::uuid, $7)
RETURNING id::text`, g.UserID, g.RoleID, orgID, g.FacilityID, g.ValidUntil, grantedBy, g.Reason).Scan(&id)
		switch pgCode(err) {
		case "23503": // user or facility not in this organization
			return ErrNotFound
		case "23505":
			return ErrConflict
		}
		if err != nil {
			return err
		}
		ev.ResourceID = id
		detail(&ev)["role_code"] = code
		return audit.Write(ctx, tx, ev)
	})
	return id, err
}

func (s *PgStore) Revoke(ctx context.Context, orgID, assignmentID, revokedBy, reason string, ev audit.Event) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, lockAdminsSQL, orgID); err != nil {
			return err
		}
		var userID, code string
		err := tx.QueryRow(ctx, `
SELECT a.user_id::text, r.code FROM iam.role_assignments a JOIN iam.roles r ON r.id = a.role_id
WHERE a.id = $1::uuid AND a.organization_id = $2::uuid AND a.revoked_at IS NULL
FOR UPDATE OF a`, assignmentID, orgID).Scan(&userID, &code)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if userID == revokedBy {
			return ErrSelfChange
		}
		if code == AdminRole {
			var others int
			if err := tx.QueryRow(ctx, otherAdminsSQL, orgID, assignmentID, "").Scan(&others); err != nil {
				return err
			}
			if others == 0 {
				return ErrLastAdmin
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE iam.role_assignments SET revoked_at = now(), revoked_by_user_id = $2::uuid,
                                  revoke_reason = $3 WHERE id = $1::uuid`, assignmentID, revokedBy, reason); err != nil {
			return err
		}
		ev.Detail = map[string]string{"user_id": userID, "role_code": code}
		return audit.Write(ctx, tx, ev)
	})
}

// BootstrapAdmin makes userID the first IAM administrator of the organization: it ensures the iam-admin role with
// its permissions (which must be registered) and grants it organization-wide. It refuses when an administrator
// already exists, so it can only start the system, never bypass the API afterwards.
func (s *PgStore) BootstrapAdmin(ctx context.Context, orgID, userID string, ev audit.Event) (string, error) {
	var id string
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, lockAdminsSQL, orgID); err != nil {
			return err
		}
		var existing int
		if err := tx.QueryRow(ctx, `
SELECT count(*) FROM iam.role_assignments a JOIN iam.roles r ON r.id = a.role_id AND r.code = 'iam-admin'
WHERE a.organization_id = $1::uuid AND a.revoked_at IS NULL`, orgID).Scan(&existing); err != nil {
			return err
		}
		if existing > 0 {
			return ErrConflict
		}
		var status string
		err := tx.QueryRow(ctx, `SELECT status FROM iam.users WHERE id = $1::uuid AND organization_id = $2::uuid`,
			userID, orgID).Scan(&status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if status != "active" {
			return ValidationError{"the user is not active"}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO iam.roles (code, name, description)
            VALUES ($1, 'IAM administrator', 'System role: manages HMS users, roles and role assignments')
            ON CONFLICT (code) DO NOTHING`, AdminRole); err != nil {
			return err
		}
		var roleID string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM iam.roles WHERE code = $1`, AdminRole).Scan(&roleID); err != nil {
			return err
		}
		if err := insertPermissions(ctx, tx, roleID, AdminPermissions); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO iam.role_assignments (user_id, role_id, organization_id, grant_reason)
                                   VALUES ($1::uuid, $2::uuid, $3::uuid, 'bootstrap-admin') RETURNING id::text`,
			userID, roleID, orgID).Scan(&id); err != nil {
			return err
		}
		ev.ResourceID = id
		return audit.Write(ctx, tx, ev)
	})
	return id, err
}
