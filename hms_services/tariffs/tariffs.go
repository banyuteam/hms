// Package tariffs serves the tariff book (contract tariff-book-v1, ADR-SVC-005): the legacy HMS master price tables,
// read through package legacyhms and mapped to one item shape for every kind. Prices are decimal strings (IDR) as
// stored; nothing is computed except a surgery package's price (the sum of its fees, in SQL).
package tariffs

import (
	"context"
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

// PermTariffRead allows reading the tariff book.
const PermTariffRead = "tariff.read"

var Permissions = []iam.PermissionDef{
	{Code: PermTariffRead, Description: "View the tariff book (service, surgery, drug, laboratory and radiology prices)"},
}

// Reader is the legacy read side (legacyhms.Tariff).
type Reader interface {
	List(ctx context.Context, k legacyhms.TariffKind, f legacyhms.TariffFilter) (legacyhms.TextRows, error)
	LabItems(ctx context.Context, code string) (legacyhms.TextRows, bool, error)
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
	route := func(pattern string, fn http.HandlerFunc) {
		mux.Handle(pattern, h.iam.RequireSession(h.iam.RequirePermission(PermTariffRead, fn)))
	}
	route("GET /api/v1/tariffs", h.kinds)
	route("GET /api/v1/tariffs/{kind}", h.list)
	route("GET /api/v1/tariffs/laboratory/{code}/items", h.labItems)
}

type Coded struct {
	Code string  `json:"code"`
	Name *string `json:"name"`
}

type Place struct {
	Type string  `json:"type"`
	Code string  `json:"code"`
	Name *string `json:"name"`
}

type Amount struct {
	Name   string `json:"name"`
	Amount string `json:"amount"`
}

type Item struct {
	Code       string   `json:"code"`
	Name       *string  `json:"name"`
	Category   *Coded   `json:"category"`
	Payer      *Coded   `json:"payer"`
	Place      *Place   `json:"place"`
	Class      *string  `json:"class"`
	Unit       *string  `json:"unit"`
	Active     bool     `json:"active"`
	Components []Amount `json:"components"`
	Prices     []Amount `json:"prices"`
}

type LabItem struct {
	TemplateID int      `json:"template_id"`
	Name       *string  `json:"name"`
	Unit       *string  `json:"unit"`
	Components []Amount `json:"components"`
	Price      string   `json:"price"`
}

func val(r []*string, i int) string {
	if i < len(r) && r[i] != nil {
		return strings.TrimSpace(*r[i])
	}
	return ""
}

func opt(r []*string, i int) *string {
	if v := val(r, i); v != "" && v != "-" {
		return &v
	}
	return nil
}

func coded(r []*string, code, name int) *Coded {
	if c := val(r, code); c != "" && c != "-" {
		return &Coded{Code: c, Name: opt(r, name)}
	}
	return nil
}

// MapItem maps one tariff row (layout in legacyhms.TariffKind).
func MapItem(k legacyhms.TariffKind, r []*string) Item {
	it := Item{Code: val(r, 0), Name: opt(r, 1), Category: coded(r, 2, 3), Payer: coded(r, 4, 5), Class: opt(r, 8),
		Unit: opt(r, 9), Active: val(r, 10) == "1", Components: []Amount{}, Prices: []Amount{}}
	if c := val(r, 6); c != "" && c != "-" && k.Place != "" {
		it.Place = &Place{Type: k.Place, Code: c, Name: opt(r, 7)}
	}
	i := legacyhms.TariffHeadCols
	for _, name := range k.Components {
		it.Components = append(it.Components, Amount{Name: name, Amount: val(r, i)})
		i++
	}
	for _, name := range k.Prices {
		it.Prices = append(it.Prices, Amount{Name: name, Amount: val(r, i)})
		i++
	}
	return it
}

// MapLabItem maps one row of legacyhms.TariffLabItems.
func MapLabItem(r []*string) LabItem {
	id, _ := strconv.Atoi(val(r, 0))
	li := LabItem{TemplateID: id, Name: opt(r, 1), Unit: opt(r, 2), Components: []Amount{}, Price: val(r, 10)}
	for i, name := range legacyhms.LabItemComponents {
		li.Components = append(li.Components, Amount{Name: name, Amount: val(r, 3+i)})
	}
	return li
}

var (
	payerPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,3}$`)
	placePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,5}$`)
	classes      = map[string]bool{"-": true, "Rawat Jalan": true, "Kelas 1": true, "Kelas 2": true, "Kelas 3": true,
		"Kelas Utama": true, "Kelas VIP": true, "Kelas VVIP": true, "ICU": true}
)

func plainText(v string, max int) bool {
	return utf8.ValidString(v) && utf8.RuneCountInString(v) <= max && strings.IndexFunc(v, unicode.IsControl) < 0
}

// parseFilter validates the query string for a kind; filters the kind does not have are refused.
func parseFilter(k legacyhms.TariffKind, r *http.Request) (legacyhms.TariffFilter, bool) {
	q := r.URL.Query()
	f := legacyhms.TariffFilter{Query: strings.TrimSpace(q.Get("q")), Payer: q.Get("payer"), Class: q.Get("class"),
		Place: q.Get("place"), Status: q.Get("status"), After: q.Get("after"), Limit: 50}
	has := map[string]bool{}
	for _, name := range k.Filters {
		has[name] = true
	}
	if !plainText(f.Query, 64) || !plainText(f.After, 15) {
		return f, false
	}
	if f.Payer != "" && (!has["payer"] || !payerPattern.MatchString(f.Payer)) ||
		f.Class != "" && (!has["class"] || !classes[f.Class]) ||
		f.Place != "" && (!has["place"] || !placePattern.MatchString(f.Place)) {
		return f, false
	}
	switch f.Status {
	case "":
		f.Status = "active"
	case "active", "inactive", "all":
	default:
		return f, false
	}
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			return f, false
		}
		f.Limit = n
	}
	return f, true
}

// record writes the audit event; false = not written, the caller has answered 503 (fail closed).
func (h *Handler) record(w http.ResponseWriter, r *http.Request, action, resourceID string, detail map[string]string) bool {
	p, _ := iam.PrincipalFrom(r.Context())
	ri := h.iam.RequestInfo(r)
	err := h.audit.WriteAudit(r.Context(), audit.Event{
		OccurredAt: h.now(), Category: audit.CategoryDataAccess, Action: action, Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorUser, ActorID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		ResourceType: "Tariff", ResourceID: resourceID, Channel: ri.ClientType, RequestID: ri.RequestID,
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

type kindInfo struct {
	Kind       string   `json:"kind"`
	Place      *string  `json:"place"`
	Filters    []string `json:"filters"`
	Components []string `json:"components"`
	Prices     []string `json:"prices"`
}

// kinds describes the tariff kinds (static; no legacy read, not audited).
func (h *Handler) kinds(w http.ResponseWriter, _ *http.Request) {
	out := make([]kindInfo, 0, len(legacyhms.TariffKinds))
	for _, k := range legacyhms.TariffKinds {
		info := kindInfo{Kind: k.Name, Filters: append([]string{}, k.Filters...), Components: append([]string{}, k.Components...),
			Prices: append([]string{}, k.Prices...)}
		if k.Place != "" {
			p := k.Place
			info.Place = &p
		}
		out = append(out, info)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"kinds": out})
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	k, ok := legacyhms.TariffKindNamed(r.PathValue("kind"))
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Not found.")
		return
	}
	f, ok := parseFilter(k, r)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"q up to 64 characters; payer, class and place only where the kind has them; status active|inactive|all; limit 1-100.")
		return
	}
	rows, err := h.reader.List(r.Context(), k, f)
	if err != nil {
		h.logger.Error("legacy tariff read failed", "kind", k.Name, "err", err)
		unavailable(w)
		return
	}
	items := make([]Item, 0, len(rows))
	for _, row := range rows {
		items = append(items, MapItem(k, row))
	}
	resp := map[string]any{"kind": k.Name, "items": items}
	if len(rows) == f.Limit {
		resp["next_after"] = items[len(items)-1].Code
	}
	if h.record(w, r, "tariff.search", k.Name, map[string]string{"results": strconv.Itoa(len(items))}) {
		httpx.WriteJSON(w, http.StatusOK, resp)
	}
}

var codePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,15}$`)

func (h *Handler) labItems(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	if !codePattern.MatchString(code) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Not found.")
		return
	}
	rows, truncated, err := h.reader.LabItems(r.Context(), code)
	if err != nil {
		h.logger.Error("legacy tariff read failed", "kind", "laboratory_items", "err", err)
		unavailable(w)
		return
	}
	items := make([]LabItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, MapLabItem(row))
	}
	if h.record(w, r, "tariff.read", "laboratory:"+code, map[string]string{"results": strconv.Itoa(len(items))}) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"code": code, "items": items, "truncated": truncated})
	}
}
