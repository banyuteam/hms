package clinical

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"hms/services/integrations/legacyhms"
)

// Bill of a visit (contract clinical-timeline-v1, ADR-SVC-004 as amended 2026-11-08): the charges recorded for the
// visit in the legacy source tables, grouped by billing category, with subtotals and a total computed here in exact
// cents. The cashier's saved bill header, payments and receivable are returned alongside, as saved. Amounts are decimal
// strings (IDR, 2 decimals).
type Bill struct {
	Number      string        `json:"encounter_number"`
	Currency    string        `json:"currency"`
	Basis       string        `json:"basis"`
	CareSetting string        `json:"care_setting"`
	Groups      []ChargeGroup `json:"groups"`
	Total       string        `json:"total"`
	SavedBill   *SavedBill    `json:"saved_bill"`
	Payments    []BillPayment `json:"payments"`
	Receivable  *Receivable   `json:"receivable"`
	Truncated   []string      `json:"truncated"`
}

type ChargeGroup struct {
	Category       string       `json:"category"`
	LegacyCategory string       `json:"legacy_category"`
	Lines          []ChargeLine `json:"lines"`
	Subtotal       string       `json:"subtotal"`
}

type ChargeLine struct {
	Code       string  `json:"code"`
	Label      *string `json:"label"`
	Quantity   string  `json:"quantity"`
	UnitPrice  string  `json:"unit_price"`
	Additional string  `json:"additional"`
	Amount     string  `json:"amount"`
	// RatePercent is set on service fee lines only: Amount = UnitPrice (the base) x RatePercent / 100.
	RatePercent *string `json:"rate_percent"`
	// Tariff is today's price of this code in the tariff book (null: no tariff for this kind of line, the code is not
	// in the book, or no drug price for the visit's class). TariffMatches compares it with UnitPrice, the price charged.
	Tariff        *string `json:"tariff"`
	TariffMatches *bool   `json:"tariff_matches"`
}

// SavedBill is the cashier's bill header (`nota_jalan` / `nota_inap`).
type SavedBill struct {
	BillNumber  *string `json:"bill_number"`
	BilledAt    *string `json:"billed_at"`
	CareSetting string  `json:"care_setting"`
}

type BillPayment struct {
	Method string `json:"method"`
	Amount string `json:"amount"`
	Tax    string `json:"tax"`
}

type Receivable struct {
	Status      string  `json:"status"`
	Total       string  `json:"total"`
	DownPayment string  `json:"down_payment"`
	Remaining   string  `json:"remaining"`
	DueDate     *string `json:"due_date"`
}

var decimalText = regexp.MustCompile(`^(-?)(\d+)(?:\.(\d{1,2}))?$`)

// Cents parses a decimal amount ("1234.50", "-3", "") into cents; "" is 0. false for anything else.
func Cents(v string) (int64, bool) {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0, true
	}
	m := decimalText.FindStringSubmatch(v)
	if m == nil || len(m[2]) > 16 {
		return 0, false
	}
	whole, _ := strconv.ParseInt(m[2], 10, 64)
	frac, _ := strconv.ParseInt((m[3] + "00")[:2], 10, 64)
	c := whole*100 + frac
	if m[1] == "-" {
		c = -c
	}
	return c, true
}

// FormatCents writes cents as a decimal amount with 2 decimals.
func FormatCents(c int64) string {
	sign := ""
	if c < 0 {
		sign, c = "-", -c
	}
	return sign + strconv.FormatInt(c/100, 10) + "." + strconv.FormatInt(100+c%100, 10)[1:]
}

// raw keeps a stored value as is apart from surrounding spaces.
func raw(r []*string, i int) string {
	if v := col(r, i); v != nil {
		return strings.TrimSpace(*v)
	}
	return ""
}

// MapBill maps the rows of legacyhms.Clinical.Bill. Groups follow legacyhms.ChargeSections; sections of one category
// (lab tests and priced lab items) share a group. The saved inpatient bill header wins when both exist.
func MapBill(number string, rows legacyhms.SectionRows, loc *time.Location) Bill {
	b := Bill{Number: number, Currency: "IDR", Basis: "recorded_charges", CareSetting: "unknown", Groups: []ChargeGroup{},
		Payments: []BillPayment{}, Truncated: append([]string{}, rows.Truncated...)}
	payerType := PayerType("")
	if e := rows.Rows["encounter"]; len(e) > 0 {
		if cs := careSetting(col(e[0], 0)); cs != "" {
			b.CareSetting = cs
		}
		payerType = PayerType(text(e[0], 1))
	}
	drugColumn := DrugTariffColumn(b.CareSetting, rows.Rows["visit_class"])
	var total int64
	index := map[string]int{}
	subtotals := map[string]int64{}
	for _, s := range legacyhms.ChargeSections {
		for _, r := range rows.Rows[s.Name] {
			i, ok := index[s.Category]
			if !ok {
				i = len(b.Groups)
				index[s.Category] = i
				b.Groups = append(b.Groups, ChargeGroup{Category: s.Category, LegacyCategory: s.LegacyCategory})
			}
			amount := raw(r, 5)
			c, _ := Cents(amount) // SQL returns DECIMAL(18,2) text; anything else would count as 0
			subtotals[s.Category] += c
			total += c
			line := ChargeLine{Code: text(r, 0), Label: opt(r, 1), Quantity: raw(r, 2), UnitPrice: raw(r, 3),
				Additional: raw(r, 4), Amount: amount}
			switch s.Tariff {
			case legacyhms.TariffSingle:
				line.Tariff = optional(col(r, 6))
			case legacyhms.TariffDrugClass:
				if drugColumn >= 0 {
					line.Tariff = optional(col(r, 6+drugColumn))
				}
			}
			if line.Tariff != nil {
				charged, ok1 := Cents(line.UnitPrice)
				tariff, ok2 := Cents(*line.Tariff)
				if ok1 && ok2 && line.UnitPrice != "" {
					m := charged == tariff
					line.TariffMatches = &m
				}
			}
			b.Groups[i].Lines = append(b.Groups[i].Lines, line)
		}
	}
	if b.CareSetting == "inpatient" {
		if lines := ServiceLines(subtotals, rows.Rows[ServiceSettingsFor(payerType)]); len(lines) > 0 {
			g := ChargeGroup{Category: "service", LegacyCategory: "Service", Lines: lines}
			for _, l := range lines {
				c, _ := Cents(l.Amount)
				subtotals["service"] += c
				total += c
			}
			b.Groups = append(b.Groups, g)
		}
	}
	for i := range b.Groups {
		b.Groups[i].Subtotal = FormatCents(subtotals[b.Groups[i].Category])
	}
	b.Total = FormatCents(total)

	payments := ""
	for _, h := range []struct{ section, care, payments string }{
		{"bill_inpatient", "inpatient", "payment_inpatient"}, {"bill_outpatient", "outpatient", "payment_outpatient"},
	} {
		if r := rows.Rows[h.section]; len(r) > 0 {
			b.SavedBill = &SavedBill{BillNumber: opt(r[0], 0), BilledAt: stamp(rowStamp(r[0], 1, 2, loc)), CareSetting: h.care}
			payments = h.payments
			break
		}
	}
	if payments != "" {
		for _, r := range rows.Rows[payments] {
			b.Payments = append(b.Payments, BillPayment{Method: text(r, 0), Amount: raw(r, 1), Tax: raw(r, 2)})
		}
	}
	if r := rows.Rows["receivable"]; len(r) > 0 {
		b.Receivable = &Receivable{Status: text(r[0], 0), Total: raw(r[0], 1), DownPayment: raw(r[0], 2),
			Remaining: raw(r[0], 3), DueDate: ValidDate(col(r[0], 4))}
	}
	return b
}

// serviceFlagCategories maps legacyhms.ServiceFlagColumns to bill categories. `harian` (daily room fees) has no
// category in this bill. A doctor-and-nurse procedure counts under the doctor switch (assumption, see ADR-SVC-004).
var serviceFlagCategories = [][]string{
	{"laboratory"}, {"radiology"}, {"surgery"}, {"medication"}, {"inpatient_doctor", "inpatient_doctor_nurse"},
	{"inpatient_nurse"}, {"outpatient_doctor", "outpatient_doctor_nurse"}, {"outpatient_nurse"}, {"extra_charge"},
	{"discount"}, {"room"}, {"registration"}, {}, {"medication_return"}, {"take_home_medication"},
}

// ServiceSettingsFor names the service settings that apply to a payer type: the legacy cash settings for patients
// paying themselves, the receivable settings for insurers and BPJS.
func ServiceSettingsFor(payerType string) string {
	if payerType == "personal" {
		return "service_settings_cash"
	}
	return "service_settings_receivable"
}

// ServiceLines computes the inpatient service fee: for each legacy service setting, its percentage of the sum of the
// category subtotals switched on ("Yes"), rounded to the cent. Settings without a positive percentage or base are
// skipped.
func ServiceLines(subtotals map[string]int64, settings legacyhms.TextRows) []ChargeLine {
	var out []ChargeLine
	for _, r := range settings {
		rateText := text(r, 1)
		rate, err := strconv.ParseFloat(rateText, 64)
		if err != nil || rate <= 0 || math.IsInf(rate, 0) {
			continue
		}
		var base int64
		for i, cats := range serviceFlagCategories {
			if strings.EqualFold(text(r, 2+i), "Yes") {
				for _, c := range cats {
					base += subtotals[c]
				}
			}
		}
		if base == 0 {
			continue
		}
		amount := int64(math.Round(float64(base) * rate / 100))
		out = append(out, ChargeLine{Code: "", Label: opt(r, 0), Quantity: "1", UnitPrice: FormatCents(base),
			Additional: "0.00", Amount: FormatCents(amount), RatePercent: &rateText})
	}
	return out
}

// roomClassDrugColumn maps a room class to its `databarang` price column (index into legacyhms.DrugClassColumns).
// Intensive-care and perinatal rooms have no drug price column of their own.
var roomClassDrugColumn = map[string]int{"Kelas 1": 1, "Kelas 2": 2, "Kelas 3": 3, "Kelas Utama": 4, "Kelas VIP": 5, "Kelas VVIP": 6}

// DrugTariffColumn is the drug price a bill line is compared with: outpatient price for outpatient visits, the latest
// room's class for inpatient visits; -1 when there is none.
func DrugTariffColumn(careSetting string, visitClass legacyhms.TextRows) int {
	switch careSetting {
	case "outpatient":
		return 0
	case "inpatient":
		if len(visitClass) > 0 {
			if i, ok := roomClassDrugColumn[text(visitClass[0], 0)]; ok {
				return i
			}
		}
	}
	return -1
}
