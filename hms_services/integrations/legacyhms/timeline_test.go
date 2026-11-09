package legacyhms

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"testing"
)

// textRows is a scripted result set of text values.
type textRows struct {
	rows TextRows
	i    int
}

func (t *textRows) Next() bool { t.i++; return t.i <= len(t.rows) }
func (t *textRows) Err() error { return nil }
func (t *textRows) Close() error {
	return nil
}
func (t *textRows) Scan(dest ...any) error {
	for i, d := range dest {
		*(d.(**string)) = t.rows[t.i-1][i]
	}
	return nil
}

// scripted answers each statement with fixed rows and records what was sent.
type scripted struct {
	rows map[string]TextRows
	sent []capture
}

func (s *scripted) QueryRow(_ context.Context, q string, args ...any) Row {
	s.sent = append(s.sent, capture{q, args})
	if strings.Contains(q, "FROM `reg_periksa` WHERE") && len(s.rows[TimelineHeader.SQL]) > 0 {
		return row{} // found; the bill does not use the encounter values
	}
	return row{err: ErrNoRows}
}

func (s *scripted) Query(_ context.Context, q string, args ...any) (Rows, error) {
	s.sent = append(s.sent, capture{q, args})
	return &textRows{rows: s.rows[q]}, nil
}

func cells(n int, v string) []*string {
	out := make([]*string, n)
	for i := range out {
		out[i] = &v
	}
	return out
}

func sectionNamed(name string) Section {
	for _, s := range append(append([]Section{TimelineHeader}, TimelineSections...), BillSections...) {
		if s.Name == name {
			return s
		}
	}
	panic(name)
}

var (
	timelineTables = "reg_periksa|penjab|poliklinik|dokter|kamar_inap|kamar|bangsal|pemeriksaan_ralan|pemeriksaan_ranap|pegawai|" +
		"petugas|rawat_jl_dr|rawat_jl_pr|rawat_jl_drpr|rawat_inap_dr|rawat_inap_pr|rawat_inap_drpr|jns_perawatan|" +
		"jns_perawatan_inap|periksa_lab|jns_perawatan_lab|detail_periksa_lab|template_laboratorium|periksa_radiologi|" +
		"jns_perawatan_radiologi|hasil_radiologi|resep_obat|resep_dokter|resep_dokter_racikan|databarang|" +
		"detail_pemberian_obat|aturan_pakai|returpasien|resep_pulang|tambahan_biaya|pengurangan_biaya|operasi|paket_operasi|laporan_operasi|diagnosa_pasien|penyakit|" +
		"prosedur_pasien|icd9|dpjp_ranap|resume_pasien_ranap|nota_jalan|nota_inap|detail_nota_jalan|" +
		"detail_nota_inap|piutang_pasien"
	tableRef = regexp.MustCompile("(?:FROM|JOIN) `([a-z_0-9]+)`")
	tableOK  = regexp.MustCompile("^(" + timelineTables + ")$")
	shape    = regexp.MustCompile("^SELECT [^;]+ FROM `[a-z_0-9]+` [a-z]+ [^;]*WHERE [a-z]+\\.`no_rawat` = \\?" +
		"( AND [a-z]+\\.`[a-z_]+` <> 0)?( GROUP BY [^;?]+)?( ORDER BY [^;?]+)? LIMIT [?1]$")
	forbidden = regexp.MustCompile(`(?i)\b(INSERT|UPDATE|DELETE|REPLACE|INTO|CREATE|ALTER|DROP|GRANT|LOCK|UNION|SLEEP|BENCHMARK|LOAD_FILE|OUTFILE|CALL|HANDLER)\b`)
)

func TestTimelineStatementsAreFixedReadOnlySelects(t *testing.T) {
	stmts := TimelineStatements()
	if len(stmts) != 1+len(TimelineSections)+len(BillSections) {
		t.Fatalf("statement count %d", len(stmts))
	}
	for _, q := range stmts {
		if !shape.MatchString(q) {
			t.Errorf("statement outside the allowed shape: %s", q)
		}
		if forbidden.MatchString(q) {
			t.Errorf("forbidden keyword: %s", q)
		}
		if n := strings.Count(q, "?"); n < 1 || n > 2 {
			t.Errorf("unexpected parameter count %d: %s", n, q)
		}
		for _, m := range tableRef.FindAllStringSubmatch(q, -1) {
			if !tableOK.MatchString(m[1]) {
				t.Errorf("table %s not in the timeline allowlist", m[1])
			}
		}
	}
	names := map[string]bool{}
	for _, s := range append(append([]Section{TimelineHeader}, TimelineSections...), BillSections...) {
		if names[s.Name] {
			t.Errorf("duplicate section %s", s.Name)
		}
		names[s.Name] = true
		if got := strings.Count(s.SQL[:strings.Index(s.SQL, " FROM `")], ", ") + 1; got != s.Cols {
			t.Errorf("%s: %d columns selected, Cols = %d", s.Name, got, s.Cols)
		}
		if (s.Cap == 1) != strings.HasSuffix(s.SQL, "LIMIT 1") {
			t.Errorf("%s: cap %d does not match its LIMIT", s.Name, s.Cap)
		}
	}
}

func TestTimelineReadsEverySectionAndDetectsTruncation(t *testing.T) {
	notes := sectionNamed("clinical_note_inpatient")
	full := make(TextRows, notes.Cap+1)
	for i := range full {
		full[i] = cells(notes.Cols, "x")
	}
	q := &scripted{rows: map[string]TextRows{TimelineHeader.SQL: {cells(TimelineHeader.Cols, "h")}, notes.SQL: full}}
	c := NewClinical(q)
	got, err := c.Timeline(context.Background(), "2026/10/26/000123")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rows["clinical_note_inpatient"]) != notes.Cap || len(got.Truncated) != 1 || got.Truncated[0] != notes.Name {
		t.Errorf("truncation not detected: %d rows, %v", len(got.Rows[notes.Name]), got.Truncated)
	}
	if len(q.sent) != 1+len(TimelineSections)+1 {
		t.Errorf("sent %d statements (header, sections, SEP)", len(q.sent))
	}
	listed := map[string]bool{}
	for _, s := range append(TimelineStatements(), BPJSStatements()...) {
		listed[s] = true
	}
	for _, s := range q.sent {
		if !listed[s.query] || s.args[0] != "2026/10/26/000123" {
			t.Errorf("unexpected statement or args: %s %v", s.query, s.args)
		}
		if strings.HasSuffix(s.query, "LIMIT ?") && s.args[1] != sectionFor(s.query).Cap+1 {
			t.Errorf("limit must be cap+1: %v", s.args)
		}
	}
}

func sectionFor(q string) Section {
	for _, s := range append(append([]Section{SEPSection}, TimelineSections...), BillSections...) {
		if s.SQL == q {
			return s
		}
	}
	return Section{}
}

func TestTimelineAndBillOfUnknownEncounter(t *testing.T) {
	q := &scripted{rows: map[string]TextRows{}}
	c := NewClinical(q)
	if _, err := c.Timeline(context.Background(), "2026/10/26/999999"); err != ErrNotFound {
		t.Errorf("timeline: %v", err)
	}
	if _, err := c.Bill(context.Background(), "2026/10/26/999999"); err != ErrNotFound {
		t.Errorf("bill: %v", err)
	}
	if len(q.sent) != 2 {
		t.Errorf("nothing else may be read for an unknown encounter, sent %d", len(q.sent))
	}
}

func TestBillReadsChargesAndTheSavedHeader(t *testing.T) {
	q := &scripted{rows: map[string]TextRows{TimelineHeader.SQL: {cells(TimelineHeader.Cols, "h")},
		sectionNamed("charge_medication").SQL: {cells(sectionNamed("charge_medication").Cols, "1")}}}
	got, err := NewClinical(q).Bill(context.Background(), "2026/10/26/000123")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rows["charge_medication"]) != 1 || len(got.Rows["encounter"]) != 1 || len(q.sent) != 1+len(ServiceSettings)+len(BillSections) {
		t.Errorf("unexpected bill read: %v, sent %d", got.Rows, len(q.sent))
	}
}

func TestTheBillNeverReadsTheSavedBillingTable(t *testing.T) {
	for _, q := range TimelineStatements() {
		if strings.Contains(q, "`billing`") {
			t.Errorf("the bill is aggregated from source tables, not read from billing: %s", q)
		}
	}
	if len(ChargeSections) != 17 {
		t.Errorf("charge sections: %d", len(ChargeSections))
	}
	for _, c := range ChargeSections {
		want := map[string]int{"": 6, TariffSingle: 7, TariffDrugClass: 6 + len(DrugClassColumns)}[c.Tariff]
		if c.Cols != want || c.Category == "" || c.LegacyCategory == "" || !strings.Contains(c.SQL, "AS DECIMAL(18,2)") {
			t.Errorf("%s: charge sections share one exact-decimal layout", c.Name)
		}
	}
}

var reconcileShape = regexp.MustCompile("^SELECT [^;]+ FROM `(nota_inap|nota_jalan|billing|ranap_gabung|kamar_inap|" +
	"detail_pemberian_obat|periksa_lab|resep_pulang|pengurangan_biaya)` [a-z]+ [^;]*(LIMIT \\?|= \\?|LIMIT 100)$")

func TestReconcileStatementsAreReadOnlySelects(t *testing.T) {
	for _, q := range ReconcileStatements() {
		if !reconcileShape.MatchString(q) || forbidden.MatchString(q) || strings.Contains(q, "JOIN") {
			t.Errorf("reconcile statement outside the allowlist: %s", q)
		}
	}
	billed := map[string]bool{}
	for _, c := range ChargeSections {
		billed[c.LegacyCategory] = true
	}
	for _, v := range ReconcileAlternatives {
		if !billed[v.LegacyCategory] || len(v.Parts) == 0 {
			t.Errorf("alternative for a category the bill does not have: %s", v.LegacyCategory)
		}
	}
}

var settingsShape = regexp.MustCompile("^SELECT s\\.`nama_service`, CAST\\(s\\.`besar` AS CHAR\\), [^;?]+ " +
	"FROM `(set_service_ranap|set_service_ranap_piutang)` s ORDER BY s\\.`nama_service` LIMIT 21$")

func TestServiceSettingsStatements(t *testing.T) {
	for _, s := range ServiceSettings {
		if !settingsShape.MatchString(s.SQL) || forbidden.MatchString(s.SQL) {
			t.Errorf("settings statement outside the allowlist: %s", s.SQL)
		}
		if got := strings.Count(s.SQL[:strings.Index(s.SQL, " FROM `")], ", ") + 1; got != s.Cols || s.Cols != 17 {
			t.Errorf("%s: %d columns, Cols %d", s.Name, got, s.Cols)
		}
	}
}

func TestBillReportsCutServiceSettings(t *testing.T) {
	many := make(TextRows, 21)
	for i := range many {
		many[i] = cells(17, "x")
	}
	q := &scripted{rows: map[string]TextRows{TimelineHeader.SQL: {cells(TimelineHeader.Cols, "h")}, ServiceSettings[0].SQL: many}}
	got, err := NewClinical(q).Bill(context.Background(), "2026/10/26/000123")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rows["service_settings_cash"]) != 20 || len(got.Truncated) != 1 || got.Truncated[0] != "service_settings_cash" {
		t.Errorf("settings cut not reported: %d %v", len(got.Rows["service_settings_cash"]), got.Truncated)
	}
}

func TestReconcilerReads(t *testing.T) {
	v := ReconcileAlternatives[0]
	q := &scripted{rows: map[string]TextRows{
		ReconcileSaved:           {{cells(1, "Obat")[0], cells(1, "5000.00")[0]}, {cells(1, "Kamar")[0], nil}},
		ReconcileMerged:          {cells(1, "1")},
		ReconcileSampleInpatient: {cells(1, "2026/10/26/000123"), cells(1, "2026/10/25/000001")},
		v.Parts[0]:               {cells(1, "100.00")},
	}}
	rc := NewReconciler(q)
	ctx := context.Background()
	saved, err := rc.Saved(ctx, "x")
	if err != nil || saved["Obat"] != "5000.00" || saved["Kamar"] != "" {
		t.Errorf("saved: %v %v", saved, err)
	}
	if m, err := rc.Merged(ctx, "x"); err != nil || !m {
		t.Errorf("merged: %v %v", m, err)
	}
	if n, err := rc.Sample(ctx, true, 2); err != nil || len(n) != 2 || q.sent[len(q.sent)-1].args[0] != 2 {
		t.Errorf("sample: %v %v", n, err)
	}
	if a, err := rc.Amounts(ctx, v, "x"); err != nil || len(a) != 1 || a[0] != "100.00" {
		t.Errorf("amounts: %v %v", a, err)
	}
	listed := map[string]bool{}
	for _, s := range ReconcileStatements() {
		listed[s] = true
	}
	for _, s := range q.sent {
		if !listed[s.query] {
			t.Errorf("unlisted statement: %s", s.query)
		}
	}
}

func TestTariffStatementsAreFixedReadOnlySelects(t *testing.T) {
	tables := regexp.MustCompile("^(jns_perawatan|jns_perawatan_inap|paket_operasi|databarang|jns_perawatan_lab|" +
		"jns_perawatan_radiologi|template_laboratorium|kategori_perawatan|penjab|poliklinik|bangsal|jenis|kodesatuan)$")
	shape := regexp.MustCompile("^SELECT [^;]+ FROM `[a-z_]+` [a-z]+[^;]* WHERE [^;]+ ORDER BY [^;?]+ LIMIT \\?$")
	for _, q := range TariffStatements() {
		if !shape.MatchString(q) || forbidden.MatchString(q) {
			t.Errorf("tariff statement outside the allowlist: %s", q)
		}
		for _, m := range tableRef.FindAllStringSubmatch(q, -1) {
			if !tables.MatchString(m[1]) {
				t.Errorf("table %s not in the tariff allowlist", m[1])
			}
		}
		for _, col := range []string{"h_beli", "dasar", "nilai_rujukan"} {
			if strings.Contains(q, col) {
				t.Errorf("tariff book reads %s: %s", col, q)
			}
		}
	}
	for _, k := range TariffKinds {
		got := strings.Count(k.SQL[:strings.Index(k.SQL, " FROM `")], ", ") + 1
		if got != k.Cols || k.Cols != TariffHeadCols+len(k.Components)+len(k.Prices) {
			t.Errorf("%s: %d columns selected, Cols %d", k.Name, got, k.Cols)
		}
		// q, its two LIKE patterns, two per filter, status twice, after, limit
		if n := strings.Count(k.SQL, "?"); n != 3+2*len(k.Filters)+2+2 {
			t.Errorf("%s: %d parameters", k.Name, n)
		}
	}
}

func TestTariffListBindsEveryFilter(t *testing.T) {
	q := &scripted{rows: map[string]TextRows{}}
	k, _ := TariffKindNamed("inpatient_procedure")
	_, err := NewTariff(q).List(context.Background(), k, TariffFilter{Query: "50%", Payer: "BPJ", Class: "Kelas 1",
		Place: "B01", Status: "active", After: "RI100", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	got := fmt.Sprint(q.sent[0].args)
	if want := "[50% %50!%% %50!%% BPJ BPJ Kelas 1 Kelas 1 B01 B01 1 1 RI100 50]"; got != want {
		t.Errorf("args %s, want %s", got, want)
	}
	d, _ := TariffKindNamed("drug")
	_, _ = NewTariff(q).List(context.Background(), d, TariffFilter{Status: "all", Limit: 10})
	// q and its two patterns, status twice, after: all off; then the limit.
	if a := q.sent[1].args; len(a) != 7 || a[0] != "" || a[1] != "" || a[3] != "" || a[5] != "" || a[6] != 10 {
		t.Errorf("no filter: %q", a)
	}
}
