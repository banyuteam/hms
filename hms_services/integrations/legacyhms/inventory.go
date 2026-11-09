package legacyhms

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Schema inventory of the legacy HMS (metadata only). It reads information_schema for the configured schema: tables
// whose name matches a LIKE pattern, their columns, indexes and declared foreign keys, plus the server's approximate row
// count. It never reads a row of the tables themselves, so it carries no patient data. The output is the legacy schema
// inventory that hms_database owns (hms_database/legacy/schema-inventory/).

type InventoryColumn struct {
	Name, Type, Nullable, Key, Default, Comment string
}

type InventoryIndex struct {
	Name    string
	Unique  bool
	Columns []string
}

type InventoryForeignKey struct {
	Column, RefTable, RefColumn string
}

type InventoryTable struct {
	Name, Engine, Comment string
	ApproxRows            string // information_schema.TABLES.TABLE_ROWS (an estimate for InnoDB)
	Columns               []InventoryColumn
	Indexes               []InventoryIndex
	ForeignKeys           []InventoryForeignKey
}

type Inventory struct {
	Schema, ServerVersion string
	Patterns              []string
	Tables                []InventoryTable
}

// InventoryStatements are the fixed metadata statements (allowlist and tests). `?` is one LIKE pattern.
var InventoryStatements = struct{ Server, Tables, Columns, Indexes, ForeignKeys string }{
	Server: "SELECT DATABASE(), VERSION()",
	Tables: "SELECT TABLE_NAME, ENGINE, CAST(TABLE_ROWS AS CHAR), TABLE_COMMENT FROM information_schema.TABLES " +
		"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE ? ORDER BY TABLE_NAME",
	Columns: "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT " +
		"FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ? " +
		"ORDER BY TABLE_NAME, ORDINAL_POSITION",
	Indexes: "SELECT TABLE_NAME, INDEX_NAME, CAST(NON_UNIQUE AS CHAR), COLUMN_NAME FROM information_schema.STATISTICS " +
		"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
	ForeignKeys: "SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME " +
		"FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ? " +
		"AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, COLUMN_NAME",
}

// ReadInventory collects the metadata of every table matching one of patterns (SQL LIKE, e.g. `bridging\_%`).
func ReadInventory(ctx context.Context, q RowsQuerier, patterns []string) (Inventory, error) {
	inv := Inventory{Patterns: patterns}
	var schema, version *string
	if err := q.QueryRow(ctx, InventoryStatements.Server).Scan(&schema, &version); err != nil {
		return inv, fmt.Errorf("legacy server: %w", err)
	}
	inv.Schema, inv.ServerVersion = deref(schema), deref(version)

	tables := map[string]*InventoryTable{}
	read := func(stmt, pattern string, n int, each func([]*string)) error {
		rows, err := q.Query(ctx, stmt, pattern)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			vals := make([]*string, n)
			dest := make([]any, n)
			for i := range vals {
				dest[i] = &vals[i]
			}
			if err := rows.Scan(dest...); err != nil {
				return err
			}
			each(vals)
		}
		return rows.Err()
	}
	for _, p := range patterns {
		if err := read(InventoryStatements.Tables, p, 4, func(v []*string) {
			name := deref(v[0])
			if tables[name] == nil {
				tables[name] = &InventoryTable{Name: name, Engine: deref(v[1]), ApproxRows: deref(v[2]), Comment: deref(v[3])}
			}
		}); err != nil {
			return inv, fmt.Errorf("tables %q: %w", p, err)
		}
	}
	// Columns, indexes and keys are read per pattern too; a table matched twice is filled once.
	filled := map[string]bool{}
	for _, p := range patterns {
		seen := map[string]bool{}
		if err := read(InventoryStatements.Columns, p, 7, func(v []*string) {
			t := tables[deref(v[0])]
			if t == nil || filled[t.Name] {
				return
			}
			seen[t.Name] = true
			t.Columns = append(t.Columns, InventoryColumn{Name: deref(v[1]), Type: deref(v[2]), Nullable: deref(v[3]),
				Key: deref(v[4]), Default: optText(v[5]), Comment: deref(v[6])})
		}); err != nil {
			return inv, fmt.Errorf("columns %q: %w", p, err)
		}
		if err := read(InventoryStatements.Indexes, p, 4, func(v []*string) {
			t := tables[deref(v[0])]
			if t == nil || filled[t.Name] {
				return
			}
			name := deref(v[1])
			if n := len(t.Indexes); n > 0 && t.Indexes[n-1].Name == name {
				t.Indexes[n-1].Columns = append(t.Indexes[n-1].Columns, deref(v[3]))
				return
			}
			t.Indexes = append(t.Indexes, InventoryIndex{Name: name, Unique: deref(v[2]) == "0", Columns: []string{deref(v[3])}})
		}); err != nil {
			return inv, fmt.Errorf("indexes %q: %w", p, err)
		}
		if err := read(InventoryStatements.ForeignKeys, p, 4, func(v []*string) {
			t := tables[deref(v[0])]
			if t == nil || filled[t.Name] {
				return
			}
			t.ForeignKeys = append(t.ForeignKeys, InventoryForeignKey{Column: deref(v[1]), RefTable: deref(v[2]), RefColumn: deref(v[3])})
		}); err != nil {
			return inv, fmt.Errorf("foreign keys %q: %w", p, err)
		}
		for name := range seen {
			filled[name] = true
		}
	}
	for _, t := range tables {
		inv.Tables = append(inv.Tables, *t)
	}
	sort.Slice(inv.Tables, func(i, j int) bool { return inv.Tables[i].Name < inv.Tables[j].Name })
	return inv, nil
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// optText is a column default as the server reports it. MariaDB already returns SQL literals (`NULL`, `”`, `'x'`);
// MySQL returns the bare value or NULL (no default), shown as "—".
func optText(v *string) string {
	if v == nil {
		return "—"
	}
	return *v
}

// Markdown renders the inventory as the document kept in hms_database/legacy/schema-inventory/.
func (inv Inventory) Markdown(title string, at time.Time) string {
	var b strings.Builder
	cell := func(s string) string { return strings.NewReplacer("|", `\|`, "\n", " ", "\r", "").Replace(s) }
	fmt.Fprintf(&b, "# %s\n\n", title)
	fmt.Fprintf(&b, "Generated by `hms-services inventory-legacy-schema` on %s from `information_schema` of schema `%s` "+
		"(server %s). Metadata only: no table rows were read. Patterns: %s. Approximate rows are the server's estimate.\n\n",
		at.UTC().Format("2006-01-02 15:04 UTC"), cell(inv.Schema), cell(inv.ServerVersion), "`"+strings.Join(inv.Patterns, "`, `")+"`")
	fmt.Fprintf(&b, "## Tables (%d)\n\n| Table | Columns | Approx. rows | Primary key | Engine |\n|---|---|---|---|---|\n", len(inv.Tables))
	for _, t := range inv.Tables {
		pk := ""
		for _, ix := range t.Indexes {
			if ix.Name == "PRIMARY" {
				pk = strings.Join(ix.Columns, ", ")
			}
		}
		fmt.Fprintf(&b, "| [`%s`](#%s) | %d | %s | %s | %s |\n", t.Name, t.Name, len(t.Columns), cell(t.ApproxRows), cell(pk), cell(t.Engine))
	}
	for _, t := range inv.Tables {
		fmt.Fprintf(&b, "\n## %s\n\n", t.Name)
		if t.Comment != "" {
			fmt.Fprintf(&b, "%s\n\n", cell(t.Comment))
		}
		b.WriteString("| # | Column | Type | Null | Key | Default | Comment |\n|---|---|---|---|---|---|---|\n")
		for i, c := range t.Columns {
			fmt.Fprintf(&b, "| %d | `%s` | %s | %s | %s | %s | %s |\n", i+1, c.Name, cell(c.Type), c.Nullable, c.Key, cell(c.Default), cell(c.Comment))
		}
		if len(t.Indexes) > 0 {
			b.WriteString("\nIndexes: ")
			parts := make([]string, 0, len(t.Indexes))
			for _, ix := range t.Indexes {
				kind := ""
				if ix.Unique {
					kind = " unique"
				}
				parts = append(parts, fmt.Sprintf("`%s`%s (%s)", ix.Name, kind, strings.Join(ix.Columns, ", ")))
			}
			b.WriteString(strings.Join(parts, "; ") + "\n")
		}
		if len(t.ForeignKeys) > 0 {
			b.WriteString("\nForeign keys: ")
			parts := make([]string, 0, len(t.ForeignKeys))
			for _, fk := range t.ForeignKeys {
				parts = append(parts, fmt.Sprintf("`%s` → `%s.%s`", fk.Column, fk.RefTable, fk.RefColumn))
			}
			b.WriteString(strings.Join(parts, "; ") + "\n")
		}
	}
	return b.String()
}
