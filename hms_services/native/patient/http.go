package patient

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"hms/services/canonical/patient"
	"hms/services/core/httpx"
	"hms/services/platform/iam"
)

// Contract: contracts/api/patient-records-v1.openapi.yaml.
//
//	POST /api/v1/patient-records       patient.register  register a patient in HMS (native authority only)
//	GET  /api/v1/patient-records/{id}  patient.read      a canonical patient, native or mapped from the legacy HMS
const (
	PermRegister = "patient.register"
	PermRead     = "patient.read" // registered by package clinical
)

var Permissions = []iam.PermissionDef{
	{Code: PermRegister, Description: "Register new patients in HMS (once patient registration has moved from the legacy HMS)"},
}

type Handler struct {
	svc    *Service
	iam    *iam.Handler
	logger *slog.Logger
}

func NewHandler(svc *Service, iamHandler *iam.Handler, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, iam: iamHandler, logger: logger}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/patient-records", h.iam.RequireSession(h.iam.RequirePermission(PermRegister, http.HandlerFunc(h.register))))
	mux.Handle("GET /api/v1/patient-records/{id}", h.iam.RequireSession(h.iam.RequirePermission(PermRead, http.HandlerFunc(h.get))))
}

// View is a patient as sent to clients. Restricted identifiers (NIK, passport, family card) are masked.
type View struct {
	ID          string           `json:"id"`
	Version     int              `json:"version"`
	Origin      string           `json:"origin"`
	Active      bool             `json:"active"`
	Name        string           `json:"name"`
	Gender      string           `json:"gender"`
	BirthDate   *string          `json:"birth_date"`
	BirthPlace  *string          `json:"birth_place"`
	Identifiers []IdentifierView `json:"identifiers"`
}

type IdentifierView struct {
	System string `json:"system"`
	Value  string `json:"value"`
	Masked bool   `json:"masked"`
}

var restricted = map[string]bool{patient.SystemNIK: true, patient.SystemPaspor: true, patient.SystemKK: true}

// Mask keeps the last four characters.
func Mask(v string) string {
	if len(v) <= 4 {
		return strings.Repeat("•", len(v))
	}
	return strings.Repeat("•", len(v)-4) + v[len(v)-4:]
}

func toView(r patient.Record) View {
	v := View{ID: r.ID, Version: r.Version, Origin: r.Origin, Active: r.Active, Name: r.Name, Gender: r.Gender,
		Identifiers: []IdentifierView{}}
	if r.BirthDate != "" {
		v.BirthDate = &r.BirthDate
	}
	if r.BirthPlace != "" {
		v.BirthPlace = &r.BirthPlace
	}
	for _, i := range r.Identifiers {
		if restricted[i.System] {
			v.Identifiers = append(v.Identifiers, IdentifierView{System: i.System, Value: Mask(i.Value), Masked: true})
		} else {
			v.Identifiers = append(v.Identifiers, IdentifierView{System: i.System, Value: i.Value})
		}
	}
	return v
}

func (h *Handler) caller(r *http.Request) Caller {
	p, _ := iam.PrincipalFrom(r.Context())
	ri := h.iam.RequestInfo(r)
	return Caller{UserID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID, RequestID: ri.RequestID,
		ClientAddr: ri.ClientAddr, Channel: ri.ClientType}
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	if !h.iam.AllowStateChange(w, r) {
		return
	}
	var reg Registration
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&reg); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "Malformed JSON body.")
		return
	}
	rec, created, err := h.svc.Register(r.Context(), h.caller(r), reg)
	if err != nil {
		h.fail(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	w.Header().Set("Location", "/api/v1/patient-records/"+rec.ID)
	httpx.WriteJSON(w, status, toView(rec))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	rec, err := h.svc.Get(r.Context(), h.caller(r), r.PathValue("id"))
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toView(rec))
}

func (h *Handler) fail(w http.ResponseWriter, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", ve.Msg)
	case errors.Is(err, ErrNotNative):
		httpx.WriteError(w, http.StatusConflict, "domain_not_native",
			"Patient registration for this organization is still done in the legacy HMS.")
	case errors.Is(err, ErrIdentifierInUse):
		httpx.WriteError(w, http.StatusConflict, "identifier_in_use", "An identifier is already registered to another patient.")
	case errors.Is(err, ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Not found.")
	default:
		h.logger.Error("patient record request failed", "err", err)
		httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
	}
}
