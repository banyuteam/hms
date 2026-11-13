package clinical

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"hms/services/integrations/legacyhms"
)

// r builds one stored row; "<nil>" stands for NULL.
func r(vals ...string) []*string {
	out := make([]*string, len(vals))
	for i, v := range vals {
		if v != "<nil>" {
			out[i] = s(v)
		}
	}
	return out
}

func sampleTimeline() legacyhms.SectionRows {
	return legacyhms.SectionRows{Rows: map[string]legacyhms.TextRows{
		"header": {r("000001", "Ranap", "Dirawat", "BPJ", "BPJS Kesehatan", "BPJS", "003", "2026-10-26", "08:15:00", "IGD", "dr. Contoh")},
		"room_stay": {r("2026-10-26", "10:00:00", "VIP.01", "Kelas VIP", "Melati", "Febris", "-", "0000-00-00", "00:00:00",
			"<nil>", "-")},
		"clinical_note_inpatient": {
			r("2026-10-27", "07:00:00", "P001", "Perawat Contoh", "demam", "tampak lemah", "febris", "observasi", "-", "-", "-",
				"Compos Mentis", "120/80", "88", "20", "38.2", "98", "15", "-", "<nil>"),
			r("0000-00-00", "00:00:00", "P001", "<nil>", "", "", "", "", "", "", "", "Alert", "", "", "", "", "", "", "", ""),
		},
		"procedure_rawat_inap_drpr": {r("2026-10-26", "11:00:00", "INF01", "Pasang infus", "dr. Contoh", "Perawat Contoh")},
		"lab_test":                  {r("2026-10-26", "09:00:00", "LAB01", "Darah lengkap", "PK", "Ranap", "dr. Lab", "dr. Contoh", "Analis")},
		"lab_result": {
			r("2026-10-26", "09:00:00", "LAB01", "11", "Hemoglobin", "13.1", "12-16", "g/dL", ""),
			r("2026-10-26", "09:00:00", "LAB02", "12", "Other test", "1", "", "", ""),
		},
		"prescription":          {r("R001", "2026-10-26", "12:00:00", "2026-10-26", "12:05:00", "0000-00-00", "00:00:00", "ranap", "dr. Contoh")},
		"prescription_item":     {r("R001", "B001", "Parasetamol 500", "10", "TAB", "3x1")},
		"prescription_compound": {r("R001", "1", "Puyer batuk", "6", "3x1", "-")},
		"surgery":               {r("2026-10-28 09:30:00", "Appendektomi", "dr. Bedah", "dr. Anestesi", "GA", "Sedang", "Ranap")},
		"diagnosis":             {r("A01.0", "Demam tifoid", "Ranap", "1", "Baru")},
		"coded_procedure":       {r("47.09", "Appendectomy", "Ranap", "1")},
		"attending_doctor":      {r("dr. Contoh", "1")},
		"discharge_summary":     {r("dr. Contoh", "demam", "membaik", "A01.0", "Demam tifoid", "", "", "", "", "-", "Membaik", "Atas Izin Dokter", "obat", "biasa", "edukasi", "<nil>")},
	}, Truncated: []string{"lab_result"}}
}

func TestMapTimelineOrdersAndAttaches(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Jakarta")
	tl := MapTimeline("2026/10/26/000123", sampleTimeline(), loc)
	if *tl.PatientMRN != "000001" || tl.Summary.CareSetting != "inpatient" || *tl.Summary.Status.Code != "Dirawat" {
		t.Errorf("header: %+v", tl.Summary)
	}
	if p := tl.Summary.Payer; p.Type != "bpjs" || p.Code != "BPJ" || *p.Name != "BPJS Kesehatan" {
		t.Errorf("payer: %+v", p)
	}
	var types []string
	for _, e := range tl.Entries {
		types = append(types, e["type"].(string))
	}
	want := "registration,lab_test,room_stay,procedure,prescription,clinical_note,surgery,clinical_note"
	if strings.Join(types, ",") != want {
		t.Errorf("order %v, want %s", types, want)
	}
	if at := tl.Entries[0]["at"].(*string); *at != "2026-10-26T08:15:00+07:00" {
		t.Errorf("registration at %s", *at)
	}
	if tl.Entries[len(tl.Entries)-1]["at"].(*string) != nil {
		t.Error("an entry without a valid date must be undated and last")
	}
	lab := tl.Entries[1]
	if res := lab["results"].([]map[string]any); len(res) != 1 || res[0]["value"] != "13.1" || res[0]["template_id"] != 11 {
		t.Errorf("lab results attach by (date, time, code) only: %v", lab["results"])
	}
	note := tl.Entries[5]
	if note["subjective"] != "demam" || note["objective"] != "tampak lemah" || note["assessment"] != "febris" ||
		note["plan"] != "observasi" || note["instruction"] != "" || *note["consciousness"].(*string) != "Compos Mentis" {
		t.Errorf("SOAP mapping: %v", note)
	}
	if v := note["vitals"].(map[string]*string); *v["blood_pressure"] != "120/80" || v["weight"] != nil || v["height"] != nil {
		t.Errorf("vitals: %v", v)
	}
	rx := tl.Entries[4]
	if rx["dispensed_at"].(*string) != nil || len(rx["items"].([]map[string]any)) != 1 || len(rx["compounds"].([]map[string]any)) != 1 {
		t.Errorf("prescription: %v", rx)
	}
	room := tl.Entries[2]
	if room["discharged_at"].(*string) != nil || room["discharge_diagnosis"].(*string) != nil || room["discharge_status"].(*string) != nil {
		t.Errorf("room stay: legacy '-' and 0000-00-00 mean not recorded: %v", room)
	}
	if at := tl.Entries[6]["at"].(*string); *at != "2026-10-28T09:30:00+07:00" {
		t.Errorf("surgery datetime: %s", *at)
	}
	if d := tl.Summary.Diagnoses[0]; d.Code != "A01.0" || *d.Case != "new" || d.Priority != 1 || d.CareSetting != "inpatient" {
		t.Errorf("diagnosis: %+v", d)
	}
	if ds := tl.Summary.DischargeSummary; ds == nil || ds.MainDiagnosis.Code != "A01.0" || ds.Allergy != "" || ds.Control != nil ||
		ds.SecondaryDiagnosis.Name != nil {
		t.Errorf("discharge summary: %+v", ds)
	}
	if len(tl.Truncated) != 1 || tl.Truncated[0] != "lab_result" {
		t.Errorf("truncated: %v", tl.Truncated)
	}
}

func TestMapTimelineEmptySectionsAreEmptyLists(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Jakarta")
	b, _ := json.Marshal(MapTimeline("2026/10/26/000123", legacyhms.SectionRows{Rows: map[string]legacyhms.TextRows{}}, loc))
	for _, frag := range []string{`"entries":[]`, `"truncated":[]`, `"diagnoses":[]`, `"discharge_summary":null`, `"care_setting":"unknown"`, `"sep":[]`} {
		if !strings.Contains(string(b), frag) {
			t.Errorf("missing %s in %s", frag, b)
		}
	}
}

func TestMapTimelineSEP(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Jakarta")
	str := func(v string) *string { return &v }
	rows := legacyhms.SectionRows{Rows: map[string]legacyhms.TextRows{"sep": {
		{str("0301R0011026V000123"), str("2026-10-26"), str("1"), str("3"), str("030101021026P000999"), str("Puskesmas Contoh"),
			str("I50.0"), str("Heart failure"), str("-"), str("dr. Contoh"), str("2026-10-30 10:00:00"), str("0. Tidak"),
			str("0. Tidak"), str("")},
		{str("0301R0011026V000124"), str("0000-00-00"), str("2"), nil, nil, nil, str(""), nil, nil, nil,
			str("0000-00-00 00:00:00"), str("0. Tidak"), str("1.Ya"), str("0301R0011026V000123")},
	}}}
	sep := MapTimeline("2026/10/26/000123", rows, loc).Summary.SEP
	if len(sep) != 2 {
		t.Fatalf("sep %+v", sep)
	}
	a, b := sep[0], sep[1]
	// Decision B-1 (b): the number is sent in full.
	if a.Number != "0301R0011026V000123" || *a.Date != "2026-10-26" || *a.ServiceType != "1" || *a.Class != "3" ||
		a.InitialDiagnosis.Code != "I50.0" || a.DestinationClinic != nil || *a.DischargedAt != "2026-10-30T10:00:00+07:00" ||
		*a.COB != "0. Tidak" || a.SuplesiSEPNumber != nil {
		t.Errorf("first SEP %+v", a)
	}
	if b.Date != nil || b.DischargedAt != nil || b.Class != nil || *b.Suplesi != "1.Ya" || *b.SuplesiSEPNumber != "0301R0011026V000123" {
		t.Errorf("legacy no-date values are not recorded, codes as stored: %+v", b)
	}
}

func TestPayerType(t *testing.T) {
	for code, want := range map[string]string{"": "personal", "UMU": "personal", "BPJ": "bpjs", "A09": "insurer"} {
		if got := PayerType(code); got != want {
			t.Errorf("PayerType(%q) = %s", code, got)
		}
	}
}

func TestCents(t *testing.T) {
	for in, want := range map[string]int64{"": 0, "0.00": 0, "1234.5": 123450, "1234.56": 123456, "-3": -300, "7": 700} {
		if got, ok := Cents(in); !ok || got != want {
			t.Errorf("Cents(%q) = %d %v", in, got, ok)
		}
	}
	for _, bad := range []string{"1.234", "1e5", "abc", "1,5", "--1"} {
		if _, ok := Cents(bad); ok {
			t.Errorf("Cents(%q) accepted", bad)
		}
	}
	for c, want := range map[int64]string{0: "0.00", 5: "0.05", 123456: "1234.56", -250: "-2.50"} {
		if got := FormatCents(c); got != want {
			t.Errorf("FormatCents(%d) = %s", c, got)
		}
	}
}

// setting builds one legacy service setting row: name, percentage, then the 15 switches (Yes for the named ones).
func setting(name, rate string, on ...string) []*string {
	cols := []string{"laborat", "radiologi", "operasi", "obat", "ranap_dokter", "ranap_paramedis", "ralan_dokter",
		"ralan_paramedis", "tambahan", "potongan", "kamar", "registrasi", "harian", "retur_Obat", "resep_Pulang"}
	vals := []string{name, rate}
	for _, c := range cols {
		v := "No"
		for _, o := range on {
			if o == c {
				v = "Yes"
			}
		}
		vals = append(vals, v)
	}
	return r(vals...)
}

func sampleBill() legacyhms.SectionRows {
	return legacyhms.SectionRows{Rows: map[string]legacyhms.TextRows{
		"encounter":            {r("Ranap", "UMU")},
		"charge_registration":  {r("IGD", "IGD", "1", "15000.00", "0.00", "15000.00")},
		"charge_room":          {r("VIP.01", "Melati", "4.00", "350000.00", "0.00", "1400000.00")},
		"charge_rawat_inap_dr": {r("RI01", "Visite dokter", "3", "75000.10", "0.00", "225000.30")},
		"charge_lab_test":      {r("LAB01", "Darah lengkap", "1", "80000.00", "0.00", "80000.00")},
		"charge_lab_item":      {r("11", "<nil>", "1", "15000.00", "0.00", "15000.00")},
		"charge_medication":    {r("B001", "Parasetamol 500", "10.00", "500.00", "1000.00", "6000.00")},
		"charge_take_home":     {r("B002", "Amoksisilin", "15.00", "1000.00", "0.00", "15000.00")},
		"charge_return":        {r("B001", "Parasetamol 500", "-2.00", "500.00", "0.00", "-1000.00")},
		"charge_extra":         {r("", "Ambulans", "1", "200000.00", "0.00", "200000.00")},
		"charge_discount":      {r("", "Diskon karyawan", "1", "-50000.00", "0.00", "-50000.00")},
		"charge_rawat_jl_dr":   {},
		// The cash settings apply to a patient paying themselves; the receivable ones must be ignored here.
		"service_settings_cash":       {setting("Jasa layanan", "10", "kamar", "obat"), setting("Off", "0", "kamar")},
		"service_settings_receivable": {setting("Should not apply", "50", "kamar")},
		"bill_inpatient":              {r("RI2026/0001", "2026-10-30", "14:00:00")},
		"bill_outpatient":             {r("RJ2026/0009", "2026-10-26", "09:00:00")},
		"payment_inpatient":           {r("TUNAI", "5000.00", "<nil>")},
		"payment_outpatient":          {r("SHOULD NOT APPEAR", "1.00", "0.00")},
		"receivable":                  {r("Belum Lunas", "5000.00", "0.00", "5000.00", "0000-00-00")},
	}, Truncated: []string{"charge_medication"}}
}

func TestMapBillAggregatesRecordedCharges(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Jakarta")
	b := MapBill("2026/10/26/000123", sampleBill(), loc)
	var cats []string
	for _, g := range b.Groups {
		cats = append(cats, g.Category+"="+g.Subtotal)
	}
	// Service: 10% of room (1,400,000) + drugs (6,000) = 140,600.
	want := "registration=15000.00,room=1400000.00,inpatient_doctor=225000.30,laboratory=95000.00,medication=6000.00," +
		"take_home_medication=15000.00,medication_return=-1000.00,extra_charge=200000.00,discount=-50000.00,service=140600.00"
	if strings.Join(cats, ",") != want {
		t.Errorf("groups %v\nwant %s", cats, want)
	}
	if b.Total != "2045600.30" || b.CareSetting != "inpatient" || b.Basis != "recorded_charges" {
		t.Errorf("total %s, care %s", b.Total, b.CareSetting)
	}
	svc := b.Groups[len(b.Groups)-1]
	if len(svc.Lines) != 1 || *svc.Lines[0].Label != "Jasa layanan" || *svc.Lines[0].RatePercent != "10" ||
		svc.Lines[0].UnitPrice != "1406000.00" || svc.LegacyCategory != "Service" {
		t.Errorf("service: %+v", svc)
	}
	lab := b.Groups[3]
	if len(lab.Lines) != 2 || lab.LegacyCategory != "Laborat" || lab.Lines[1].Label != nil || lab.Lines[1].Code != "11" {
		t.Errorf("lab group: %+v", lab)
	}
	if med := b.Groups[4].Lines[0]; med.Quantity != "10.00" || med.UnitPrice != "500.00" || med.Additional != "1000.00" ||
		med.RatePercent != nil {
		t.Errorf("medication line: %+v", med)
	}
	if b.SavedBill == nil || *b.SavedBill.BillNumber != "RI2026/0001" || b.SavedBill.CareSetting != "inpatient" ||
		*b.SavedBill.BilledAt != "2026-10-30T14:00:00+07:00" {
		t.Errorf("saved bill: %+v", b.SavedBill)
	}
	if len(b.Payments) != 1 || b.Payments[0].Method != "TUNAI" || b.Payments[0].Tax != "" {
		t.Errorf("payments: %+v", b.Payments)
	}
	if b.Receivable == nil || b.Receivable.Remaining != "5000.00" || b.Receivable.DueDate != nil {
		t.Errorf("receivable: %+v", b.Receivable)
	}
	if len(b.Truncated) != 1 {
		t.Errorf("truncated: %v", b.Truncated)
	}
	empty := MapBill("2026/10/26/000123", legacyhms.SectionRows{Rows: map[string]legacyhms.TextRows{}}, loc)
	if empty.SavedBill != nil || empty.Groups == nil || len(empty.Groups) != 0 || empty.Total != "0.00" ||
		empty.Receivable != nil || empty.Currency != "IDR" || empty.CareSetting != "unknown" {
		t.Errorf("visit without charges: %+v", empty)
	}
}

func TestServiceFeeRules(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Jakarta")
	rows := sampleBill()
	rows.Rows["encounter"] = legacyhms.TextRows{r("Ranap", "BPJ")}
	b := MapBill("x", rows, loc)
	svc := b.Groups[len(b.Groups)-1]
	if svc.Category != "service" || *svc.Lines[0].Label != "Should not apply" || svc.Subtotal != "700000.00" {
		t.Errorf("BPJS/insurer visits use the receivable settings: %+v", svc)
	}
	rows.Rows["encounter"] = legacyhms.TextRows{r("Ralan", "UMU")}
	if b := MapBill("x", rows, loc); b.Groups[len(b.Groups)-1].Category == "service" {
		t.Error("no service fee on outpatient visits (the legacy HMS has no outpatient service settings)")
	}
	// Doctor-and-nurse procedures count under the doctor switch; rounding is to the cent.
	lines := ServiceLines(map[string]int64{"inpatient_doctor": 100, "inpatient_doctor_nurse": 33, "room": 999},
		legacyhms.TextRows{setting("S", "2.5", "ranap_dokter")})
	if len(lines) != 1 || lines[0].UnitPrice != "1.33" || lines[0].Amount != "0.03" {
		t.Errorf("service lines: %+v", lines)
	}
	if got := ServiceLines(map[string]int64{"room": 100}, legacyhms.TextRows{setting("S", "abc", "kamar"), setting("T", "5", "laborat")}); len(got) != 0 {
		t.Errorf("an unreadable rate or an empty base adds nothing: %+v", got)
	}
}

func TestTimelineAndBillAreAuditedAndFailClosed(t *testing.T) {
	for _, tc := range []struct {
		action string
		fn     func(e *env) func(w http.ResponseWriter, r *http.Request)
	}{
		{"encounter.timeline.read", func(e *env) func(http.ResponseWriter, *http.Request) { return e.h.timeline }},
		{"encounter.bill.read", func(e *env) func(http.ResponseWriter, *http.Request) { return e.h.bill }},
	} {
		e := newEnv(t)
		e.read.sections = sampleTimeline()
		path := map[string]string{"number": "2026/10/26/000123"}
		w := call(tc.fn(e), "/api/v1/encounters/x", path)
		if w.Code != 200 || len(e.audit.events) != 1 {
			t.Fatalf("%s: status %d, events %d", tc.action, w.Code, len(e.audit.events))
		}
		ev := e.audit.events[0]
		if ev.Action != tc.action || ev.Outcome != "success" || ev.ResourceType != "Encounter" ||
			ev.ResourceID != "2026/10/26/000123" || ev.Detail["truncated"] != "lab_result" {
			t.Errorf("%s: audit %+v", tc.action, ev)
		}

		e.audit.fail = true
		if w := call(tc.fn(e), "/x", path); w.Code != 503 || strings.Contains(w.Body.String(), "2026/10/26") {
			t.Errorf("%s: audit down must withhold data: %d %s", tc.action, w.Code, w.Body.String())
		}
		e.audit.fail = false

		if w := call(tc.fn(e), "/x", map[string]string{"number": "2026/10/26/999999"}); w.Code != 404 ||
			e.audit.events[len(e.audit.events)-1].Outcome != "failure" {
			t.Errorf("%s: unknown encounter must be 404 and audited", tc.action)
		}
		if w := call(tc.fn(e), "/x", map[string]string{"number": "x' OR 1"}); w.Code != 404 {
			t.Errorf("%s: malformed number: %d", tc.action, w.Code)
		}
		e.read.down = true
		if w := call(tc.fn(e), "/x", path); w.Code != 503 {
			t.Errorf("%s: legacy down: %d", tc.action, w.Code)
		}
	}
}

func TestTimelinePermissionsAreRegistered(t *testing.T) {
	have := map[string]bool{}
	for _, p := range Permissions {
		have[p.Code] = true
	}
	if !have["encounter.clinical.read"] || !have["billing.read"] {
		t.Errorf("permissions: %v", have)
	}
}

func TestBillLinesCarryTodaysTariff(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Jakarta")
	drug := r("B001", "Parasetamol 500", "10.00", "500.00", "1000.00", "6000.00",
		"450.00", "460.00", "470.00", "480.00", "490.00", "500.00", "510.00") // ralan, kelas1..3, utama, vip, vvip
	rows := legacyhms.SectionRows{Rows: map[string]legacyhms.TextRows{
		"encounter":            {r("Ranap", "UMU")},
		"visit_class":          {r("Kelas VIP")},
		"charge_rawat_inap_dr": {r("RI01", "Visite", "3", "75000.00", "0.00", "225000.00", "80000.00"), r("RI02", "Lama", "1", "1.00", "0.00", "1.00", "<nil>")},
		"charge_medication":    {drug},
		"charge_room":          {r("VIP.01", "Melati", "4.00", "350000.00", "0.00", "1400000.00")},
	}}
	b := MapBill("x", rows, loc)
	byCode := map[string]ChargeLine{}
	for _, g := range b.Groups {
		for _, l := range g.Lines {
			byCode[l.Code] = l
		}
	}
	if l := byCode["RI01"]; l.Tariff == nil || *l.Tariff != "80000.00" || l.TariffMatches == nil || *l.TariffMatches {
		t.Errorf("procedure charged below today's tariff must not match: %+v", l)
	}
	if l := byCode["RI02"]; l.Tariff != nil || l.TariffMatches != nil {
		t.Errorf("a code missing from the tariff book has no tariff: %+v", l)
	}
	if l := byCode["B001"]; l.Tariff == nil || *l.Tariff != "500.00" || !*l.TariffMatches {
		t.Errorf("drug compared with the VIP price: %+v", l)
	}
	if l := byCode["VIP.01"]; l.Tariff != nil {
		t.Errorf("rooms are not in the tariff book: %+v", l)
	}
	rows.Rows["encounter"] = legacyhms.TextRows{r("Ralan", "UMU")}
	if l := MapBill("x", rows, loc).Groups[2].Lines[0]; *l.Tariff != "450.00" || *l.TariffMatches {
		t.Errorf("outpatient visits compare with the outpatient price: %+v", l)
	}
	rows.Rows["encounter"] = legacyhms.TextRows{r("Ranap", "UMU")}
	rows.Rows["visit_class"] = legacyhms.TextRows{r("ICU")}
	if l := MapBill("x", rows, loc).Groups[2].Lines[0]; l.Tariff != nil {
		t.Errorf("no drug price column for intensive care: %+v", l)
	}
}

func TestMapTimelineAdmissionOrderAndEmergencyAssessment(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Jakarta")
	igd := r("2026-10-26 14:50:00", "dr. Jaga", "Autoanamnesis", "-", "sesak", "sesak 2 hari", "hipertensi", "-", "amlodipin",
		"amoksisilin", "Sakit Sedang", "15", "Compos Mentis", "150/95", "104", "26", "36.8", "91", "60", "158",
		"Normal", "Normal", "Tidak Diperiksa", "Normal", "Abnormal", "Normal", "Tidak Diperiksa", "Abnormal",
		"ronki basah", "edema tungkai", "sinus takikardi", "kardiomegali", "-", "CHF", "O2 3 lpm, furosemid IV",
		"Rawat Inap di", "Melati", "-")
	rows := legacyhms.SectionRows{Rows: map[string]legacyhms.TextRows{
		"admission_order":      {r("2026-10-26", "MEL.02", "Melati", "Kelas 2", "CHF", "<nil>", "dr. Andi")},
		"emergency_assessment": {igd},
	}}
	tl := MapTimeline("2026/10/26/000123", rows, loc)
	if len(tl.Entries) != 2 {
		t.Fatalf("entries: %v", tl.Entries)
	}
	order, a := tl.Entries[0], tl.Entries[1]
	if order["type"] != "admission_order" || *order["at"].(*string) != "2026-10-26T00:00:00+07:00" || order["time_recorded"] != false {
		t.Errorf("admission order: date only, at 00:00 and marked as such: %v", order)
	}
	if order["room_code"] != "MEL.02" || *order["ward"].(*string) != "Melati" || *order["diagnosis"].(*string) != "CHF" ||
		order["note"].(*string) != nil || *order["dpjp_name"].(*string) != "dr. Andi" {
		t.Errorf("admission order fields: %v", order)
	}
	if a["type"] != "emergency_assessment" || *a["at"].(*string) != "2026-10-26T14:50:00+07:00" || *a["doctor_name"].(*string) != "dr. Jaga" {
		t.Errorf("emergency assessment: %v", a)
	}
	if a["chief_complaint"] != "sesak" || a["family_history"] != "" || a["allergy"] != "amoksisilin" ||
		a["informant_relationship"] != "" || a["laboratory"] != "" || a["disposition"] != "Rawat Inap di" ||
		a["disposition_detail"] != "Melati" || a["indication"] != "" || *a["consciousness"].(*string) != "Compos Mentis" {
		t.Errorf("assessment text ('-' is not recorded): %v", a)
	}
	v := a["vitals"].(map[string]*string)
	if *v["blood_pressure"] != "150/95" || *v["gcs"] != "15" || *v["spo2"] != "91" || *v["weight"] != "60" || *v["height"] != "158" {
		t.Errorf("vitals: %v", v)
	}
	if px := a["physical_exam"].(map[string]*string); *px["thorax"] != "Abnormal" || *px["teeth"] != "Tidak Diperiksa" {
		t.Errorf("physical exam values as recorded: %v", px)
	}
}
