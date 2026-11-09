package iam

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"

	"hms/services/platform/audit"
)

// Permissions enforced by the IAM administration API. Every permission hms_services checks is declared in a
// registry like this one and registered in iam.permissions at startup (SyncPermissions).
const (
	PermUsersRead         = "iam.users.read"
	PermUsersManage       = "iam.users.manage"
	PermRolesManage       = "iam.roles.manage"
	PermAssignmentsManage = "iam.assignments.manage"

	// AdminRole is the system role created by bootstrap-admin. It cannot be edited through the API, and its last
	// active holder in an organization cannot be revoked or suspended.
	AdminRole = "iam-admin"
)

type PermissionDef struct {
	Code        string
	Description string
}

// Registry lists the permissions this service enforces.
var Registry = []PermissionDef{
	{PermUsersRead, "View HMS users, their identities, roles and role assignments"},
	{PermUsersManage, "Suspend, deactivate or reactivate HMS users"},
	{PermRolesManage, "Create roles and change the permissions they contain"},
	{PermAssignmentsManage, "Grant and revoke role assignments"},
}

// AdminPermissions are the permissions of the iam-admin role.
var AdminPermissions = []string{PermUsersRead, PermUsersManage, PermRolesManage, PermAssignmentsManage}

var (
	ErrNotFound   = errors.New("not found")
	ErrConflict   = errors.New("conflict")
	ErrValidation = errors.New("invalid request")
	ErrSelfChange = errors.New("cannot change own access")
	ErrLastAdmin  = errors.New("would remove the last IAM administrator")
	ErrSystemRole = errors.New("system role cannot be changed")
)

// ValidationError carries a safe message for the client.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }
func (e ValidationError) Unwrap() error { return ErrValidation }

type IdentityView struct {
	Issuer              string     `json:"issuer"`
	Subject             string     `json:"subject"`
	LastAuthenticatedAt *time.Time `json:"last_authenticated_at"`
}

type AssignmentView struct {
	ID         string     `json:"id"`
	RoleID     string     `json:"role_id"`
	RoleCode   string     `json:"role_code"`
	FacilityID *string    `json:"facility_id"` // null = whole organization
	ValidFrom  time.Time  `json:"valid_from"`
	ValidUntil *time.Time `json:"valid_until"`
	GrantedAt  time.Time  `json:"granted_at"`
}

type UserView struct {
	ID           string           `json:"id"`
	DisplayName  string           `json:"display_name"`
	Status       string           `json:"status"`
	StatusReason *string          `json:"status_reason"`
	CreatedAt    time.Time        `json:"created_at"`
	Identities   []IdentityView   `json:"identities"`
	Assignments  []AssignmentView `json:"assignments"` // active (not revoked) only
}

type RoleView struct {
	ID          string   `json:"id"`
	Code        string   `json:"code"`
	Name        string   `json:"name"`
	Description *string  `json:"description"`
	Status      string   `json:"status"`
	System      bool     `json:"system"`
	Permissions []string `json:"permissions"`
}

type PermissionView struct {
	Code        string `json:"code"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

// Grant is a role assignment request.
type Grant struct {
	UserID     string
	RoleID     string
	FacilityID string // empty = whole organization
	ValidUntil *time.Time
	Reason     string
}

// AdminStore is the persistence of IAM administration (PgStore). Every method is scoped to one organization where
// users or assignments are involved; rows of other organizations behave as not found.
type AdminStore interface {
	SyncPermissions(ctx context.Context, defs []PermissionDef, ev audit.Event) ([]string, error)
	ListUsers(ctx context.Context, orgID, status, after string, limit int) ([]UserView, error)
	GetUser(ctx context.Context, orgID, userID string) (UserView, bool, error)
	SetUserStatus(ctx context.Context, orgID, userID, status, reason string, ev audit.Event) error
	ListRoles(ctx context.Context) ([]RoleView, error)
	ListPermissions(ctx context.Context) ([]PermissionView, error)
	CreateRole(ctx context.Context, code, name, description string, perms []string, ev audit.Event) (RoleView, error)
	SetRolePermissions(ctx context.Context, roleID string, perms []string, ev audit.Event) (RoleView, error)
	Assign(ctx context.Context, orgID string, g Grant, grantedBy string, ev audit.Event) (string, error)
	Revoke(ctx context.Context, orgID, assignmentID, revokedBy, reason string, ev audit.Event) error
	BootstrapAdmin(ctx context.Context, orgID, userID string, ev audit.Event) (string, error)
}

// Admin implements IAM administration rules on top of AdminStore. Authorization (which permission an endpoint
// needs) is enforced by the HTTP layer; Admin enforces the rules that hold whoever calls.
type Admin struct {
	store AdminStore
	now   func() time.Time
}

func NewAdmin(store AdminStore, now func() time.Time) *Admin {
	if now == nil {
		now = time.Now
	}
	return &Admin{store: store, now: now}
}

var (
	roleCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,63}$`)
	statuses        = []string{"active", "suspended", "deactivated"}
)

func (a *Admin) event(p Principal, ri RequestInfo, action string) audit.Event {
	return audit.Event{
		OccurredAt: a.now(), Category: audit.CategoryAdministration, Action: action, Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorUser, ActorID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		Channel: ri.ClientType, RequestID: ri.RequestID, ClientAddr: ri.ClientAddr,
	}
}

func (a *Admin) ListUsers(ctx context.Context, p Principal, status, after string, limit int) ([]UserView, error) {
	if status != "" && !slices.Contains(statuses, status) {
		return nil, ValidationError{"status must be active, suspended or deactivated"}
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	return a.store.ListUsers(ctx, p.OrganizationID, status, after, limit)
}

func (a *Admin) GetUser(ctx context.Context, p Principal, userID string) (UserView, error) {
	u, found, err := a.store.GetUser(ctx, p.OrganizationID, userID)
	if err == nil && !found {
		err = ErrNotFound
	}
	return u, err
}

func (a *Admin) SetUserStatus(ctx context.Context, p Principal, ri RequestInfo, userID, status, reason string) error {
	reason = strings.TrimSpace(reason)
	switch {
	case !slices.Contains(statuses, status):
		return ValidationError{"status must be active, suspended or deactivated"}
	case status != "active" && reason == "":
		return ValidationError{"a reason is required to suspend or deactivate a user"}
	case len(reason) > 500:
		return ValidationError{"reason is limited to 500 characters"}
	case userID == p.UserID:
		return ErrSelfChange
	}
	ev := a.event(p, ri, "iam.user.status_changed")
	ev.ResourceType, ev.ResourceID = "User", userID
	ev.Detail = map[string]string{"status": status}
	return a.store.SetUserStatus(ctx, p.OrganizationID, userID, status, reason, ev)
}

func (a *Admin) ListRoles(ctx context.Context) ([]RoleView, error) { return a.store.ListRoles(ctx) }
func (a *Admin) ListPermissions(ctx context.Context) ([]PermissionView, error) {
	return a.store.ListPermissions(ctx)
}

func (a *Admin) CreateRole(ctx context.Context, p Principal, ri RequestInfo, code, name, description string, perms []string) (RoleView, error) {
	name, description = strings.TrimSpace(name), strings.TrimSpace(description)
	switch {
	case !roleCodePattern.MatchString(code):
		return RoleView{}, ValidationError{"code must be 2-64 lowercase letters, digits, '-' or '_', starting with a letter"}
	case code == AdminRole:
		return RoleView{}, ErrSystemRole
	case name == "" || len(name) > 200:
		return RoleView{}, ValidationError{"name is required (at most 200 characters)"}
	case len(description) > 1000:
		return RoleView{}, ValidationError{"description is limited to 1000 characters"}
	}
	ev := a.event(p, ri, "iam.role.created")
	ev.ResourceType = "Role"
	ev.Detail = map[string]string{"code": code, "permissions": strings.Join(sortedUnique(perms), ",")}
	return a.store.CreateRole(ctx, code, name, description, sortedUnique(perms), ev)
}

func (a *Admin) SetRolePermissions(ctx context.Context, p Principal, ri RequestInfo, roleID string, perms []string) (RoleView, error) {
	ev := a.event(p, ri, "iam.role.permissions_changed")
	ev.ResourceType, ev.ResourceID = "Role", roleID
	ev.Detail = map[string]string{"permissions": strings.Join(sortedUnique(perms), ",")}
	return a.store.SetRolePermissions(ctx, roleID, sortedUnique(perms), ev)
}

func (a *Admin) Assign(ctx context.Context, p Principal, ri RequestInfo, g Grant) (string, error) {
	g.Reason = strings.TrimSpace(g.Reason)
	switch {
	case g.UserID == p.UserID:
		return "", ErrSelfChange
	case g.Reason == "" || len(g.Reason) > 500:
		return "", ValidationError{"a reason (at most 500 characters) is required"}
	case g.ValidUntil != nil && !g.ValidUntil.After(a.now()):
		return "", ValidationError{"valid_until must be in the future"}
	}
	ev := a.event(p, ri, "iam.role.assigned")
	ev.ResourceType = "RoleAssignment"
	ev.Detail = map[string]string{"user_id": g.UserID, "role_id": g.RoleID, "facility_id": g.FacilityID}
	return a.store.Assign(ctx, p.OrganizationID, g, p.UserID, ev)
}

func (a *Admin) Revoke(ctx context.Context, p Principal, ri RequestInfo, assignmentID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" || len(reason) > 500 {
		return ValidationError{"a reason (at most 500 characters) is required"}
	}
	ev := a.event(p, ri, "iam.role.revoked")
	ev.ResourceType, ev.ResourceID = "RoleAssignment", assignmentID
	return a.store.Revoke(ctx, p.OrganizationID, assignmentID, p.UserID, reason, ev)
}

func sortedUnique(in []string) []string {
	out := slices.Clone(in)
	slices.Sort(out)
	return slices.Compact(out)
}
