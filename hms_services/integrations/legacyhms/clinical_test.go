package legacyhms

import (
	"context"
	"regexp"
	"strings"
	"testing"
)

type capture struct {
	query string
	args  []any
}

type emptyRows struct{}

func (emptyRows) Next() bool        { return false }
func (emptyRows) Scan(...any) error { return nil }
func (emptyRows) Err() error        { return nil }
func (emptyRows) Close() error      { return nil }

// recorder answers every statement with nothing and records what was sent.
type recorder struct{ sent []capture }

func (r *recorder) QueryRow(_ context.Context, q string, args ...any) Row {
	r.sent = append(r.sent, capture{q, args})
	return row{err: ErrNoRows}
}

func (r *recorder) Query(_ context.Context, q string, args ...any) (Rows, error) {
	r.sent = append(r.sent, capture{q, args})
	return emptyRows{}, nil
}

func TestClinicalStatementsAreFixedReadOnlySelects(t *testing.T) {
	c := NewClinical(&recorder{})
	// The only joins: a visit's payer name from `penjab`, an encounter search hit's patient name from `pasien`.
	allowed := regexp.MustCompile("^SELECT [^;]+ FROM `(pasien|reg_periksa)`( r LEFT JOIN `penjab` pj ON pj.`kd_pj` = r.`kd_pj`" +
		"| r LEFT JOIN `pasien` p ON p.`no_rkm_medis` = r.`no_rkm_medis`)? WHERE [^;]+ LIMIT [?1]$")
	// The allergy list: three sources, each joined to the patient's visits only.
	branch := func(table string) string {
		return "SELECT [^;]+ FROM `" + table + "` x JOIN `reg_periksa` r ON r.`no_rawat` = x.`no_rawat` WHERE r.`no_rkm_medis` = \\? " +
			"AND TRIM\\(x.`alergi`\\) NOT IN \\('', '-'\\)"
	}
	allergies := regexp.MustCompile("^" + branch("pemeriksaan_ranap") + " UNION ALL " + branch("pemeriksaan_ralan") +
		" UNION ALL " + branch("resume_pasien_ranap") + " ORDER BY [^;]+ LIMIT \\?$")
	unions := 0
	for _, q := range c.Statements() {
		if strings.Contains(q, " UNION ") {
			unions++
			if !allergies.MatchString(q) || strings.Count(q, "?") != 4 {
				t.Errorf("union outside the allowlist: %s", q)
			}
			continue
		}
		if !allowed.MatchString(q) {
			t.Errorf("statement outside the allowlist: %s", q)
		}
	}
	if unions != 1 {
		t.Errorf("unexpected union count %d", unions)
	}
	if len(c.Statements()) != 9+MaxSearchWords {
		t.Errorf("unexpected statement count %d", len(c.Statements()))
	}
}

func TestClinicalSendsOnlyListedStatementsWithEscapedWords(t *testing.T) {
	rec := &recorder{}
	c := NewClinical(rec)
	ctx := context.Background()
	if _, err := c.Patient(ctx, "000001"); err != ErrNotFound {
		t.Errorf("missing patient: %v", err)
	}
	_, _ = c.SearchPatients(ctx, []string{"50%", "a_b"}, 25)
	_, _ = c.PatientEncounters(ctx, "000001", "", 100)
	_, _ = c.SearchEncounters(ctx, "2026/10", 25)
	_, _ = c.PayerVisits(ctx, "000001", 501)
	_, _ = c.PatientScan(ctx, "000001", 500)
	_, _ = c.SearchEncountersNamed(ctx, "2026/1_", 25)
	_, _ = c.PatientAllergies(ctx, "000001", 2001)
	if _, err := c.SearchPatients(ctx, make([]string, MaxSearchWords+1), 25); err == nil {
		t.Error("too many words accepted")
	}
	listed := map[string]bool{}
	for _, q := range c.Statements() {
		listed[q] = true
	}
	for _, s := range rec.sent {
		if !listed[s.query] {
			t.Errorf("unlisted statement sent: %s", s.query)
		}
	}
	search := rec.sent[1].args
	if search[0] != "%50!%%" || search[2] != "%a!_b%" || search[4] != "50%" || search[5] != 25 {
		t.Errorf("search args not escaped as expected: %v", search)
	}
	if rec.sent[2].args[1] != "~" {
		t.Errorf("first page must start after every encounter number: %v", rec.sent[2].args)
	}
	if rec.sent[3].args[0] != "2026/10%" {
		t.Errorf("prefix search args: %v", rec.sent[3].args)
	}
	if a := rec.sent[4].args; a[0] != "000001" || a[1] != 501 {
		t.Errorf("payer visit args: %v", a)
	}
	if a := rec.sent[5].args; a[0] != "000001" || a[1] != 500 {
		t.Errorf("patient scan args: %v", a)
	}
	if a := rec.sent[6].args; a[0] != "2026/1!_%" || a[1] != 25 {
		t.Errorf("named encounter search args: %v", a)
	}
	if a := rec.sent[7].args; len(a) != 4 || a[0] != "000001" || a[1] != "000001" || a[2] != "000001" || a[3] != 2001 {
		t.Errorf("allergy args: %v", a)
	}
}
