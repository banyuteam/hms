package catalogue

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"hms/services/core/httpx"
	"hms/services/platform/iam"
)

// Store is what the handler needs from Service (a fake in unit tests).
type Store interface {
	List(ctx context.Context, c Caller, f Filter) (Page, error)
	Get(ctx context.Context, c Caller, id string) (Source, error)
	Create(ctx context.Context, c Caller, in Input) (Source, error)
	Update(ctx context.Context, c Caller, id string, in Update) (Source, error)
	Delete(ctx context.Context, c Caller, id string, version int) error
	Import(ctx context.Context, c Caller, doc ImportDocument) (int, error)
}

// Request body limits: one source, and an import of up to 500 sources.
const (
	maxSourceBody = 128 << 10
	maxImportBody = 4 << 20
)

type Handler struct {
	store  Store
	iam    *iam.Handler
	logger *slog.Logger
}

func NewHandler(store Store, iamHandler *iam.Handler, logger *slog.Logger) *Handler {
	return &Handler{store: store, iam: iamHandler, logger: logger}
}

// Register mounts the catalogue routes: reading needs a session; every change needs catalogue.manage.
func (h *Handler) Register(mux *http.ServeMux) {
	read := func(pattern string, fn http.HandlerFunc) {
		mux.Handle(pattern, h.iam.RequireSession(fn))
	}
	manage := func(pattern string, fn http.HandlerFunc) {
		mux.Handle(pattern, h.iam.RequireSession(h.iam.RequirePermission(PermManage, fn)))
	}
	read("GET /api/v1/catalogue/sources", h.list)
	read("GET /api/v1/catalogue/sources/{id}", h.get)
	manage("POST /api/v1/catalogue/sources", h.create)
	manage("PUT /api/v1/catalogue/sources/{id}", h.update)
	manage("DELETE /api/v1/catalogue/sources/{id}", h.delete)
	manage("POST /api/v1/catalogue/import", h.importDocument)
}

func (h *Handler) caller(r *http.Request) Caller {
	p, _ := iam.PrincipalFrom(r.Context())
	ri := h.iam.RequestInfo(r)
	return Caller{UserID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID, RequestID: ri.RequestID,
		ClientAddr: ri.ClientAddr, Channel: ri.ClientType}
}

// decode reads exactly one JSON value with no unknown fields.
func decode(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil || dec.Decode(&struct{}{}) != io.EOF {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, "too_large", "The request is too large.")
			return false
		}
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "Malformed JSON body.")
		return false
	}
	return true
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f, err := ParseFilter(q.Get("q"), q.Get("type"), q.Get("after"), q.Get("limit"))
	if err != nil {
		h.fail(w, err)
		return
	}
	page, err := h.store.List(r.Context(), h.caller(r), f)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	src, err := h.store.Get(r.Context(), h.caller(r), r.PathValue("id"))
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, src)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	if !h.iam.AllowStateChange(w, r) {
		return
	}
	var in Input
	if !decode(w, r, maxSourceBody, &in) {
		return
	}
	src, err := h.store.Create(r.Context(), h.caller(r), in)
	if err != nil {
		h.fail(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/catalogue/sources/"+src.ID)
	httpx.WriteJSON(w, http.StatusCreated, src)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	if !h.iam.AllowStateChange(w, r) {
		return
	}
	var in Update
	if !decode(w, r, maxSourceBody, &in) {
		return
	}
	src, err := h.store.Update(r.Context(), h.caller(r), r.PathValue("id"), in)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, src)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	if !h.iam.AllowStateChange(w, r) {
		return
	}
	version, err := strconv.Atoi(r.URL.Query().Get("version"))
	if err != nil || version < 1 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "version is required.")
		return
	}
	if err := h.store.Delete(r.Context(), h.caller(r), r.PathValue("id"), version); err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) importDocument(w http.ResponseWriter, r *http.Request) {
	if !h.iam.AllowStateChange(w, r) {
		return
	}
	var doc ImportDocument
	if !decode(w, r, maxImportBody, &doc) {
		return
	}
	n, err := h.store.Import(r.Context(), h.caller(r), doc)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]int{"created": n})
}

func (h *Handler) fail(w http.ResponseWriter, err error) {
	var ve ValidationError
	var ie ImportError
	switch {
	case errors.As(err, &ie):
		httpx.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"error":    map[string]string{"code": "invalid_request", "message": "Some catalogue entries are not valid; nothing was imported."},
			"problems": ie.Problems,
		})
	case errors.As(err, &ve):
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", ve.Msg)
	case errors.Is(err, ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Not found.")
	case errors.Is(err, ErrVersionConflict):
		httpx.WriteError(w, http.StatusConflict, "version_conflict", "This entry was changed by someone else; reload it.")
	default:
		h.logger.Error("catalogue request failed", "err", err)
		httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
	}
}
