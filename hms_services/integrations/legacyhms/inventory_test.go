package legacyhms

import (
	"context"
	"strings"
	"testing"
	"time"
)

// metaRow answers the server statement.
type metaRow struct{ vals []*string }

func (r metaRow) Scan(dest ...any) error {
	for i, d := range dest {
		*(d.(**string)) = r.vals[i]
	}
	return nil
}

// metadata is a scripted information_schema; it records every statement and argument.
type metadata struct {
	rows map[string]map[string]TextRows // statement → pattern → rows
	sent []capture
}

func (m *metadata) QueryRow(_ context.Context, q string, args ...any) Row {
	m.sent = append(m.sent, capture{q, args})
	return metaRow{vals: []*string{str("rsb_dev"), str("10.6.18-MariaDB")}}
}

func (m *metadata) Query(_ context.Context, q string, args ...any) (Rows, error) {
	m.sent = append(m.sent, capture{q, args})
	return &textRows{rows: m.rows[q][args[0].(string)]}, nil
}

func str(s string) *string { return &s }

func row4(a, b, c, d *string) []*string { return []*string{a, b, c, d} }

func TestInventoryReadsMetadataOnly(t *testing.T) {
	st := InventoryStatements
	m := &metadata{rows: map[string]map[string]TextRows{
		st.Tables: {
			`bridging\_%`: {row4(str("bridging_sep"), str("InnoDB"), str("120000"), str(""))},
			`%sep%`:       {row4(str("bridging_sep"), str("InnoDB"), str("120000"), str(""))},
		},
		st.Columns: {
			`bridging\_%`: {
				{str("bridging_sep"), str("no_sep"), str("varchar(40)"), str("NO"), str("PRI"), nil, str("")},
				{str("bridging_sep"), str("no_rawat"), str("varchar(17)"), str("YES"), str("MUL"), str("NULL"), str("a|b")},
			},
			`%sep%`: {
				{str("bridging_sep"), str("no_sep"), str("varchar(40)"), str("NO"), str("PRI"), nil, str("")},
			},
		},
		st.Indexes: {
			`bridging\_%`: {
				row4(str("bridging_sep"), str("PRIMARY"), str("0"), str("no_sep")),
				row4(str("bridging_sep"), str("no_rawat"), str("1"), str("no_rawat")),
			},
		},
		st.ForeignKeys: {
			`bridging\_%`: {row4(str("bridging_sep"), str("no_rawat"), str("reg_periksa"), str("no_rawat"))},
		},
	}}
	inv, err := ReadInventory(context.Background(), m, []string{`bridging\_%`, `%sep%`})
	if err != nil {
		t.Fatal(err)
	}
	if inv.Schema != "rsb_dev" || len(inv.Tables) != 1 {
		t.Fatalf("inventory %+v", inv)
	}
	tb := inv.Tables[0]
	if len(tb.Columns) != 2 || tb.Columns[0].Default != "—" || tb.Columns[1].Default != "NULL" ||
		len(tb.Indexes) != 2 || !tb.Indexes[0].Unique || tb.Indexes[1].Unique || len(tb.ForeignKeys) != 1 {
		t.Errorf("a table matched by two patterns is filled once: %+v", tb)
	}
	for _, c := range m.sent {
		if !strings.HasPrefix(c.query, "SELECT ") || (c.query != st.Server && !strings.Contains(c.query, "information_schema.")) {
			t.Errorf("only metadata statements may run: %s", c.query)
		}
		if strings.Contains(c.query, "FROM `") {
			t.Errorf("a table's rows were read: %s", c.query)
		}
	}
	md := inv.Markdown("BPJS bridging tables", time.Date(2026, 11, 9, 7, 0, 0, 0, time.UTC))
	for _, want := range []string{"# BPJS bridging tables", "2026-11-09 07:00 UTC", "schema `rsb_dev`", "| [`bridging_sep`](#bridging_sep) | 2 | 120000 | no_sep | InnoDB |",
		"| 2 | `no_rawat` | varchar(17) | YES | MUL | NULL | a\\|b |", "`PRIMARY` unique (no_sep)", "`no_rawat` → `reg_periksa.no_rawat`"} {
		if !strings.Contains(md, want) {
			t.Errorf("markdown lacks %q:\n%s", want, md)
		}
	}
}
