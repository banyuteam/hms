package iam

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"time"

	"hms/services/core/httpx"
)

// HTTP API (contract: hms_services/contracts/api/auth-v1.openapi.yaml):
//
//	POST /api/v1/auth/sign-in   {"user_id": "...", "password": "..."} -> session cookie + session body
//	GET  /api/v1/auth/session   -> current session (401 without one)
//	POST /api/v1/auth/sign-out  -> 204, cookie cleared
//
// The web client keeps the session in an HttpOnly, SameSite=Strict cookie. State-changing requests must come from
// PublicOrigin (Origin header, or Sec-Fetch-Site: same-origin) and carry a JSON body type.
type HTTPOptions struct {
	PublicOrigin   *url.URL
	SecureCookies  bool
	TrustedProxies []netip.Prefix
	SignInPerIP    int // sign-in attempts per client address per minute
	Now            func() time.Time
}

type Handler struct {
	svc     *Service
	opt     HTTPOptions
	cookie  string
	limiter *httpx.WindowLimiter
}

var userIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$`)

func NewHandler(svc *Service, opt HTTPOptions) *Handler {
	if opt.Now == nil {
		opt.Now = time.Now
	}
	name := "hms_session"
	if opt.SecureCookies {
		name = "__Host-hms_session" // requires Secure, Path=/ and no Domain: cannot be set by a sibling host
	}
	return &Handler{svc: svc, opt: opt, cookie: name, limiter: httpx.NewWindowLimiter(opt.SignInPerIP, time.Minute, opt.Now)}
}

// Register mounts the auth endpoints on mux.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/sign-in", h.signIn)
	mux.Handle("GET /api/v1/auth/session", h.RequireSession(http.HandlerFunc(h.session)))
	mux.Handle("POST /api/v1/auth/sign-out", h.RequireSession(http.HandlerFunc(h.signOut)))
}

type signInRequest struct {
	UserID   string `json:"user_id"`
	Password string `json:"password"`
}

type sessionResponse struct {
	User struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
	} `json:"user"`
	OrganizationID string    `json:"organization_id"`
	FacilityID     string    `json:"facility_id,omitempty"`
	ExpiresAt      time.Time `json:"expires_at"`
	Permissions    []string  `json:"permissions"`
}

func (h *Handler) signIn(w http.ResponseWriter, r *http.Request) {
	if !h.unsafeRequestAllowed(w, r) {
		return
	}
	ri := h.requestInfo(r)
	if !h.limiter.Allow(ri.ClientAddr) {
		w.Header().Set("Retry-After", "60")
		httpx.WriteError(w, http.StatusTooManyRequests, "too_many_requests", "Too many sign-in attempts. Try again later.")
		return
	}
	var req signInRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || !userIDPattern.MatchString(req.UserID) ||
		req.Password == "" || len(req.Password) > 128 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "User ID and password are required.")
		return
	}
	res, err := h.svc.SignIn(r.Context(), req.UserID, req.Password, ri)
	switch {
	case errors.Is(err, ErrInvalidCredentials):
		httpx.WriteError(w, http.StatusUnauthorized, "invalid_credentials", "User ID or password is incorrect.")
		return
	case errors.Is(err, ErrLockedOut):
		w.Header().Set("Retry-After", "900")
		httpx.WriteError(w, http.StatusTooManyRequests, "too_many_attempts", "Too many failed sign-ins. Try again later.")
		return
	case errors.Is(err, ErrAccountDisabled):
		httpx.WriteError(w, http.StatusForbidden, "account_disabled", "This account is not active in HMS. Contact IT.")
		return
	case err != nil:
		httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Sign-in is temporarily unavailable.")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: h.cookie, Value: res.Token, Path: "/", HttpOnly: true, Secure: h.opt.SecureCookies,
		SameSite: http.SameSiteStrictMode, Expires: res.Principal.ExpiresAt,
		MaxAge: int(res.Principal.ExpiresAt.Sub(h.opt.Now()).Seconds()),
	})
	httpx.WriteJSON(w, http.StatusOK, toResponse(res.Principal, res.Permissions))
}

func (h *Handler) session(w http.ResponseWriter, r *http.Request) {
	p, _ := PrincipalFrom(r.Context())
	perms, err := h.svc.Permissions(r.Context(), p)
	if err != nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toResponse(p, perms))
}

func (h *Handler) signOut(w http.ResponseWriter, r *http.Request) {
	if !h.unsafeRequestAllowed(w, r) {
		return
	}
	p, _ := PrincipalFrom(r.Context())
	if err := h.svc.SignOut(r.Context(), p, h.requestInfo(r)); err != nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
		return
	}
	h.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// RequireSession authenticates the request from its session cookie and puts the Principal in the context.
func (h *Handler) RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(h.cookie)
		if err != nil {
			httpx.WriteError(w, http.StatusUnauthorized, "unauthenticated", "Sign in required.")
			return
		}
		p, err := h.svc.Authenticate(r.Context(), c.Value, h.requestInfo(r))
		switch {
		case errors.Is(err, ErrNoSession):
			h.clearCookie(w)
			httpx.WriteError(w, http.StatusUnauthorized, "unauthenticated", "Sign in required.")
			return
		case err != nil:
			httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
			return
		}
		next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
	})
}

// RequirePermission allows the request only when the caller holds permission at the session's facility. Use it
// inside RequireSession.
func (h *Handler) RequirePermission(permission string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := PrincipalFrom(r.Context())
		if !ok {
			httpx.WriteError(w, http.StatusUnauthorized, "unauthenticated", "Sign in required.")
			return
		}
		allowed, err := h.svc.Authorize(r.Context(), p, permission, h.requestInfo(r))
		switch {
		case err != nil:
			httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
		case !allowed:
			httpx.WriteError(w, http.StatusForbidden, "forbidden", "You do not have permission for this action.")
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// unsafeRequestAllowed blocks cross-site state changes: the request must come from the public origin and be JSON
// (a cross-site form cannot send application/json without a CORS preflight, which this API never grants).
func (h *Handler) unsafeRequestAllowed(w http.ResponseWriter, r *http.Request) bool {
	if !h.sameOrigin(w, r) {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.ContentLength != 0 &&
		!strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		httpx.WriteError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Use application/json.")
		return false
	}
	return true
}

// sameOrigin requires the public origin (Origin header, or Sec-Fetch-Site: same-origin). false = 403 written.
func (h *Handler) sameOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == h.opt.PublicOrigin.String() || (origin == "" && r.Header.Get("Sec-Fetch-Site") == "same-origin") {
		return true
	}
	httpx.WriteError(w, http.StatusForbidden, "origin_not_allowed", "Request origin not allowed.")
	return false
}

func (h *Handler) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: h.cookie, Value: "", Path: "/", HttpOnly: true, Secure: h.opt.SecureCookies,
		SameSite: http.SameSiteStrictMode, MaxAge: -1})
}

// RequestInfo describes a request for audit events written by other modules.
func (h *Handler) RequestInfo(r *http.Request) RequestInfo { return h.requestInfo(r) }

// AllowStateChange applies the same-origin and JSON checks of state-changing requests for other modules' POST routes.
// false = the error has been written.
func (h *Handler) AllowStateChange(w http.ResponseWriter, r *http.Request) bool {
	return h.unsafeRequestAllowed(w, r)
}

// AllowUpload applies the same-origin check to a file upload, which is multipart/form-data rather than JSON. A
// cross-site form could send multipart, so the Origin check (and the SameSite=Strict session cookie) is what blocks it.
// false = the error has been written.
func (h *Handler) AllowUpload(w http.ResponseWriter, r *http.Request) bool {
	if !h.sameOrigin(w, r) {
		return false
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		httpx.WriteError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Use multipart/form-data.")
		return false
	}
	return true
}

// Can reports whether the request's caller holds permission at the session's facility, for checks a module makes
// inside a handler (e.g. the data permission of a referenced resource). A denial is audited.
func (h *Handler) Can(r *http.Request, permission string) (bool, error) {
	p, ok := PrincipalFrom(r.Context())
	if !ok {
		return false, nil
	}
	return h.svc.Authorize(r.Context(), p, permission, h.requestInfo(r))
}

func (h *Handler) requestInfo(r *http.Request) RequestInfo {
	return RequestInfo{
		RequestID:  httpx.RequestID(r.Context()),
		ClientAddr: httpx.ClientAddr(r, h.opt.TrustedProxies),
		ClientType: "web",
	}
}

func toResponse(p Principal, perms []string) sessionResponse {
	var resp sessionResponse
	resp.User.ID, resp.User.DisplayName = p.UserID, p.DisplayName
	resp.OrganizationID, resp.FacilityID, resp.ExpiresAt = p.OrganizationID, p.FacilityID, p.ExpiresAt.UTC()
	resp.Permissions = perms
	if resp.Permissions == nil {
		resp.Permissions = []string{}
	}
	return resp
}
