package legacyhms

import (
	"context"
	"fmt"
)

// Reconciliation of the bill against the cashier's saved bill (`billing`), for the owner-run check only: it reads
// recent saved bills and compares, per legacy billing category, the saved amount with the bill's own subtotal (the
// caller maps the bill) and with alternative formulas where the legacy one is uncertain. Nothing here is served by the
// API.

// ReconcileAlternative is another way of computing a legacy billing category; each part returns one amount.
type ReconcileAlternative struct {
	LegacyCategory string
	Name           string
	Parts          []string
}

func reconcileSum(table, alias, expr string) string {
	return "SELECT CAST(IFNULL(SUM(CAST(" + expr + " AS DECIMAL(18,2))),0) AS CHAR) FROM `" + table + "` " + alias +
		" WHERE " + alias + ".`no_rawat` = ?"
}

// ReconcileAlternatives are compared next to the bill's own formula.
var ReconcileAlternatives = []ReconcileAlternative{
	{"Kamar", "kamar_inap.trf_kamar*lama", []string{reconcileSum("kamar_inap", "ki", "ki.`trf_kamar`*ki.`lama`")}},
	{"Obat", "detail_pemberian_obat.biaya_obat*jml", []string{reconcileSum("detail_pemberian_obat", "m", "m.`biaya_obat`*m.`jml`")}},
	{"Laborat", "periksa_lab.biaya only", []string{reconcileSum("periksa_lab", "t", "t.`biaya`")}},
	{"Resep Pulang", "resep_pulang.harga*jml_barang", []string{reconcileSum("resep_pulang", "x", "x.`harga`*x.`jml_barang`")}},
	{"Potongan", "pengurangan_biaya as a positive amount", []string{reconcileSum("pengurangan_biaya", "p", "p.`besar_pengurangan`")}},
}

// Reconcile statements outside the alternatives.
const (
	ReconcileSampleInpatient  = "SELECT n.`no_rawat` FROM `nota_inap` n ORDER BY n.`tanggal` DESC, n.`no_rawat` DESC LIMIT ?"
	ReconcileSampleOutpatient = "SELECT n.`no_rawat` FROM `nota_jalan` n ORDER BY n.`tanggal` DESC, n.`no_rawat` DESC LIMIT ?"
	// Saved bill per category (item, subtotal and total lines alike; the caller tells them apart by category).
	ReconcileSaved = "SELECT CAST(b.`status` AS CHAR), CAST(IFNULL(SUM(CAST(b.`totalbiaya` AS DECIMAL(18,2))),0) AS CHAR) " +
		"FROM `billing` b WHERE b.`no_rawat` = ? GROUP BY b.`status` LIMIT 100"
	// Visits billed together (mother and baby): their saved bill also holds the other visit's charges.
	ReconcileMerged = "SELECT CAST(COUNT(*) AS CHAR) FROM `ranap_gabung` g WHERE g.`no_rawat` = ? OR g.`no_rawat2` = ?"
)

// ReconcileStatements lists every statement the reconciliation check sends besides the bill's own (for the allowlist
// test).
func ReconcileStatements() []string {
	out := []string{ReconcileSampleInpatient, ReconcileSampleOutpatient, ReconcileSaved, ReconcileMerged}
	for _, v := range ReconcileAlternatives {
		out = append(out, v.Parts...)
	}
	return out
}

// Reconciler runs the reconciliation statements.
type Reconciler struct{ db RowsQuerier }

func NewReconciler(db RowsQuerier) *Reconciler { return &Reconciler{db: db} }

// texts runs a statement returning one or two text columns.
func (r *Reconciler) texts(ctx context.Context, cols int, q string, args ...any) ([][2]string, error) {
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][2]string
	for rows.Next() {
		var a, b *string
		dest := []any{&a, &b}[:cols]
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		var pair [2]string
		if a != nil {
			pair[0] = *a
		}
		if b != nil {
			pair[1] = *b
		}
		out = append(out, pair)
	}
	return out, rows.Err()
}

// Sample returns the encounter numbers of the most recent saved inpatient or outpatient bills.
func (r *Reconciler) Sample(ctx context.Context, inpatient bool, limit int) ([]string, error) {
	q := ReconcileSampleOutpatient
	if inpatient {
		q = ReconcileSampleInpatient
	}
	rows, err := r.texts(ctx, 1, q, limit)
	if err != nil {
		return nil, fmt.Errorf("sample: %w", err)
	}
	out := make([]string, len(rows))
	for i, row := range rows {
		out[i] = row[0]
	}
	return out, nil
}

// Saved returns the saved bill amount per legacy category.
func (r *Reconciler) Saved(ctx context.Context, number string) (map[string]string, error) {
	rows, err := r.texts(ctx, 2, ReconcileSaved, number)
	if err != nil {
		return nil, fmt.Errorf("saved bill: %w", err)
	}
	out := map[string]string{}
	for _, row := range rows {
		out[row[0]] = row[1]
	}
	return out, nil
}

// Amounts returns the amount of each part of an alternative.
func (r *Reconciler) Amounts(ctx context.Context, v ReconcileAlternative, number string) ([]string, error) {
	out := make([]string, len(v.Parts))
	for i, q := range v.Parts {
		rows, err := r.texts(ctx, 1, q, number)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", v.Name, err)
		}
		if len(rows) == 1 {
			out[i] = rows[0][0]
		}
	}
	return out, nil
}

// Merged reports whether the visit is billed together with another visit.
func (r *Reconciler) Merged(ctx context.Context, number string) (bool, error) {
	rows, err := r.texts(ctx, 1, ReconcileMerged, number, number)
	if err != nil {
		return false, fmt.Errorf("merged visits: %w", err)
	}
	return len(rows) == 1 && rows[0][0] != "0", nil
}
