package iam

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"hms/services/core/httpx"
)

// IAM administration API (contract: contracts/api/iam-admin-v1.openapi.yaml). Every endpoint requires a session and
// a permission at the session's facility; all data is limited to the caller's organization.
//
//	GET   /api/v1/iam/users                          iam.users.read
//	GET   /api/v1/iam/users/{id}                     iam.users.read
//	PATCH /api/v1/iam/users/{id}                     iam.users.manage        {"status", "reason"}
//	GET   /api/v1/iam/roles                          iam.users.read
//	GET   /api/v1/iam/permissions                    iam.users.read
//	POST  /api/v1/iam/roles                          iam.roles.manage        {"code", "name", "description", "permissions"}
//	PUT   /api/v1/iam/roles/{id}/permissions         iam.roles.manage        {"permissions"}
//	POST  /api/v1/iam/users/{id}/role-assignments    iam.assignments.manage  {"role_id", "facility_id", "valid_until", "reason"}
//	POST  /api/v1/iam/role-assignments/{id}/revoke   iam.assignments.manage  {"reason"}

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// RegisterAdmin mounts the IAM administration endpoints.
func (h *Handler) RegisterAdmin(mux *http.ServeMux, admin *Admin) {
	a := adminHTTP{h: h, admin: admin}
	route := func(pattern, perm string, fn http.HandlerFunc) {
		mux.Handle(pattern, h.RequireSession(h.RequirePermission(perm, fn)))
	}
	route("GET /api/v1/iam/users", PermUsersRead, a.listUsers)
	route("GET /api/v1/iam/users/{id}", PermUsersRead, a.getUser)
	route("PATCH /api/v1/iam/users/{id}", PermUsersManage, a.setUserStatus)
	route("GET /api/v1/iam/roles", PermUsersRead, a.listRoles)
	route("GET /api/v1/iam/permissions", PermUsersRead, a.listPermissions)
	route("POST /api/v1/iam/roles", PermRolesManage, a.createRole)
	route("PUT /api/v1/iam/roles/{id}/permissions", PermRolesManage, a.setRolePermissions)
	route("POST /api/v1/iam/users/{id}/role-assignments", PermAssignmentsManage, a.assign)
	route("POST /api/v1/iam/role-assignments/{id}/revoke", PermAssignmentsManage, a.revoke)
}

type adminHTTP struct {
	h     *Handler
	admin *Admin
}

func (a adminHTTP) listUsers(w http.ResponseWriter, r *http.Request) {
	p, _ := PrincipalFrom(r.Context())
	q := r.URL.Query()
	after := q.Get("after")
	if after != "" && !uuidPattern.MatchString(after) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "after must be a user id")
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	users, err := a.admin.ListUsers(r.Context(), p, q.Get("status"), after, limit)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	resp := map[string]any{"users": users}
	if len(users) > 0 && len(users) == effectiveLimit(limit) {
		resp["next_after"] = users[len(users)-1].ID // more may follow
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

func effectiveLimit(limit int) int {
	if limit <= 0 || limit > 200 {
		return 100
	}
	return limit
}

func (a adminHTTP) getUser(w http.ResponseWriter, r *http.Request) {
	p, _ := PrincipalFrom(r.Context())
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	u, err := a.admin.GetUser(r.Context(), p, id)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, u)
}

func (a adminHTTP) setUserStatus(w http.ResponseWriter, r *http.Request) {
	if !a.h.unsafeRequestAllowed(w, r) {
		return
	}
	p, _ := PrincipalFrom(r.Context())
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var body struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := a.admin.SetUserStatus(r.Context(), p, a.h.requestInfo(r), id, body.Status, body.Reason); err != nil {
		a.fail(w, r, err)
		return
	}
	u, err := a.admin.GetUser(r.Context(), p, id)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, u)
}

func (a adminHTTP) listRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := a.admin.ListRoles(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"roles": roles})
}

func (a adminHTTP) listPermissions(w http.ResponseWriter, r *http.Request) {
	perms, err := a.admin.ListPermissions(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"permissions": perms})
}

func (a adminHTTP) createRole(w http.ResponseWriter, r *http.Request) {
	if !a.h.unsafeRequestAllowed(w, r) {
		return
	}
	p, _ := PrincipalFrom(r.Context())
	var body struct {
		Code        string   `json:"code"`
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions"`
	}
	if !decode(w, r, &body) {
		return
	}
	role, err := a.admin.CreateRole(r.Context(), p, a.h.requestInfo(r), body.Code, body.Name, body.Description, body.Permissions)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, role)
}

func (a adminHTTP) setRolePermissions(w http.ResponseWriter, r *http.Request) {
	if !a.h.unsafeRequestAllowed(w, r) {
		return
	}
	p, _ := PrincipalFrom(r.Context())
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var body struct {
		Permissions []string `json:"permissions"`
	}
	if !decode(w, r, &body) {
		return
	}
	role, err := a.admin.SetRolePermissions(r.Context(), p, a.h.requestInfo(r), id, body.Permissions)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, role)
}

func (a adminHTTP) assign(w http.ResponseWriter, r *http.Request) {
	if !a.h.unsafeRequestAllowed(w, r) {
		return
	}
	p, _ := PrincipalFrom(r.Context())
	userID, ok := pathID(w, r)
	if !ok {
		return
	}
	var body struct {
		RoleID     string     `json:"role_id"`
		FacilityID *string    `json:"facility_id"`
		ValidUntil *time.Time `json:"valid_until"`
		Reason     string     `json:"reason"`
	}
	if !decode(w, r, &body) {
		return
	}
	g := Grant{UserID: userID, RoleID: body.RoleID, ValidUntil: body.ValidUntil, Reason: body.Reason}
	if body.FacilityID != nil {
		g.FacilityID = *body.FacilityID
	}
	if !uuidPattern.MatchString(g.RoleID) || (g.FacilityID != "" && !uuidPattern.MatchString(g.FacilityID)) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "role_id and facility_id must be ids")
		return
	}
	id, err := a.admin.Assign(r.Context(), p, a.h.requestInfo(r), g)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (a adminHTTP) revoke(w http.ResponseWriter, r *http.Request) {
	if !a.h.unsafeRequestAllowed(w, r) {
		return
	}
	p, _ := PrincipalFrom(r.Context())
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := a.admin.Revoke(r.Context(), p, a.h.requestInfo(r), id, body.Reason); err != nil {
		a.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pathID reads {id}; a malformed id is answered as not found, like an id of another organization.
func pathID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !uuidPattern.MatchString(id) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Not found.")
		return "", false
	}
	return id, true
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "Malformed JSON body.")
		return false
	}
	return true
}

func (a adminHTTP) fail(w http.ResponseWriter, r *http.Request, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", ve.Msg)
	case errors.Is(err, ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Not found.")
	case errors.Is(err, ErrConflict):
		httpx.WriteError(w, http.StatusConflict, "conflict", "This already exists or is already in force.")
	case errors.Is(err, ErrSelfChange):
		httpx.WriteError(w, http.StatusForbidden, "self_change_not_allowed", "You cannot change your own status or role assignments.")
	case errors.Is(err, ErrLastAdmin):
		httpx.WriteError(w, http.StatusConflict, "last_admin", "This would leave the organization without an active IAM administrator.")
	case errors.Is(err, ErrSystemRole):
		httpx.WriteError(w, http.StatusForbidden, "system_role", "The iam-admin system role cannot be changed here.")
	default:
		a.h.svc.opt.Logger.Error("iam administration failed", "request_id", httpx.RequestID(r.Context()), "err", err)
		httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
	}
}
