// Package accounting serves the accounting application's financial reports inside HMS (ADR-SVC-014). It holds no
// figures of its own: every number here was computed by the accounting application, which owns the books.
//
// Reads are permission-gated per report and audited fail closed — accounting is internal financial data, the same
// treatment ADR-SVC-005 gives the tariff book.
package accounting

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"hms/services/core/httpx"
	integ "hms/services/integrations/accounting"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

// PermNeracaRead allows reading the balance sheet.
//
// One permission per report, mirroring the accounting application's own can:View:<Laporan> rather than inventing a
// second vocabulary (ADR-SVC-014 Decision 4). The remaining six arrive with their endpoints; declaring a
// permission that nothing serves would put a dead row in User & Access.
const PermNeracaRead = "accounting.neraca.read"

var Permissions = []iam.PermissionDef{
	{Code: PermNeracaRead, Description: "View the balance sheet (Neraca) from the accounting application"},
}

// Reader is the outward read side (integrations/accounting.Client).
type Reader interface {
	Get(ctx context.Context, path string, q url.Values, out any) error
}

// AuditWriter writes audit events (iam.PgStore).
type AuditWriter interface {
	WriteAudit(ctx context.Context, ev audit.Event) error
}

type Handler struct {
	reader Reader
	audit  AuditWriter
	iam    *iam.Handler
	logger *slog.Logger
	now    func() time.Time
}

func NewHandler(reader Reader, auditor AuditWriter, iamHandler *iam.Handler, logger *slog.Logger) *Handler {
	return &Handler{reader: reader, audit: auditor, iam: iamHandler, logger: logger, now: time.Now}
}

func (h *Handler) Register(mux *http.ServeMux) {
	// Permission per route, not one for the whole module: each report is granted separately in the accounting
	// application and the two vocabularies must not drift (ADR-SVC-014 Decision 4). The helper exists so that the
	// six reports still to come cannot be registered without one.
	route := func(pattern, permission string, fn http.HandlerFunc) {
		mux.Handle(pattern, h.iam.RequireSession(h.iam.RequirePermission(permission, fn)))
	}
	route("GET /api/v1/accounting/neraca", PermNeracaRead, h.neraca)
}

// Period is the report period as the accounting application returns it.
type Period struct {
	Year  int `json:"tahun"`
	Month int `json:"bulan"`
}

// Line is one account on a position report. Nilai carries its sign: contra accounts arrive negative, and the
// reader needs that sign to add the column up. Making it absolute here would force every consumer to work the
// direction out again.
type Line struct {
	Code        string      `json:"kode"`
	Name        string      `json:"nama"`
	Type        string      `json:"tipe"`
	NormalSide  string      `json:"saldo_normal"`
	Depth       int         `json:"depth"`
	IsHeader    bool        `json:"is_header"`
	Amount      json.Number `json:"nilai"`
}

type Group struct {
	Lines []Line      `json:"baris"`
	Total json.Number `json:"total"`
}

// BalanceSheet is the shape of GET /api/v1/laporan/neraca.
//
// Two of its figures live in no account at all: there is no year-end closing journal in the accounting
// application (the Finance department's answer of 2 September), so last year's result and this year's are
// computed and reported as their own lines. A reader must not look for them in the general ledger.
type BalanceSheet struct {
	Period                Period      `json:"periode"`
	Assets                Group       `json:"aset"`
	Liabilities           Group       `json:"kewajiban"`
	Equity                Group       `json:"ekuitas"`
	PriorYearResult       json.Number `json:"laba_tahun_lalu"`
	CurrentYearResult     json.Number `json:"laba_rugi_berjalan"`
	TotalLiabilityEquity  json.Number `json:"total_kewajiban_ekuitas"`

	// Difference is sent as it stands, not folded into a "balanced" verdict. What counts as balanced is one
	// decision and it belongs to one place — Journal::selisihSeimbang() over there, not to a second opinion here.
	Difference json.Number `json:"selisih"`
}

func (h *Handler) neraca(w http.ResponseWriter, r *http.Request) {
	year, month, ok := period(r)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"year 2000-2100 and month 1-12 are required.")
		return
	}

	q := url.Values{}
	q.Set("year", strconv.Itoa(year))
	q.Set("month", strconv.Itoa(month))

	var out BalanceSheet
	if err := h.reader.Get(r.Context(), "/api/v1/laporan/neraca", q, &out); err != nil {
		h.failed(w, "neraca", err)
		return
	}

	resource := strconv.Itoa(year) + "-" + strconv.Itoa(month)
	detail := map[string]string{
		"report": "neraca",
		"lines":  strconv.Itoa(len(out.Assets.Lines) + len(out.Liabilities.Lines) + len(out.Equity.Lines)),
	}

	// Figures and account names stay out of the audit detail: the trail records that someone read the balance
	// sheet for a period, not what it said.
	if h.record(w, r, "accounting.neraca.read", resource, detail) {
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// period reads and bounds year and month. Out-of-range values are refused here rather than passed on: month 13
// produces an empty report that looks perfectly valid.
func period(r *http.Request) (int, int, bool) {
	q := r.URL.Query()
	year, err1 := strconv.Atoi(q.Get("year"))
	month, err2 := strconv.Atoi(q.Get("month"))
	if err1 != nil || err2 != nil || year < 2000 || year > 2100 || month < 1 || month > 12 {
		return 0, 0, false
	}
	return year, month, true
}

// failed answers one status for every upstream problem and keeps the reason in the log.
//
// The accounting application's error bodies can carry its hosts, its SQL and its own stack traces; none of that
// belongs in a browser. A refused token is logged louder than an outage because it does not fix itself: someone
// has to rotate it or re-grant the permission.
func (h *Handler) failed(w http.ResponseWriter, report string, err error) {
	switch {
	case errors.Is(err, integ.ErrUnauthorized):
		h.logger.Error("accounting token refused; check the service account", "report", report)
	case errors.Is(err, integ.ErrNotFound):
		h.logger.Error("accounting endpoint not found; version mismatch?", "report", report)
	default:
		h.logger.Error("accounting read failed", "report", report, "err", err)
	}
	unavailable(w)
}

// record writes the audit event; false = not written, the caller has answered 503 (fail closed).
func (h *Handler) record(w http.ResponseWriter, r *http.Request, action, resourceID string, detail map[string]string) bool {
	p, _ := iam.PrincipalFrom(r.Context())
	ri := h.iam.RequestInfo(r)
	err := h.audit.WriteAudit(r.Context(), audit.Event{
		OccurredAt: h.now(), Category: audit.CategoryDataAccess, Action: action, Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorUser, ActorID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		ResourceType: "AccountingReport", ResourceID: resourceID, Channel: ri.ClientType, RequestID: ri.RequestID,
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