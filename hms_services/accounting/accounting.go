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
// second vocabulary (ADR-SVC-014 Decision 4). Aging is the reason this matters most: it carries counterparty names
// and amounts owed per person, the most sensitive of the seven.
const (
	PermNeracaRead      = "accounting.neraca.read"
	PermLabaRugiRead    = "accounting.laba_rugi.read"
	PermNeracaSaldoRead = "accounting.neraca_saldo.read"
	PermNeracaLajurRead = "accounting.neraca_lajur.read"
	PermCashFlowRead    = "accounting.cash_flow.read"
	PermBukuBesarRead   = "accounting.buku_besar.read"
	PermAgingRead       = "accounting.aging.read"
)

var Permissions = []iam.PermissionDef{
	{Code: PermNeracaRead, Description: "View the balance sheet (Neraca)"},
	{Code: PermLabaRugiRead, Description: "View the income statement (Laba Rugi)"},
	{Code: PermNeracaSaldoRead, Description: "View the trial balance (Neraca Saldo)"},
	{Code: PermNeracaLajurRead, Description: "View the worksheet (Neraca Lajur)"},
	{Code: PermCashFlowRead, Description: "View the cash flow statement (Arus Kas)"},
	{Code: PermBukuBesarRead, Description: "View the general ledger (Buku Besar), one account at a time"},
	{Code: PermAgingRead, Description: "View receivable and payable ageing, including counterparty names"},
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
	route := func(pattern, permission string, fn http.HandlerFunc) {
		mux.Handle(pattern, h.iam.RequireSession(h.iam.RequirePermission(permission, fn)))
	}
	route("GET /api/v1/accounting/neraca", PermNeracaRead, h.neraca)
	route("GET /api/v1/accounting/laba-rugi", PermLabaRugiRead, h.labaRugi)
	route("GET /api/v1/accounting/neraca-saldo", PermNeracaSaldoRead, h.neracaSaldo)
	route("GET /api/v1/accounting/neraca-lajur", PermNeracaLajurRead, h.neracaLajur)
	route("GET /api/v1/accounting/cash-flow", PermCashFlowRead, h.cashFlow)
	route("GET /api/v1/accounting/buku-besar", PermBukuBesarRead, h.bukuBesar)
	route("GET /api/v1/accounting/aging", PermAgingRead, h.aging)
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
	Code       string      `json:"kode"`
	Name       string      `json:"nama"`
	Type       string      `json:"tipe"`
	NormalSide string      `json:"saldo_normal"`
	Depth      int         `json:"depth"`
	IsHeader   bool        `json:"is_header"`
	Amount     json.Number `json:"nilai"`
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
	Period               Period      `json:"periode"`
	Assets               Group       `json:"aset"`
	Liabilities          Group       `json:"kewajiban"`
	Equity               Group       `json:"ekuitas"`
	PriorYearResult      json.Number `json:"laba_tahun_lalu"`
	CurrentYearResult    json.Number `json:"laba_rugi_berjalan"`
	TotalLiabilityEquity json.Number `json:"total_kewajiban_ekuitas"`

	// Difference is sent as it stands, not folded into a "balanced" verdict. What counts as balanced is one
	// decision and it belongs to one place — Journal::selisihSeimbang() over there, not to a second opinion here.
	Difference json.Number `json:"selisih"`
}

// IncomeStatement is GET /api/v1/laporan/laba-rugi. Its line groups have the same shape as the balance sheet's,
// and a contra account inside a group arrives with its sign already reversed by the accounting application:
// a purchase discount reduces cost of sales rather than adding to it.
type IncomeStatement struct {
	Period      Period `json:"periode"`
	Revenue     []Line `json:"pendapatan"`
	CostOfSales []Line `json:"hpp"`
	Expenses    []Line `json:"beban"`
	OtherCost   []Line `json:"biaya_lain"`
	Tax         []Line `json:"pajak"`
	Totals      struct {
		Revenue     json.Number `json:"pendapatan"`
		CostOfSales json.Number `json:"hpp"`
		Expenses    json.Number `json:"beban"`
		OtherCost   json.Number `json:"biaya_lain"`
		Tax         json.Number `json:"pajak"`
		GrossProfit json.Number `json:"laba_kotor"`
		Operating   json.Number `json:"laba_operasi"`
		Net         json.Number `json:"laba_rugi"`
	} `json:"total"`
}

// TrialBalanceRow carries two flags a reader must honour.
//
// SubtotalCampuran marks a group whose children run in both directions — adding them up produces a number with no
// meaning, so the accounting application's own screens, PDF and Excel all print "—" there. It is not zero.
// SubtotalTurunan marks a group row, whose figures already contain its children's: summing rows with it set
// double-counts.
type TrialBalanceRow struct {
	AccountID        int         `json:"account_id"`
	Code             string      `json:"code"`
	Name             string      `json:"name"`
	Type             string      `json:"type"`
	NormalSide       *string     `json:"normal_side"`
	IsHeader         bool        `json:"is_header"`
	Depth            int         `json:"depth"`
	ParentID         *int        `json:"parent_id"`
	OpeningBalance   json.Number `json:"opening_balance"`
	DebitAmount      json.Number `json:"debit_amount"`
	CreditAmount     json.Number `json:"credit_amount"`
	ClosingBalance   json.Number `json:"closing_balance"`
	SubtotalTurunan  bool        `json:"subtotal_turunan"`
	SubtotalCampuran bool        `json:"subtotal_campuran"`
}

type TrialBalance struct {
	Period Period `json:"periode"`
	Data   struct {
		Rows        []TrialBalanceRow `json:"rows"`
		TotalDebit  json.Number       `json:"total_debit"`
		TotalCredit json.Number       `json:"total_credit"`
		IsBalanced  bool              `json:"is_balanced"`
		PeriodYear  int               `json:"period_year"`
		PeriodMonth int               `json:"period_month"`
	} `json:"data"`
}

// WorksheetTotals is one set of the worksheet's six columns.
type WorksheetTotals struct {
	NSDebit   json.Number `json:"ns_debit"`
	NSCredit  json.Number `json:"ns_credit"`
	LRDebit   json.Number `json:"lr_debit"`
	LRCredit  json.Number `json:"lr_credit"`
	NERDebit  json.Number `json:"ner_debit"`
	NERCredit json.Number `json:"ner_credit"`
}

type WorksheetRow struct {
	Code      string      `json:"code"`
	Name      string      `json:"name"`
	Type      string      `json:"type"`
	Derived   bool        `json:"turunan"`
	NSDebit   json.Number `json:"ns_debit"`
	NSCredit  json.Number `json:"ns_credit"`
	LRDebit   json.Number `json:"lr_debit"`
	LRCredit  json.Number `json:"lr_credit"`
	NERDebit  json.Number `json:"ner_debit"`
	NERCredit json.Number `json:"ner_credit"`
}

// Worksheet is GET /api/v1/laporan/neraca-lajur.
//
// Two of its parts need explaining to whoever renders it. Penyeimbang is the balancing line at the foot — the side
// it falls on is not a style choice: in the profit columns a profit means credit exceeds debit, so the balancing
// figure goes on the debit side, and in the balance columns it is the other way round. And Jembatan is the bridge
// to the Finance department's own convention: they write contra accounts as negative numbers, this system stores
// them as positive amounts on the opposite side, so TotalsKonvensi is what matches their workbook while
// TotalsAkhir is what matches the ledger.
type Worksheet struct {
	Period Period `json:"periode"`
	Data   struct {
		Rows        []WorksheetRow  `json:"rows"`
		Totals      WorksheetTotals `json:"totals"`
		Penyeimbang struct {
			LRDebit   json.Number `json:"lr_debit"`
			LRCredit  json.Number `json:"lr_credit"`
			NERDebit  json.Number `json:"ner_debit"`
			NERCredit json.Number `json:"ner_credit"`
		} `json:"penyeimbang"`
		TotalsAkhir WorksheetTotals `json:"totals_akhir"`
		Jembatan    struct {
			NS  json.Number `json:"ns"`
			LR  json.Number `json:"lr"`
			NER json.Number `json:"ner"`
		} `json:"jembatan"`
		TotalsKonvensi WorksheetTotals `json:"totals_konvensi"`
		LabaRugi       json.Number     `json:"laba_rugi"`
		LabaTahunLalu  json.Number     `json:"laba_tahun_lalu"`
		Year           int             `json:"year"`
		Month          int             `json:"month"`
	} `json:"data"`
}

// JournalLine is one posting as it appears in the ledger and the cash flow statement.
type JournalLine struct {
	ID          int         `json:"id"`
	Date        *string     `json:"tanggal"`
	JournalNo   *string     `json:"no_jurnal"`
	Kind        *string     `json:"jenis"`
	Description *string     `json:"keterangan"`
	HelperCode  *string     `json:"kode_pembantu"`
	Debit       json.Number `json:"debit"`
	Credit      json.Number `json:"kredit"`
}

// CashFlow is GET /api/v1/laporan/cash-flow. Transfers between the hospital's own accounts are left out by the
// accounting application: a deposit from the cash box to a bank account is not money entering or leaving, and
// counting it would answer "how much came in this month" too high on both sides.
type CashFlow struct {
	Period   Period        `json:"periode"`
	Receipts []JournalLine `json:"penerimaan"`
	Payments []JournalLine `json:"pengeluaran"`
	Totals   struct {
		Receipts json.Number `json:"penerimaan"`
		Payments json.Number `json:"pengeluaran"`
		Net      json.Number `json:"net"`
	} `json:"total"`
	OpeningBalance json.Number `json:"saldo_awal"`
	ClosingBalance json.Number `json:"saldo_akhir"`
}

type LedgerAccount struct {
	Code           string        `json:"kode"`
	Name           string        `json:"nama"`
	NormalSide     *string       `json:"saldo_normal"`
	OpeningBalance json.Number   `json:"saldo_awal"`
	TotalDebit     json.Number   `json:"total_debit"`
	TotalCredit    json.Number   `json:"total_kredit"`
	ClosingBalance json.Number   `json:"saldo_akhir"`
	Lines          []JournalLine `json:"baris"`
}

type Ledger struct {
	Period   Period          `json:"periode"`
	Accounts []LedgerAccount `json:"akun"`
}

type AgeingBucket struct {
	Label string `json:"label"`
	Min   int    `json:"min"`
	Max   int    `json:"max"`
}

type AgeingRow struct {
	Name     string      `json:"name"`
	Payer    *string     `json:"penjamin"`
	Current  json.Number `json:"current"`
	B31To60  json.Number `json:"b31_60"`
	B61To90  json.Number `json:"b61_90"`
	B91To180 json.Number `json:"b91_180"`
	Over180  json.Number `json:"over180"`
	Total    json.Number `json:"total"`
}

// Ageing is GET /api/v1/laporan/aging. It names counterparties and what each of them owes — the most sensitive of
// the seven reports, and the reason the permissions are granted one by one rather than as a single
// accounting.read.
type Ageing struct {
	Type       string                  `json:"type"`
	Rows       []AgeingRow             `json:"rows"`
	GrandTotal AgeingRow               `json:"grand_total"`
	Buckets    map[string]AgeingBucket `json:"buckets"`
	AsOfDate   string                  `json:"as_of_date"`
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
	if h.record(w, r, PermNeracaRead, resource, detail) {
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func (h *Handler) labaRugi(w http.ResponseWriter, r *http.Request) {
	var out IncomeStatement
	if h.report(w, r, "/api/v1/laporan/laba-rugi", "laba-rugi", PermLabaRugiRead, &out, nil) {
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func (h *Handler) neracaSaldo(w http.ResponseWriter, r *http.Request) {
	extra := url.Values{}
	if r.URL.Query().Get("sertakan_akun_nol") != "" {
		extra.Set("sertakan_akun_nol", r.URL.Query().Get("sertakan_akun_nol"))
	}
	var out TrialBalance
	if h.report(w, r, "/api/v1/laporan/neraca-saldo", "neraca-saldo", PermNeracaSaldoRead, &out, extra) {
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func (h *Handler) neracaLajur(w http.ResponseWriter, r *http.Request) {
	var out Worksheet
	if h.report(w, r, "/api/v1/laporan/neraca-lajur", "neraca-lajur", PermNeracaLajurRead, &out, nil) {
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func (h *Handler) cashFlow(w http.ResponseWriter, r *http.Request) {
	var out CashFlow
	if h.report(w, r, "/api/v1/laporan/cash-flow", "cash-flow", PermCashFlowRead, &out, nil) {
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// bukuBesar requires an account. October 2026 without one is 5.225 rows across 156 accounts in a single month;
// the accounting application's own PDF route refuses "all accounts" for the same reason, and an API looser than
// the UI only moves the failure somewhere less visible.
func (h *Handler) bukuBesar(w http.ResponseWriter, r *http.Request) {
	accountID := r.URL.Query().Get("account_id")
	if n, err := strconv.Atoi(accountID); err != nil || n <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"account_id is required: the whole ledger of one month is thousands of rows.")
		return
	}

	extra := url.Values{"account_id": {accountID}}
	if v := r.URL.Query().Get("hanya_yang_bergerak"); v != "" {
		extra.Set("hanya_yang_bergerak", v)
	}

	var out Ledger
	if h.report(w, r, "/api/v1/laporan/buku-besar", "buku-besar", PermBukuBesarRead, &out, extra) {
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// aging has no period: it is a position as of a date, not a month's activity.
func (h *Handler) aging(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("type")
	if kind == "" {
		kind = "receivable"
	}
	if kind != "receivable" && kind != "payable" {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "type must be receivable or payable.")
		return
	}

	q := url.Values{"type": {kind}}
	if d := r.URL.Query().Get("as_of_date"); d != "" {
		q.Set("as_of_date", d)
	}

	var out Ageing
	if err := h.reader.Get(r.Context(), "/api/v1/laporan/aging", q, &out); err != nil {
		h.failed(w, "aging", err)
		return
	}

	detail := map[string]string{"report": "aging", "type": kind, "rows": strconv.Itoa(len(out.Rows))}
	if h.record(w, r, PermAgingRead, kind+":"+out.AsOfDate, detail) {
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// report is the shared path for the five period reports: read and bound the period, call upstream, audit, and let
// the caller write the body. It returns false when it has already answered.
//
// Shared rather than repeated six times because the audit is the part that must not be forgotten, and a helper
// that writes the body for you is a helper someone will bypass "just this once".
func (h *Handler) report(w http.ResponseWriter, r *http.Request, path, report, action string, out any, extra url.Values) bool {
	year, month, ok := period(r)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "year 2000-2100 and month 1-12 are required.")
		return false
	}

	q := url.Values{"year": {strconv.Itoa(year)}, "month": {strconv.Itoa(month)}}
	for k, vs := range extra {
		for _, v := range vs {
			q.Add(k, v)
		}
	}

	if err := h.reader.Get(r.Context(), path, q, out); err != nil {
		h.failed(w, report, err)
		return false
	}

	// Detail names the report and the period, never a figure or an account name: the trail records that someone
	// read it, not what it said.
	detail := map[string]string{"report": report}
	if id := extra.Get("account_id"); id != "" {
		detail["account_id"] = id
	}
	return h.record(w, r, action, strconv.Itoa(year)+"-"+strconv.Itoa(month), detail)
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
