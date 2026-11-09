package legacyhms

import (
	"context"
	"regexp"
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
	// The only join: a visit's payer name from `penjab`.
	allowed := regexp.MustCompile("^SELECT [^;]+ FROM `(pasien|reg_periksa)`( r LEFT JOIN `penjab` pj ON pj.`kd_pj` = r.`kd_pj`)? WHERE [^;]+ LIMIT [?1]$")
	for _, q := range c.Statements() {
		if !allowed.MatchString(q) {
			t.Errorf("statement outside the allowlist: %s", q)
		}
	}
	if len(c.Statements()) != 6+MaxSearchWords {
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
}
