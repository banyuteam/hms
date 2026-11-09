package assistant

// Feedback, comments and interaction events of the assistant (ADR-SVC-008 Phase A, owner decisions L-1 to L-11 of
// 2026-11-09; assistant-v1 1.1.0). Feedback is evidence for rule owners, never input to a rule: nothing here changes
// an evaluation, a rule, a label or a permission.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"hms/services/core/httpx"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

// Permissions of the feedback routes. Sending feedback needs PermEvaluate (L-4: whoever may run claim checks may report
// on them). No role receives these two by default.
const (
	PermFeedbackReview = "assistant.feedback.review"
	PermCommentsRead   = "assistant.feedback.comments.read"
)

const (
	TargetFinding = "finding"
	TargetAnswer  = "answer"

	maxFeedbackBody     = 1 << 10
	maxEventsBody       = 4 << 10
	maxCommentRunes     = 200
	maxEventsPerBatch   = 20
	feedbackPerMinute   = 30  // per user
	eventBatchPerMinute = 120 // per user
	minGroupSize        = 5   // L-6
	feedbackWindow      = 7 * 24 * time.Hour
	maxSummaryMonths    = 12
	commentsPageSize    = 50
	storeTimeout        = 10 * time.Second
	eventSchemaVersion  = 1
)

var (
	// Allowed values; the database checks the same lists (migration 0006).
	findingReasons = set("result_wrong", "unclear", "not_relevant", "data_outdated")
	helpfulness    = set("helpful", "partially_helpful", "not_helpful")
	expectedKinds  = set("more_specific", "different_interpretation", "actionable_steps", "additional_information", "other")
	resultValues   = set("passed", "failed", "not_applicable", "not_evaluated")
	eventTopics    = set("claim", "summary", "diagnoses", "procedures", "labs", "medications")
	eventInputs    = set("button", "typed")
	fallbackKinds  = set("help", "need_tag", "need_visit", "choose_visit", "not_loaded", "refused")

	uuidPattern  = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	rulePattern  = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	monthPattern = regexp.MustCompile(`^[0-9]{4}-(0[1-9]|1[0-2])$`)
)

func set(v ...string) map[string]bool {
	m := make(map[string]bool, len(v))
	for _, s := range v {
		m[s] = true
	}
	return m
}

// Store errors the handler maps to responses.
var (
	// ErrReceiptNotFound: no receipt of this user and facility within the feedback window (unknown, foreign or expired;
	// the response does not say which).
	ErrReceiptNotFound = errors.New("evaluation receipt not found")
	// ErrRuleMismatch: the rule was not in the evaluation, or had another result.
	ErrRuleMismatch = errors.New("rule or result not in the evaluation")
)

// Receipt is written when an evaluation is returned (L-1): ids, rule set and each rule's result, no record values.
type Receipt struct {
	EvaluationID, OrganizationID, FacilityID, UserID string
	RuleSetID                                        string
	RuleSetVersion                                   int
	EvaluatedAt                                      time.Time
	Results                                          []RuleResult
}

type RuleResult struct{ RuleID, Result string }

// ReceiptWriter stores receipts (PgStore).
type ReceiptWriter interface {
	WriteReceipt(ctx context.Context, r Receipt) error
}

// FeedbackInput is one validated feedback item of the requesting user.
type FeedbackInput struct {
	EvaluationID, UserID, FacilityID string
	Target                           string // finding | answer
	RuleID, Result, Reason           string // finding
	Helpfulness, Expected            string // answer
	Comment                          string // optional, already trimmed
	Now                              time.Time
	Window                           time.Duration
}

type FeedbackResult struct {
	ID      string
	Version int
	Created bool // false: identical to the current item, nothing stored
}

type SummaryQuery struct {
	OrganizationID, FacilityID string
	RuleSetID                  string
	RuleSetVersion             *int
	From, To                   time.Time // first day of the first month; first day after the last month (UTC)
}

// SummaryGroup counts current feedback items with the same choices.
type SummaryGroup struct {
	Target, RuleID, Result, Reason, Helpfulness, Expected string
	Count, Comments                                       int64
}

type SummaryData struct {
	Evaluations int64
	Groups      []SummaryGroup
}

type CommentQuery struct {
	OrganizationID, FacilityID string
	RuleSetID                  string
	RuleSetVersion             *int
	RuleID                     string
	From, To                   time.Time
	Before                     string // feedback id cursor; "" = newest first
	Limit                      int
}

type Comment struct {
	FeedbackID                                            string
	Target, RuleID, Result, Reason, Helpfulness, Expected string
	Body                                                  string
	CreatedAt                                             time.Time
}

// Event is one validated interaction event (schema v1).
type Event struct {
	EventID, PanelSession, Type, Topic, Input, FallbackKind string
	ClientAt                                                time.Time
}

type EventBatch struct {
	UserID, OrganizationID, FacilityID string
	ReceivedAt                         time.Time
	Events                             []Event
}

// FeedbackStore persists feedback and events (PgStore). SubmitFeedback writes ev (with the stored version added) in the
// same transaction, so an accepted item is never unaudited.
type FeedbackStore interface {
	SubmitFeedback(ctx context.Context, in FeedbackInput, ev audit.Event) (FeedbackResult, error)
	Summary(ctx context.Context, q SummaryQuery) (SummaryData, error)
	Comments(ctx context.Context, q CommentQuery) ([]Comment, error)
	RecordEvents(ctx context.Context, b EventBatch) (int, error)
}

type FeedbackHandler struct {
	store            FeedbackStore
	audit            AuditWriter
	iam              *iam.Handler
	logger           *slog.Logger
	now              func() time.Time
	feedbackLimiter  *httpx.WindowLimiter
	eventsLimiter    *httpx.WindowLimiter
	can              func(r *http.Request, permission string) (bool, error)
	allowStateChange func(w http.ResponseWriter, r *http.Request) bool
}

func NewFeedbackHandler(store FeedbackStore, auditor AuditWriter, iamHandler *iam.Handler, logger *slog.Logger) *FeedbackHandler {
	return &FeedbackHandler{store: store, audit: auditor, iam: iamHandler, logger: logger, now: time.Now,
		feedbackLimiter: httpx.NewWindowLimiter(feedbackPerMinute, time.Minute, time.Now),
		eventsLimiter:   httpx.NewWindowLimiter(eventBatchPerMinute, time.Minute, time.Now),
		can:             iamHandler.Can, allowStateChange: iamHandler.AllowStateChange}
}

func (h *FeedbackHandler) Register(mux *http.ServeMux) {
	withPerm := func(perm string, fn http.HandlerFunc) http.Handler {
		return h.iam.RequireSession(h.iam.RequirePermission(perm, fn))
	}
	mux.Handle("POST /api/v1/assistant/feedback", withPerm(PermEvaluate, h.submit))
	mux.Handle("GET /api/v1/assistant/feedback/summary", withPerm(PermFeedbackReview, h.summary))
	mux.Handle("GET /api/v1/assistant/feedback/comments", withPerm(PermCommentsRead, h.comments))
	mux.Handle("POST /api/v1/assistant/events", h.iam.RequireSession(http.HandlerFunc(h.events)))
}

// decodeStrict reads exactly one JSON value of at most limit bytes with no unknown fields.
func decodeStrict(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil || dec.Decode(&struct{}{}) != io.EOF {
		invalid(w, "Malformed JSON body.")
		return false
	}
	return true
}

type feedbackRequest struct {
	EvaluationID string  `json:"evaluation_id"`
	RuleID       *string `json:"rule_id"`
	Result       *string `json:"result"`
	Reason       *string `json:"reason"`
	Helpfulness  *string `json:"helpfulness"`
	Expected     *string `json:"expected"`
	Comment      *string `json:"comment"`
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// cleanComment trims a comment and checks it: valid UTF-8, at most 200 characters, no control characters other than
// line breaks. ok=false: invalid.
func cleanComment(p *string) (string, bool) {
	if p == nil {
		return "", true
	}
	c := strings.TrimSpace(*p)
	if c == "" {
		return "", true
	}
	if !utf8.ValidString(c) || utf8.RuneCountInString(c) > maxCommentRunes {
		return "", false
	}
	for _, r := range c {
		if unicode.IsControl(r) && r != '\n' {
			return "", false
		}
	}
	return c, true
}

// validateFeedback turns a request into a store input. The target follows from the fields: rule_id = finding.
func validateFeedback(req feedbackRequest) (FeedbackInput, string) {
	in := FeedbackInput{EvaluationID: req.EvaluationID}
	if !uuidPattern.MatchString(req.EvaluationID) {
		return in, "evaluation_id must be the id of an evaluation."
	}
	comment, ok := cleanComment(req.Comment)
	if !ok {
		return in, "comment must be at most 200 characters of plain text."
	}
	in.Comment = comment
	if req.RuleID != nil {
		in.Target, in.RuleID, in.Result, in.Reason = TargetFinding, *req.RuleID, str(req.Result), str(req.Reason)
		switch {
		case req.Helpfulness != nil || req.Expected != nil:
			return in, "Feedback on a finding has no helpfulness or expected."
		case !rulePattern.MatchString(in.RuleID):
			return in, "rule_id is not a rule id."
		case !resultValues[in.Result]:
			return in, "result must be the result that was shown."
		case !findingReasons[in.Reason]:
			return in, "reason must be result_wrong, unclear, not_relevant or data_outdated."
		}
		return in, ""
	}
	in.Target, in.Helpfulness, in.Expected = TargetAnswer, str(req.Helpfulness), str(req.Expected)
	switch {
	case req.Result != nil || req.Reason != nil:
		return in, "Feedback on the answer has no result or reason."
	case !helpfulness[in.Helpfulness]:
		return in, "helpfulness must be helpful, partially_helpful or not_helpful."
	case in.Expected != "" && (!expectedKinds[in.Expected] || in.Helpfulness == "helpful"):
		return in, "expected is one of the listed kinds, and only for a partially or not helpful answer."
	}
	return in, ""
}

func (h *FeedbackHandler) submit(w http.ResponseWriter, r *http.Request) {
	if !h.allowStateChange(w, r) {
		return
	}
	p, _ := iam.PrincipalFrom(r.Context())
	if !h.feedbackLimiter.Allow(p.UserID) {
		w.Header().Set("Retry-After", "60")
		httpx.WriteError(w, http.StatusTooManyRequests, "too_many_requests", "Too much feedback. Try again later.")
		return
	}
	var req feedbackRequest
	if !decodeStrict(w, r, maxFeedbackBody, &req) {
		return
	}
	in, problem := validateFeedback(req)
	if problem != "" {
		invalid(w, problem)
		return
	}
	in.UserID, in.FacilityID, in.Now, in.Window = p.UserID, p.FacilityID, h.now(), feedbackWindow

	// Codes and choices only; never the comment.
	detail := map[string]string{"evaluation_id": in.EvaluationID, "target": in.Target,
		"comment": strconv.FormatBool(in.Comment != "")}
	if in.Target == TargetFinding {
		detail["rule_id"], detail["result"], detail["reason"] = in.RuleID, in.Result, in.Reason
	} else {
		detail["helpfulness"] = in.Helpfulness
		if in.Expected != "" {
			detail["expected"] = in.Expected
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()
	res, err := h.store.SubmitFeedback(ctx, in, h.event(r, "assistant.feedback.submit", audit.OutcomeSuccess, detail))
	switch {
	case errors.Is(err, ErrReceiptNotFound):
		detail["reason_rejected"] = "not_found"
		if h.record(w, r, "assistant.feedback.submit", audit.OutcomeFailure, detail) {
			httpx.WriteError(w, http.StatusNotFound, "evaluation_not_found", "Evaluation not found.")
		}
	case errors.Is(err, ErrRuleMismatch):
		detail["reason_rejected"] = "rule_mismatch"
		if h.record(w, r, "assistant.feedback.submit", audit.OutcomeFailure, detail) {
			httpx.WriteError(w, http.StatusUnprocessableEntity, "rule_not_in_evaluation",
				"That rule or result was not in the evaluation.")
		}
	case err != nil:
		h.logger.Error("feedback store failed", "action", "assistant.feedback.submit", "err", err)
		unavailable(w)
	default:
		status := http.StatusCreated
		if !res.Created {
			status = http.StatusOK
		}
		httpx.WriteJSON(w, status, map[string]any{"feedback_id": res.ID, "version": res.Version})
	}
}

// monthRange parses from/to (YYYY-MM, inclusive) into [From, To). Defaults: the current month. At most 12 months.
func monthRange(q map[string][]string, now time.Time) (time.Time, time.Time, string) {
	parse := func(name string) (time.Time, bool, string) {
		v := strings.TrimSpace(first(q[name]))
		if v == "" {
			return time.Time{}, false, ""
		}
		if !monthPattern.MatchString(v) {
			return time.Time{}, false, name + " must be a month (YYYY-MM)."
		}
		t, _ := time.Parse("2006-01", v)
		return t, true, ""
	}
	cur := time.Date(now.UTC().Year(), now.UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	from, okFrom, p := parse("from")
	if p != "" {
		return time.Time{}, time.Time{}, p
	}
	to, okTo, p := parse("to")
	if p != "" {
		return time.Time{}, time.Time{}, p
	}
	if !okTo {
		to = cur
	}
	if !okFrom {
		from = to
	}
	end := to.AddDate(0, 1, 0)
	if from.After(to) || from.AddDate(0, maxSummaryMonths, 0).Before(end) {
		return time.Time{}, time.Time{}, "from must not be after to, and the range is at most 12 months."
	}
	return from, end, ""
}

func first(v []string) string {
	if len(v) == 0 {
		return ""
	}
	return v[0]
}

// ruleSetFilter reads rule_set (required) and version (optional).
func ruleSetFilter(q map[string][]string) (string, *int, string) {
	id := first(q["rule_set"])
	if !ruleSetPattern.MatchString(id) {
		return "", nil, "rule_set is required."
	}
	v := first(q["version"])
	if v == "" {
		return id, nil, ""
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > 1000 {
		return "", nil, "version must be a positive integer."
	}
	return id, &n, ""
}

type summaryItem struct {
	Target      string  `json:"target"`
	RuleID      *string `json:"rule_id"`
	Result      *string `json:"result"`
	Reason      *string `json:"reason"`
	Helpfulness *string `json:"helpfulness"`
	Expected    *string `json:"expected"`
	Count       *int64  `json:"count"`
	Comments    *int64  `json:"comments"`
	Suppressed  bool    `json:"suppressed"`
}

func opt(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// suppress applies the minimum group size (L-6): small groups keep their choices but lose their counts.
func suppress(groups []SummaryGroup) []summaryItem {
	out := make([]summaryItem, 0, len(groups))
	for _, g := range groups {
		it := summaryItem{Target: g.Target, RuleID: opt(g.RuleID), Result: opt(g.Result), Reason: opt(g.Reason),
			Helpfulness: opt(g.Helpfulness), Expected: opt(g.Expected), Suppressed: g.Count < minGroupSize}
		if !it.Suppressed {
			c, n := g.Count, g.Comments
			it.Count, it.Comments = &c, &n
		}
		out = append(out, it)
	}
	return out
}

// summary reports current feedback per choice for the session's facility, with the number of evaluations in the range
// as denominator. Counts below the minimum group size are withheld.
func (h *FeedbackHandler) summary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	id, version, problem := ruleSetFilter(q)
	if problem != "" {
		invalid(w, problem)
		return
	}
	from, to, problem := monthRange(q, h.now())
	if problem != "" {
		invalid(w, problem)
		return
	}
	p, _ := iam.PrincipalFrom(r.Context())
	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()
	data, err := h.store.Summary(ctx, SummaryQuery{OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		RuleSetID: id, RuleSetVersion: version, From: from, To: to})
	if err != nil {
		h.logger.Error("feedback summary failed", "err", err)
		unavailable(w)
		return
	}
	if h.record(w, r, "assistant.feedback.summary", audit.OutcomeSuccess, filterDetail(id, version, from, to)) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"rule_set": map[string]any{"id": id, "version": version},
			"from":     from.Format("2006-01"), "to": to.AddDate(0, -1, 0).Format("2006-01"),
			"evaluations": data.Evaluations, "min_group_size": minGroupSize, "groups": suppress(data.Groups),
		})
	}
}

func filterDetail(id string, version *int, from, to time.Time) map[string]string {
	d := map[string]string{"rule_set": id, "from": from.Format("2006-01"), "to": to.AddDate(0, -1, 0).Format("2006-01")}
	if version != nil {
		d["version"] = strconv.Itoa(*version)
	}
	return d
}

type commentItem struct {
	FeedbackID  string  `json:"feedback_id"`
	Target      string  `json:"target"`
	RuleID      *string `json:"rule_id"`
	Result      *string `json:"result"`
	Reason      *string `json:"reason"`
	Helpfulness *string `json:"helpfulness"`
	Expected    *string `json:"expected"`
	Comment     string  `json:"comment"`
	Date        string  `json:"date"`
}

// comments lists comment text of current feedback, newest first, never the submitter. Every read is audited.
func (h *FeedbackHandler) comments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	id, version, problem := ruleSetFilter(q)
	var from, to time.Time
	if problem == "" {
		from, to, problem = monthRange(q, h.now())
	}
	ruleID, before := first(q["rule_id"]), first(q["before"])
	if problem == "" && ruleID != "" && !rulePattern.MatchString(ruleID) {
		problem = "rule_id is not a rule id."
	}
	if problem == "" && before != "" && !uuidPattern.MatchString(before) {
		problem = "before must be a feedback_id."
	}
	if problem != "" {
		invalid(w, problem)
		return
	}
	p, _ := iam.PrincipalFrom(r.Context())
	ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
	defer cancel()
	list, err := h.store.Comments(ctx, CommentQuery{OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		RuleSetID: id, RuleSetVersion: version, RuleID: ruleID, From: from, To: to, Before: before,
		Limit: commentsPageSize + 1})
	if err != nil {
		h.logger.Error("feedback comments failed", "err", err)
		unavailable(w)
		return
	}
	more := len(list) > commentsPageSize
	if more {
		list = list[:commentsPageSize]
	}
	items := make([]commentItem, 0, len(list))
	for _, c := range list {
		items = append(items, commentItem{FeedbackID: c.FeedbackID, Target: c.Target, RuleID: opt(c.RuleID),
			Result: opt(c.Result), Reason: opt(c.Reason), Helpfulness: opt(c.Helpfulness), Expected: opt(c.Expected),
			Comment: c.Body, Date: c.CreatedAt.UTC().Format("2006-01-02")})
	}
	detail := filterDetail(id, version, from, to)
	detail["returned"] = strconv.Itoa(len(items))
	if ruleID != "" {
		detail["rule_id"] = ruleID
	}
	var next any
	if more {
		next = items[len(items)-1].FeedbackID
	}
	if h.record(w, r, "assistant.feedback.comments.read", audit.OutcomeSuccess, detail) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"comments": items, "next_before": next})
	}
}

type eventsRequest struct {
	Events []struct {
		SchemaVersion int    `json:"schema_version"`
		EventID       string `json:"event_id"`
		Type          string `json:"type"`
		ClientAt      string `json:"client_at"`
		PanelSession  string `json:"panel_session"`
		Topic         string `json:"topic"`
		Input         string `json:"input"`
		FallbackKind  string `json:"fallback_kind"`
	} `json:"events"`
}

// events records interaction events (L-10). Fire-and-forget for the client: 202 with the number newly stored.
func (h *FeedbackHandler) events(w http.ResponseWriter, r *http.Request) {
	if !h.allowStateChange(w, r) {
		return
	}
	p, _ := iam.PrincipalFrom(r.Context())
	if !h.eventsLimiter.Allow(p.UserID) {
		w.Header().Set("Retry-After", "60")
		httpx.WriteError(w, http.StatusTooManyRequests, "too_many_requests", "Too many events. Try again later.")
		return
	}
	var req eventsRequest
	if !decodeStrict(w, r, maxEventsBody, &req) {
		return
	}
	if len(req.Events) < 1 || len(req.Events) > maxEventsPerBatch {
		invalid(w, "events must hold 1 to 20 events.")
		return
	}
	now := h.now()
	batch := EventBatch{UserID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID, ReceivedAt: now}
	claimAllowed, claimChecked := false, false
	for _, e := range req.Events {
		at, err := time.Parse(time.RFC3339, e.ClientAt)
		ok := err == nil && e.SchemaVersion == eventSchemaVersion && uuidPattern.MatchString(e.EventID) &&
			uuidPattern.MatchString(e.PanelSession) && at.After(now.Add(-feedbackWindow)) && at.Before(now.Add(time.Hour))
		switch e.Type {
		case "topic_selected":
			ok = ok && eventTopics[e.Topic] && eventInputs[e.Input] && e.FallbackKind == ""
		case "fallback_shown":
			ok = ok && fallbackKinds[e.FallbackKind] && e.Topic == "" && e.Input == ""
		default:
			ok = false
		}
		if !ok {
			invalid(w, "Each event must be a valid schema 1 event.")
			return
		}
		// A session that may not run claim checks records no claim topic (ADR-SVC-008 Decision 3).
		if e.Topic == "claim" {
			if !claimChecked {
				claimAllowed, err = h.can(r, PermEvaluate)
				if err != nil {
					unavailable(w)
					return
				}
				claimChecked = true
			}
			if !claimAllowed {
				continue
			}
		}
		batch.Events = append(batch.Events, Event{EventID: e.EventID, PanelSession: e.PanelSession, Type: e.Type,
			Topic: e.Topic, Input: e.Input, FallbackKind: e.FallbackKind, ClientAt: at})
	}
	stored := 0
	if len(batch.Events) > 0 && p.FacilityID != "" {
		ctx, cancel := context.WithTimeout(r.Context(), storeTimeout)
		defer cancel()
		n, err := h.store.RecordEvents(ctx, batch)
		if err != nil {
			h.logger.Error("event store failed", "err", err)
			unavailable(w)
			return
		}
		stored = n
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"accepted": stored})
}

func (h *FeedbackHandler) event(r *http.Request, action, outcome string, detail map[string]string) audit.Event {
	p, _ := iam.PrincipalFrom(r.Context())
	ri := h.iam.RequestInfo(r)
	resourceType, resourceID := "AssistantFeedback", ""
	if id := detail["evaluation_id"]; id != "" {
		resourceType, resourceID = "AssistantEvaluation", id
	}
	return audit.Event{OccurredAt: h.now(), Category: audit.CategoryDataAccess, Action: action, Outcome: outcome,
		ActorType: audit.ActorUser, ActorID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		ResourceType: resourceType, ResourceID: resourceID, Channel: ri.ClientType,
		RequestID: ri.RequestID, ClientAddr: ri.ClientAddr, Detail: detail}
}

// record writes an audit event; false = it could not be written and 503 has been answered (fail closed).
func (h *FeedbackHandler) record(w http.ResponseWriter, r *http.Request, action, outcome string, detail map[string]string) bool {
	if err := h.audit.WriteAudit(r.Context(), h.event(r, action, outcome, detail)); err != nil {
		h.logger.Error("audit write failed; answer withheld", "action", action, "err", err)
		unavailable(w)
		return false
	}
	return true
}
