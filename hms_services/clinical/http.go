package clinical

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"hms/services/core/httpx"
	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

// Permissions enforced by this module (registered in iam.permissions at startup).
const (
	PermPatientRead      = "patient.read"
	PermIdentifierReveal = "patient.identifiers.reveal"
	PermEncounterRead    = "encounter.read"
	PermClinicalRead     = "encounter.clinical.read"
	PermBillingRead      = "billing.read"
)

var Permissions = []iam.PermissionDef{
	{Code: PermPatientRead, Description: "Search patients and view patient profiles (sensitive identifiers masked)"},
	{Code: PermIdentifierReveal, Description: "Reveal one sensitive identifier of a patient (NIK, phone, e-mail, address, BPJS number)"},
	{Code: PermEncounterRead, Description: "View encounters (visits) and find them by encounter number"},
	{Code: PermClinicalRead, Description: "View the clinical timeline of a visit (notes, results, medication, surgery, diagnoses)"},
	{Code: PermBillingRead, Description: "View the bill of a visit as saved by the cashier"},
}

// Reader is the legacy read side (legacyhms.Clinical).
type Reader interface {
	Patient(ctx context.Context, mrn string) (legacyhms.PatientRow, error)
	Identifiers(ctx context.Context, mrn string) (legacyhms.IdentifierRow, error)
	SearchPatients(ctx context.Context, words []string, limit int) ([]legacyhms.PatientHitRow, error)
	Encounter(ctx context.Context, number string) (legacyhms.EncounterRow, error)
	PatientEncounters(ctx context.Context, mrn, before string, limit int) ([]legacyhms.EncounterRow, error)
	SearchEncounters(ctx context.Context, prefix string, limit int) ([]legacyhms.EncounterRow, error)
	SearchEncountersNamed(ctx context.Context, prefix string, limit int) ([]legacyhms.EncounterHitRow, error)
	PayerVisits(ctx context.Context, mrn string, limit int) ([]legacyhms.PayerVisitRow, error)
	PatientAllergies(ctx context.Context, mrn string, limit int) ([]legacyhms.AllergyRow, error)
	Timeline(ctx context.Context, number string) (legacyhms.SectionRows, error)
	Bill(ctx context.Context, number string) (legacyhms.SectionRows, error)
}

// AuditWriter writes audit events (iam.PgStore).
type AuditWriter interface {
	WriteAudit(ctx context.Context, ev audit.Event) error
}

type Handler struct {
	reader Reader
	audit  AuditWriter
	iam    *iam.Handler
	loc    *time.Location
	logger *slog.Logger
	now    func() time.Time
}

func NewHandler(reader Reader, auditor AuditWriter, iamHandler *iam.Handler, loc *time.Location, logger *slog.Logger) *Handler {
	return &Handler{reader: reader, audit: auditor, iam: iamHandler, loc: loc, logger: logger, now: time.Now}
}

func (h *Handler) Register(mux *http.ServeMux) {
	route := func(pattern, perm string, fn http.HandlerFunc) {
		mux.Handle(pattern, h.iam.RequireSession(h.iam.RequirePermission(perm, fn)))
	}
	route("GET /api/v1/patients", PermPatientRead, h.searchPatients)
	route("GET /api/v1/patients/{mrn}", PermPatientRead, h.patient)
	route("GET /api/v1/patients/{mrn}/identifiers/{kind}", PermIdentifierReveal, h.identifier)
	route("GET /api/v1/patients/{mrn}/encounters", PermEncounterRead, h.patientEncounters)
	route("GET /api/v1/patients/{mrn}/payers", PermEncounterRead, h.patientPayers)
	route("GET /api/v1/patients/{mrn}/allergies", PermClinicalRead, h.patientAllergies)
	route("GET /api/v1/encounters", PermEncounterRead, h.searchEncounters)
	route("GET /api/v1/encounters/{number}", PermEncounterRead, h.encounter)
	route("GET /api/v1/encounters/{number}/timeline", PermClinicalRead, h.timeline)
	route("GET /api/v1/encounters/{number}/bill", PermBillingRead, h.bill)
}

var (
	mrnPattern       = regexp.MustCompile(`^[A-Za-z0-9.-]{1,15}$`)
	encounterPattern = regexp.MustCompile(`^[0-9/]{1,17}$`)
	encounterPrefix  = regexp.MustCompile(`^[0-9/]{3,17}$`)
)

// record writes the audit event for this request. false = it could not be written: the caller answers 503 and returns
// no data (fail closed).
func (h *Handler) record(w http.ResponseWriter, r *http.Request, action, outcome, resourceType, resourceID string, detail map[string]string) bool {
	p, _ := iam.PrincipalFrom(r.Context())
	ri := h.iam.RequestInfo(r)
	err := h.audit.WriteAudit(r.Context(), audit.Event{
		OccurredAt: h.now(), Category: audit.CategoryDataAccess, Action: action, Outcome: outcome,
		ActorType: audit.ActorUser, ActorID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		ResourceType: resourceType, ResourceID: resourceID, Channel: ri.ClientType, RequestID: ri.RequestID,
		ClientAddr: ri.ClientAddr, Detail: detail,
	})
	if err != nil {
		h.logger.Error("audit write failed; data withheld", "action", action, "err", err)
		unavailable(w)
		return false
	}
	return true
}

func unavailable(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not_found", "Not found.")
}

// legacyFailed answers a legacy read error: not found is audited as a failed access, anything else is 503.
func (h *Handler) legacyFailed(w http.ResponseWriter, r *http.Request, err error, action, resourceType, id string) {
	if errors.Is(err, legacyhms.ErrNotFound) {
		if h.record(w, r, action, audit.OutcomeFailure, resourceType, id, map[string]string{"reason": "not_found"}) {
			notFound(w)
		}
		return
	}
	h.logger.Error("legacy read failed", "action", action, "err", err)
	unavailable(w)
}

func limitParam(r *http.Request, def, max int) (int, bool) {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return def, true
	}
	n, err := strconv.Atoi(raw)
	return n, err == nil && n >= 1 && n <= max
}

// searchWords validates ?q= for patients: 2–64 characters, at most 5 distinct words, no control characters.
func searchWords(raw string) ([]string, bool) {
	text := strings.TrimSpace(raw)
	if !utf8.ValidString(text) || strings.IndexFunc(text, unicode.IsControl) >= 0 {
		return nil, false
	}
	if n := utf8.RuneCountInString(text); n < 2 || n > 64 {
		return nil, false
	}
	var words []string
	seen := map[string]bool{}
	for _, w := range strings.Fields(text) {
		if k := strings.ToLower(w); !seen[k] {
			seen[k] = true
			words = append(words, w)
		}
	}
	return words, len(words) >= 1 && len(words) <= legacyhms.MaxSearchWords
}

func (h *Handler) searchPatients(w http.ResponseWriter, r *http.Request) {
	words, ok := searchWords(r.URL.Query().Get("q"))
	limit, okLimit := limitParam(r, 25, 25)
	if !ok || !okLimit {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"q must be 2-64 characters with at most 5 words; limit 1-25.")
		return
	}
	rows, err := h.reader.SearchPatients(r.Context(), words, limit)
	if err != nil {
		h.logger.Error("legacy patient search failed", "err", err)
		unavailable(w)
		return
	}
	hits := make([]PatientHit, 0, len(rows))
	for _, row := range rows {
		hits = append(hits, MapHit(row))
	}
	// The search text is never recorded (it may be a name); the result count is.
	if h.record(w, r, "patient.search", audit.OutcomeSuccess, "Patient", "", map[string]string{"results": strconv.Itoa(len(hits))}) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"patients": hits})
	}
}

func (h *Handler) patient(w http.ResponseWriter, r *http.Request) {
	mrn := r.PathValue("mrn")
	if !mrnPattern.MatchString(mrn) {
		notFound(w)
		return
	}
	row, err := h.reader.Patient(r.Context(), mrn)
	if err != nil {
		h.legacyFailed(w, r, err, "patient.read", "Patient", mrn)
		return
	}
	if h.record(w, r, "patient.read", audit.OutcomeSuccess, "Patient", mrn, nil) {
		httpx.WriteJSON(w, http.StatusOK, MapPatient(row))
	}
}

func (h *Handler) identifier(w http.ResponseWriter, r *http.Request) {
	mrn, kind := r.PathValue("mrn"), r.PathValue("kind")
	known := false
	for _, k := range IdentifierKinds {
		known = known || k == kind
	}
	if !mrnPattern.MatchString(mrn) || !known {
		notFound(w)
		return
	}
	row, err := h.reader.Identifiers(r.Context(), mrn)
	if err != nil {
		h.legacyFailed(w, r, err, "patient.identifier.reveal", "Patient", mrn)
		return
	}
	value := Identifier(row, kind)
	if value == "" {
		if h.record(w, r, "patient.identifier.reveal", audit.OutcomeFailure, "Patient", mrn,
			map[string]string{"kind": kind, "reason": "not_recorded"}) {
			notFound(w)
		}
		return
	}
	// Recorded before the value leaves the server; the value itself is never in the audit trail.
	if h.record(w, r, "patient.identifier.reveal", audit.OutcomeSuccess, "Patient", mrn, map[string]string{"kind": kind}) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"value": value})
	}
}

func (h *Handler) mapEncounters(rows []legacyhms.EncounterRow) []Encounter {
	out := make([]Encounter, 0, len(rows))
	for _, row := range rows {
		out = append(out, MapEncounter(row, h.loc))
	}
	return out
}

func (h *Handler) patientEncounters(w http.ResponseWriter, r *http.Request) {
	mrn := r.PathValue("mrn")
	if !mrnPattern.MatchString(mrn) {
		notFound(w)
		return
	}
	before := r.URL.Query().Get("before")
	limit, ok := limitParam(r, 100, 100)
	if !ok || (before != "" && !encounterPattern.MatchString(before)) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "limit 1-100; before must be an encounter number.")
		return
	}
	rows, err := h.reader.PatientEncounters(r.Context(), mrn, before, limit)
	if err != nil {
		h.logger.Error("legacy encounter list failed", "err", err)
		unavailable(w)
		return
	}
	resp := map[string]any{"encounters": h.mapEncounters(rows)}
	if len(rows) == limit {
		resp["next_before"] = Clean(rows[len(rows)-1].Number)
	}
	if h.record(w, r, "encounter.list", audit.OutcomeSuccess, "Patient", mrn, map[string]string{"results": strconv.Itoa(len(rows))}) {
		httpx.WriteJSON(w, http.StatusOK, resp)
	}
}

// MaxPayerVisits caps the visits read for the payer history; beyond it the answer says `truncated`.
const MaxPayerVisits = 500

// patientPayers lists the payers used on a patient's visits (`reg_periksa.kd_pj` → `penjab`), each with its visits.
func (h *Handler) patientPayers(w http.ResponseWriter, r *http.Request) {
	mrn := r.PathValue("mrn")
	if !mrnPattern.MatchString(mrn) {
		notFound(w)
		return
	}
	rows, err := h.reader.PayerVisits(r.Context(), mrn, MaxPayerVisits+1)
	if err != nil {
		h.logger.Error("legacy payer history failed", "err", err)
		unavailable(w)
		return
	}
	truncated := len(rows) > MaxPayerVisits
	if truncated {
		rows = rows[:MaxPayerVisits]
	}
	history := MapPayerHistory(mrn, rows, truncated, h.loc)
	detail := map[string]string{"results": strconv.Itoa(len(rows)), "payers": strconv.Itoa(len(history.Payers))}
	if truncated {
		detail["truncated"] = "visits"
	}
	if h.record(w, r, "patient.payers.read", audit.OutcomeSuccess, "Patient", mrn, detail) {
		httpx.WriteJSON(w, http.StatusOK, history)
	}
}

// MaxAllergyRows caps the allergy entries read for a patient; beyond it the answer says `truncated`.
const MaxAllergyRows = 2000

// patientAllergies lists every allergy text recorded for the patient across visits (outpatient and inpatient notes,
// discharge summaries), so an allergy written at an earlier visit is not missed. Texts are returned as written.
func (h *Handler) patientAllergies(w http.ResponseWriter, r *http.Request) {
	mrn := r.PathValue("mrn")
	if !mrnPattern.MatchString(mrn) {
		notFound(w)
		return
	}
	rows, err := h.reader.PatientAllergies(r.Context(), mrn, MaxAllergyRows+1)
	if err != nil {
		h.logger.Error("legacy allergy list failed", "err", err)
		unavailable(w)
		return
	}
	truncated := len(rows) > MaxAllergyRows
	if truncated {
		rows = rows[:MaxAllergyRows]
	}
	list := MapAllergies(rows, truncated, h.loc)
	// Counts only: the allergy text is clinical content and never enters the audit trail.
	detail := map[string]string{"results": strconv.Itoa(len(list.Allergies)), "entries": strconv.Itoa(len(rows))}
	if truncated {
		detail["truncated"] = "entries"
	}
	if h.record(w, r, "patient.allergies.read", audit.OutcomeSuccess, "Patient", mrn, detail) {
		httpx.WriteJSON(w, http.StatusOK, list)
	}
}

// searchEncounters finds visits by number. Callers who may also read patients get each visit's patient name, so a
// mistyped number is noticed before the wrong patient's record is opened; for others the name is omitted (encounter.read
// alone does not disclose names).
func (h *Handler) searchEncounters(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit, ok := limitParam(r, 25, 25)
	if !ok || !encounterPrefix.MatchString(q) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "q must be the start of an encounter number (3-17 characters); limit 1-25.")
		return
	}
	named, err := h.iam.Can(r, PermPatientRead)
	if err != nil {
		unavailable(w)
		return
	}
	var resp any
	var results int
	if named {
		rows, err := h.reader.SearchEncountersNamed(r.Context(), q, limit)
		if err != nil {
			h.logger.Error("legacy encounter search failed", "err", err)
			unavailable(w)
			return
		}
		hits := make([]EncounterHit, 0, len(rows))
		for _, row := range rows {
			hits = append(hits, MapEncounterHit(row, h.loc))
		}
		resp, results = map[string]any{"encounters": hits}, len(rows)
	} else {
		rows, err := h.reader.SearchEncounters(r.Context(), q, limit)
		if err != nil {
			h.logger.Error("legacy encounter search failed", "err", err)
			unavailable(w)
			return
		}
		resp, results = map[string]any{"encounters": h.mapEncounters(rows)}, len(rows)
	}
	names := "omitted"
	if named {
		names = "included"
	}
	if h.record(w, r, "encounter.search", audit.OutcomeSuccess, "Encounter", "",
		map[string]string{"results": strconv.Itoa(results), "names": names}) {
		httpx.WriteJSON(w, http.StatusOK, resp)
	}
}

func (h *Handler) encounter(w http.ResponseWriter, r *http.Request) {
	number := r.PathValue("number")
	if !encounterPattern.MatchString(number) {
		notFound(w)
		return
	}
	row, err := h.reader.Encounter(r.Context(), number)
	if err != nil {
		h.legacyFailed(w, r, err, "encounter.read", "Encounter", number)
		return
	}
	if h.record(w, r, "encounter.read", audit.OutcomeSuccess, "Encounter", number, nil) {
		httpx.WriteJSON(w, http.StatusOK, MapEncounter(row, h.loc))
	}
}

// truncatedDetail records which sections hit their cap (never any values).
func truncatedDetail(sections []string) map[string]string {
	if len(sections) == 0 {
		return nil
	}
	return map[string]string{"truncated": strings.Join(sections, ",")}
}

func (h *Handler) timeline(w http.ResponseWriter, r *http.Request) {
	number := r.PathValue("number")
	if !encounterPattern.MatchString(number) {
		notFound(w)
		return
	}
	rows, err := h.reader.Timeline(r.Context(), number)
	if err != nil {
		h.legacyFailed(w, r, err, "encounter.timeline.read", "Encounter", number)
		return
	}
	if h.record(w, r, "encounter.timeline.read", audit.OutcomeSuccess, "Encounter", number, truncatedDetail(rows.Truncated)) {
		httpx.WriteJSON(w, http.StatusOK, MapTimeline(number, rows, h.loc))
	}
}

func (h *Handler) bill(w http.ResponseWriter, r *http.Request) {
	number := r.PathValue("number")
	if !encounterPattern.MatchString(number) {
		notFound(w)
		return
	}
	rows, err := h.reader.Bill(r.Context(), number)
	if err != nil {
		h.legacyFailed(w, r, err, "encounter.bill.read", "Encounter", number)
		return
	}
	if h.record(w, r, "encounter.bill.read", audit.OutcomeSuccess, "Encounter", number, truncatedDetail(rows.Truncated)) {
		httpx.WriteJSON(w, http.StatusOK, MapBill(number, rows, h.loc))
	}
}
