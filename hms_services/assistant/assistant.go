// Package assistant serves the assistant's deterministic rule evaluation (contract assistant-v1, ADR-SVC-006). No
// language model and no generated text: rule sets in package rules run over legacy data read through package
// legacyhms, for resources the user selected explicitly. Evaluation never changes state.
package assistant

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"hms/services/assistant/rules"
	"hms/services/clinical"
	"hms/services/core/httpx"
	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

// PermEvaluate allows running assistant rule sets; each rule set also needs the read permission of its data.
const PermEvaluate = "assistant.rules.evaluate"

var Permissions = []iam.PermissionDef{
	{Code: PermEvaluate, Description: "Run assistant checks (claim readiness) on a visit the user may also read"},
	{Code: PermFeedbackReview, Description: "Read aggregate feedback on assistant checks (counts, no comment text)"},
	{Code: PermCommentsRead, Description: "Read feedback comments on assistant checks (may contain patient data; audited)"},
}

const (
	maxBody              = 4 << 10
	evaluationsPerMinute = 60 // per user (O-5)
	evaluationTimeout    = 10 * time.Second
)

// Reader is the legacy read side (legacyhms.Clinical).
type Reader interface {
	Timeline(ctx context.Context, number string) (legacyhms.SectionRows, error)
}

// AuditWriter writes audit events (iam.PgStore).
type AuditWriter interface {
	WriteAudit(ctx context.Context, ev audit.Event) error
}

// registered is a rule set with the permission its data is read with and how it reads and evaluates one visit.
// ErrNotFound from the reader means the visit does not exist.
type registered struct {
	set            rules.RuleSet
	dataPermission string
	evaluate       func(ctx context.Context, r Reader, number string, loc *time.Location) (rules.Outcome, error)
}

var registry = []registered{
	{rules.ClaimReadiness, clinical.PermClinicalRead, evaluateClaimReadiness},
}

// evaluateClaimReadiness reads the visit timeline (which includes its SEPs from bridging_sep), then applies the rules.
func evaluateClaimReadiness(ctx context.Context, r Reader, number string, loc *time.Location) (rules.Outcome, error) {
	rows, err := r.Timeline(ctx, number)
	if err != nil {
		return rules.Outcome{}, err
	}
	return rules.EvaluateClaimReadiness(VisitOf(clinical.MapTimeline(number, rows, loc))), nil
}

type Handler struct {
	reader   Reader
	audit    AuditWriter
	receipts ReceiptWriter // nil: no receipts (feedback then finds no evaluation)
	iam      *iam.Handler
	limiter  *httpx.WindowLimiter
	loc      *time.Location
	logger   *slog.Logger
	now      func() time.Time
	newID    func() string
	// From the iam handler; replaced in tests.
	can              func(r *http.Request, permission string) (bool, error)
	allowStateChange func(w http.ResponseWriter, r *http.Request) bool
}

func NewHandler(reader Reader, auditor AuditWriter, iamHandler *iam.Handler, loc *time.Location, logger *slog.Logger) *Handler {
	return &Handler{reader: reader, audit: auditor, iam: iamHandler, loc: loc, logger: logger, now: time.Now, newID: newUUID,
		limiter: httpx.NewWindowLimiter(evaluationsPerMinute, time.Minute, time.Now),
		can:     iamHandler.Can, allowStateChange: iamHandler.AllowStateChange}
}

// WithReceipts makes the handler write an evaluation receipt (ADR-SVC-008 L-1) for every result it returns.
func (h *Handler) WithReceipts(rw ReceiptWriter) *Handler {
	h.receipts = rw
	return h
}

func (h *Handler) Register(mux *http.ServeMux) {
	route := func(pattern string, fn http.HandlerFunc) {
		mux.Handle(pattern, h.iam.RequireSession(h.iam.RequirePermission(PermEvaluate, fn)))
	}
	route("GET /api/v1/assistant/rule-sets", h.ruleSets)
	route("POST /api/v1/assistant/rules/evaluate", h.evaluate)
}

type Reference struct {
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
}

type evaluateRequest struct {
	RuleSet struct {
		ID      string `json:"id"`
		Version *int   `json:"version"`
	} `json:"rule_set"`
	Context struct {
		References []Reference `json:"references"`
	} `json:"context"`
}

type RuleSetRef struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
}

// Evaluation is the response of POST /assistant/rules/evaluate.
type Evaluation struct {
	EvaluationID string     `json:"evaluation_id"`
	EvaluatedAt  string     `json:"evaluated_at"`
	RuleSet      RuleSetRef `json:"rule_set"`
	Reference    Reference  `json:"reference"`
	rules.Outcome
}

var (
	ruleSetPattern   = regexp.MustCompile(`^[a-z][a-z0-9-]{1,63}$`)
	encounterPattern = regexp.MustCompile(`^[0-9/]{1,17}$`)
)

func (h *Handler) ruleSets(w http.ResponseWriter, _ *http.Request) {
	sets := make([]rules.RuleSet, 0, len(registry))
	for _, r := range registry {
		sets = append(sets, r.set)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"rule_sets": sets})
}

func invalid(w http.ResponseWriter, msg string) {
	httpx.WriteError(w, http.StatusBadRequest, "invalid_request", msg)
}

func unavailable(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
}

func (h *Handler) evaluate(w http.ResponseWriter, r *http.Request) {
	if !h.allowStateChange(w, r) {
		return
	}
	p, _ := iam.PrincipalFrom(r.Context())
	if !h.limiter.Allow(p.UserID) {
		w.Header().Set("Retry-After", "60")
		httpx.WriteError(w, http.StatusTooManyRequests, "too_many_requests", "Too many checks. Try again later.")
		return
	}
	var req evaluateRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || dec.Decode(&struct{}{}) != io.EOF {
		invalid(w, "Malformed JSON body.")
		return
	}
	if !ruleSetPattern.MatchString(req.RuleSet.ID) {
		invalid(w, "rule_set.id is required.")
		return
	}
	var rs *registered
	for i := range registry {
		if registry[i].set.ID == req.RuleSet.ID {
			rs = &registry[i]
		}
	}
	if rs == nil || (req.RuleSet.Version != nil && *req.RuleSet.Version != rs.set.Version) {
		httpx.WriteError(w, http.StatusBadRequest, "unsupported_rule_set", "Unknown rule set or version.")
		return
	}
	refs := req.Context.References
	if len(refs) < 1 || len(refs) > rs.set.MaxReferences {
		invalid(w, fmt.Sprintf("context.references must hold 1 to %d references.", rs.set.MaxReferences))
		return
	}
	ref := refs[0]
	if ref.ResourceType != rules.ResourceEncounter || !encounterPattern.MatchString(ref.ResourceID) {
		invalid(w, "Each reference must be an encounter with a valid encounter number.")
		return
	}

	// The data permission is checked before the lookup, so a denial says nothing about whether the visit exists.
	allowed, err := h.can(r, rs.dataPermission)
	if err != nil {
		unavailable(w)
		return
	}
	detail := map[string]string{"rule_set": rs.set.ID, "version": strconv.Itoa(rs.set.Version)}
	if !allowed {
		detail["reason"] = "reference_forbidden"
		if h.record(w, r, audit.OutcomeDenied, ref.ResourceID, detail) {
			httpx.WriteError(w, http.StatusForbidden, "reference_forbidden", "You do not have permission to read this record.")
		}
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), evaluationTimeout)
	defer cancel()
	outcome, err := rs.evaluate(ctx, h.reader, ref.ResourceID, h.loc)
	if errors.Is(err, legacyhms.ErrNotFound) {
		detail["reason"] = "not_found"
		if h.record(w, r, audit.OutcomeFailure, ref.ResourceID, detail) {
			httpx.WriteError(w, http.StatusNotFound, "reference_not_found", "Record not found.")
		}
		return
	}
	if err != nil {
		h.logger.Error("legacy read failed", "action", "assistant.rules.evaluate", "err", err)
		unavailable(w)
		return
	}

	out := Evaluation{
		EvaluationID: h.newID(), EvaluatedAt: h.now().In(h.loc).Format(time.RFC3339),
		RuleSet: RuleSetRef{rs.set.ID, rs.set.Version}, Reference: ref, Outcome: outcome,
	}
	detail["evaluation_id"], detail["status"] = out.EvaluationID, out.Status
	detail["failed"] = strconv.Itoa(out.Summary.FailedError + out.Summary.FailedWarning)
	detail["not_evaluated"] = strconv.Itoa(out.Summary.NotEvaluated)
	if h.record(w, r, audit.OutcomeSuccess, ref.ResourceID, detail) {
		h.writeReceipt(r, out)
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// writeReceipt stores the receipt of a returned evaluation. A failure is logged and the result still returned: the
// audit event is the record that matters; feedback on this evaluation is then refused as not found.
func (h *Handler) writeReceipt(r *http.Request, e Evaluation) {
	p, _ := iam.PrincipalFrom(r.Context())
	if h.receipts == nil || p.FacilityID == "" {
		return
	}
	at, err := time.Parse(time.RFC3339, e.EvaluatedAt)
	if err != nil {
		at = h.now()
	}
	rc := Receipt{EvaluationID: e.EvaluationID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		UserID: p.UserID, RuleSetID: e.RuleSet.ID, RuleSetVersion: e.RuleSet.Version, EvaluatedAt: at}
	for _, f := range e.Findings {
		rc.Results = append(rc.Results, RuleResult{RuleID: f.RuleID, Result: f.Result})
	}
	if err := h.receipts.WriteReceipt(r.Context(), rc); err != nil {
		h.logger.Warn("evaluation receipt not written", "action", "assistant.rules.evaluate", "err", err)
	}
}

// record writes the evaluation's audit event (codes and counts only). false = it could not be written: 503 has been
// answered and no result is returned (fail closed).
func (h *Handler) record(w http.ResponseWriter, r *http.Request, outcome, encounter string, detail map[string]string) bool {
	p, _ := iam.PrincipalFrom(r.Context())
	ri := h.iam.RequestInfo(r)
	err := h.audit.WriteAudit(r.Context(), audit.Event{
		OccurredAt: h.now(), Category: audit.CategoryDataAccess, Action: "assistant.rules.evaluate", Outcome: outcome,
		ActorType: audit.ActorUser, ActorID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		ResourceType: "Encounter", ResourceID: encounter, Channel: ri.ClientType, RequestID: ri.RequestID,
		ClientAddr: ri.ClientAddr, Detail: detail,
	})
	if err != nil {
		h.logger.Error("audit write failed; result withheld", "action", "assistant.rules.evaluate", "err", err)
		unavailable(w)
		return false
	}
	return true
}

// VisitOf takes the claim-readiness input from a mapped visit timeline.
func VisitOf(tl clinical.Timeline) rules.Visit {
	s := tl.Summary
	v := rules.Visit{CareSetting: s.CareSetting, PayerCode: s.Payer.Code, CodedProcedures: len(s.CodedProcedures),
		Truncated: tl.Truncated}
	for _, d := range s.Diagnoses {
		v.Diagnoses = append(v.Diagnoses, rules.Diagnosis{Code: d.Code, Priority: d.Priority})
	}
	if s.DischargeSummary != nil {
		v.HasDischargeSummary, v.SummaryMainDiagnosis = true, s.DischargeSummary.MainDiagnosis.Code
	}
	for _, sep := range s.SEP {
		st := ""
		if sep.ServiceType != nil {
			st = *sep.ServiceType
		}
		v.SEPs = append(v.SEPs, rules.SEP{ServiceType: st, DischargeRecorded: sep.DischargedAt != nil})
	}
	for _, e := range tl.Entries {
		switch e["type"] {
		case "procedure":
			if by, _ := e["performed_by"].(string); by != "" && by != "nurse" {
				v.DoctorProcedures++
			}
		case "room_stay":
			los, _ := e["length_of_stay"].(*string)
			status, _ := e["discharge_status"].(*string)
			v.RoomStays = append(v.RoomStays, rules.RoomStay{LengthOfStay: los, DischargeStatus: status})
		}
	}
	return v
}

// newUUID returns a random (version 4) UUID.
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
