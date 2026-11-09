package legacyhms

import (
	"context"
	"regexp"
	"strings"
	"testing"
)

func TestBPJSStatementsAreFixedReadOnlySelects(t *testing.T) {
	shape := regexp.MustCompile("^SELECT [^;]+ FROM `bridging_sep` WHERE `no_rawat` (= \\?|IS NOT NULL) ORDER BY [^;?]+ LIMIT \\?$")
	for _, q := range append(BPJSStatements(), SEPSampleSQL) {
		if !shape.MatchString(q) || forbidden.MatchString(q) || strings.Contains(q, "JOIN") {
			t.Errorf("BPJS statement outside the allowlist: %s", q)
		}
		// Patient identity is on the patient record; the SEP copy of it is never read.
		for _, col := range []string{"nama_pasien", "tanggal_lahir", "jkel", "no_kartu", "notelep", "nomr", "kdprop",
			"nmprop", "kdkab", "nmkab", "kdkec", "nmkec", "peserta"} {
			if strings.Contains(q, "`"+col+"`") {
				t.Errorf("SEP statement reads %s", col)
			}
		}
	}
	selected := SEPSection.SQL[:strings.Index(SEPSection.SQL, " FROM `")]
	if got := strings.Count(selected, ", ") + 1; got != SEPSection.Cols || got != len(SEPColumns) {
		t.Errorf("%d columns selected, Cols %d, names %d", got, SEPSection.Cols, len(SEPColumns))
	}
	for _, col := range SEPColumns {
		if !strings.Contains(selected, "`"+col+"`") {
			t.Errorf("column %s listed but not selected", col)
		}
	}
}

func TestSEPReadsByEncounterWithCapPlusOne(t *testing.T) {
	q := &scripted{rows: map[string]TextRows{SEPSection.SQL: {cells(14, "x"), cells(14, "y")}}}
	rows, truncated, err := NewClinical(q).SEP(context.Background(), "2026/10/26/000123")
	if err != nil || len(rows) != 2 || truncated {
		t.Fatalf("rows %d truncated %v err %v", len(rows), truncated, err)
	}
	if s := q.sent[0]; s.query != SEPSection.SQL || s.args[0] != "2026/10/26/000123" || s.args[1] != SEPSection.Cap+1 {
		t.Errorf("sent %v", s)
	}
}
