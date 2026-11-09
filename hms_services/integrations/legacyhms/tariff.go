package legacyhms

import (
	"context"
	"fmt"
	"strings"
)

// Tariff book (ADR-SVC-005): the legacy master price tables, read-only. Each kind has one fixed statement; filters
// that do not apply are bound as '' and switch themselves off ("? = '' OR column = ?"), so only bound values vary.
// Pages follow the primary key (keyset). Purchase and base prices of drugs (`h_beli`, `dasar`) are not read.
//
// Every row starts with the same 11 head columns: code, name, category code, category name, payer code, payer name,
// place code, place name (clinic or ward), class, unit, status ('1' active). Then the kind's component columns, then
// its price columns (names in TariffKind).

// TariffKind is one legacy price table.
type TariffKind struct {
	Name       string
	Table      string
	Place      string   // "clinic", "ward" or ""
	Filters    []string // of "payer", "class", "place"
	Components []string // component names, in column order
	Prices     []string // price bases, in column order
	SQL        string
	Cols       int
}

// TariffHeadCols is the number of head columns every tariff row starts with.
const TariffHeadCols = 11

// TariffFilter is one tariff book query; "" switches a filter off.
type TariffFilter struct {
	Query, Payer, Class, Place, Status, After string
	Limit                                     int
}

type tariffSpec struct {
	name, table, code, nameCol, place string
	head                              [9]string // category code, category name, payer code, payer name, place code, place name, class, unit, status
	joins                             string
	filters                           []string
	components, prices                [][2]string // {name, column expression}
}

var procedureComponents = [][2]string{{"material", "t.`material`"}, {"bhp", "t.`bhp`"}, {"doctor_fee", "t.`tarif_tindakandr`"},
	{"nurse_fee", "t.`tarif_tindakanpr`"}, {"kso", "t.`kso`"}, {"management", "t.`menejemen`"}}
var procedurePrices = [][2]string{{"doctor", "t.`total_byrdr`"}, {"nurse", "t.`total_byrpr`"}, {"doctor_and_nurse", "t.`total_byrdrpr`"}}
var examComponents = [][2]string{{"hospital_share", "t.`bagian_rs`"}, {"bhp", "t.`bhp`"}, {"referrer_fee", "t.`tarif_perujuk`"},
	{"doctor_fee", "t.`tarif_tindakan_dokter`"}, {"staff_fee", "t.`tarif_tindakan_petugas`"}, {"kso", "t.`kso`"}, {"management", "t.`menejemen`"}}

// PackageFeeColumns are the fee columns of `paket_operasi`; their sum is the package price.
var PackageFeeColumns = []string{
	"operator1", "operator2", "operator3", "asisten_operator1", "asisten_operator2", "asisten_operator3", "instrumen",
	"dokter_anak", "perawaat_resusitas", "dokter_anestesi", "asisten_anestesi", "asisten_anestesi2", "bidan", "bidan2",
	"bidan3", "perawat_luar", "sewa_ok", "alat", "akomodasi", "bagian_rs", "omloop", "omloop2", "omloop3", "omloop4",
	"omloop5", "sarpras", "dokter_pjanak", "dokter_umum",
}

// PackagePrice is the price of a surgery package (NULL fees count as 0).
func PackagePrice(alias string) string {
	parts := make([]string, len(PackageFeeColumns))
	for i, c := range PackageFeeColumns {
		parts[i] = "IFNULL(" + alias + ".`" + c + "`,0)"
	}
	return strings.Join(parts, "+")
}

// DrugPriceColumns are the selling price columns of `databarang`, by price basis.
var DrugPriceColumns = []string{"ralan", "kelas1", "kelas2", "kelas3", "utama", "vip", "vvip", "beliluar", "jualbebas", "karyawan"}

const payerJoin = " LEFT JOIN `penjab` pj ON pj.`kd_pj` = t.`kd_pj`"

var tariffSpecs = func() []tariffSpec {
	var packageComponents [][2]string
	for _, c := range PackageFeeColumns {
		packageComponents = append(packageComponents, [2]string{c, "t.`" + c + "`"})
	}
	var drugPrices [][2]string
	for _, c := range DrugPriceColumns {
		drugPrices = append(drugPrices, [2]string{c, "t.`" + c + "`"})
	}
	return []tariffSpec{
		{"outpatient_procedure", "jns_perawatan", "kd_jenis_prw", "nm_perawatan", "clinic",
			[9]string{"t.`kd_kategori`", "kp.`nm_kategori`", "t.`kd_pj`", "pj.`png_jawab`", "t.`kd_poli`", "pl.`nm_poli`", "NULL", "NULL", "t.`status`"},
			" LEFT JOIN `kategori_perawatan` kp ON kp.`kd_kategori` = t.`kd_kategori`" + payerJoin +
				" LEFT JOIN `poliklinik` pl ON pl.`kd_poli` = t.`kd_poli`",
			[]string{"payer", "place"}, procedureComponents, procedurePrices},
		{"inpatient_procedure", "jns_perawatan_inap", "kd_jenis_prw", "nm_perawatan", "ward",
			[9]string{"t.`kd_kategori`", "kp.`nm_kategori`", "t.`kd_pj`", "pj.`png_jawab`", "t.`kd_bangsal`", "b.`nm_bangsal`", "t.`kelas`", "NULL", "t.`status`"},
			" LEFT JOIN `kategori_perawatan` kp ON kp.`kd_kategori` = t.`kd_kategori`" + payerJoin +
				" LEFT JOIN `bangsal` b ON b.`kd_bangsal` = t.`kd_bangsal`",
			[]string{"payer", "class", "place"}, procedureComponents, procedurePrices},
		{"surgery", "paket_operasi", "kode_paket", "nm_perawatan", "",
			[9]string{"t.`kategori`", "NULL", "t.`kd_pj`", "pj.`png_jawab`", "NULL", "NULL", "t.`kelas`", "NULL", "t.`status`"},
			payerJoin, []string{"payer", "class"}, packageComponents, [][2]string{{"package", PackagePrice("t")}}},
		{"drug", "databarang", "kode_brng", "nama_brng", "",
			[9]string{"t.`kdjns`", "j.`nama`", "NULL", "NULL", "NULL", "NULL", "NULL", "s.`satuan`", "t.`status`"},
			" LEFT JOIN `jenis` j ON j.`kdjns` = t.`kdjns` LEFT JOIN `kodesatuan` s ON s.`kode_sat` = t.`kode_sat`",
			nil, nil, drugPrices},
		{"laboratory", "jns_perawatan_lab", "kd_jenis_prw", "nm_perawatan", "",
			[9]string{"t.`kategori`", "NULL", "t.`kd_pj`", "pj.`png_jawab`", "NULL", "NULL", "t.`kelas`", "NULL", "t.`status`"},
			payerJoin, []string{"payer", "class"}, examComponents, [][2]string{{"total", "t.`total_byr`"}}},
		{"radiology", "jns_perawatan_radiologi", "kd_jenis_prw", "nm_perawatan", "",
			[9]string{"NULL", "NULL", "t.`kd_pj`", "pj.`png_jawab`", "NULL", "NULL", "t.`kelas`", "NULL", "t.`status`"},
			payerJoin, []string{"payer", "class"}, examComponents, [][2]string{{"total", "t.`total_byr`"}}},
	}
}()

// filterColumn is the column a filter compares, per kind.
func (s tariffSpec) filterColumn(f string) string {
	switch f {
	case "payer":
		return "t.`kd_pj`"
	case "class":
		return "t.`kelas`"
	case "place":
		if s.place == "clinic" {
			return "t.`kd_poli`"
		}
		return "t.`kd_bangsal`"
	}
	return ""
}

func text(expr string) string {
	if expr == "NULL" {
		return expr
	}
	return "CAST(" + expr + " AS CHAR)"
}

// TariffKinds are the tariff tables, in display order.
var TariffKinds = func() []TariffKind {
	var out []TariffKind
	for _, s := range tariffSpecs {
		cols := []string{"t.`" + s.code + "`", "t.`" + s.nameCol + "`"}
		for _, h := range s.head {
			cols = append(cols, text(h))
		}
		k := TariffKind{Name: s.name, Table: s.table, Place: s.place, Filters: s.filters}
		for _, c := range s.components {
			cols = append(cols, money(c[1]))
			k.Components = append(k.Components, c[0])
		}
		for _, p := range s.prices {
			cols = append(cols, money(p[1]))
			k.Prices = append(k.Prices, p[0])
		}
		where := []string{"(? = '' OR t.`" + s.nameCol + "` LIKE ? ESCAPE '!' OR t.`" + s.code + "` LIKE ? ESCAPE '!')"}
		for _, f := range s.filters {
			where = append(where, "(? = '' OR "+s.filterColumn(f)+" = ?)")
		}
		where = append(where, "(? = '' OR t.`status` = ?)", "t.`"+s.code+"` > ?")
		k.SQL = "SELECT " + strings.Join(cols, ", ") + " FROM `" + s.table + "` t" + s.joins + " WHERE " +
			strings.Join(where, " AND ") + " ORDER BY t.`" + s.code + "` LIMIT ?"
		k.Cols = len(cols)
		out = append(out, k)
	}
	return out
}()

// TariffKindNamed returns the kind with that name.
func TariffKindNamed(name string) (TariffKind, bool) {
	for _, k := range TariffKinds {
		if k.Name == name {
			return k, true
		}
	}
	return TariffKind{}, false
}

// LabItemComponents are the component columns of a priced laboratory item, in column order.
var LabItemComponents = []string{"hospital_share", "bhp", "referrer_fee", "doctor_fee", "lab_fee", "kso", "management"}

// TariffLabItems lists the result items of one laboratory test with their own price (`template_laboratorium`):
// id, name, unit, the LabItemComponents, price.
var TariffLabItems = Section{"tariff_lab_items", "SELECT CAST(tl.`id_template` AS CHAR), tl.`Pemeriksaan`, tl.`satuan`, " +
	money("tl.`bagian_rs`") + ", " + money("tl.`bhp`") + ", " + money("tl.`bagian_perujuk`") + ", " + money("tl.`bagian_dokter`") +
	", " + money("tl.`bagian_laborat`") + ", " + money("tl.`kso`") + ", " + money("tl.`menejemen`") + ", " + money("tl.`biaya_item`") +
	" FROM `template_laboratorium` tl WHERE tl.`kd_jenis_prw` = ? ORDER BY tl.`urut`, tl.`id_template` LIMIT ?", 11, 500}

// TariffStatements lists every tariff book statement (for the allowlist test).
func TariffStatements() []string {
	out := []string{TariffLabItems.SQL}
	for _, k := range TariffKinds {
		out = append(out, k.SQL)
	}
	return out
}

// Tariff reads the legacy price tables.
type Tariff struct{ db RowsQuerier }

func NewTariff(db RowsQuerier) *Tariff { return &Tariff{db: db} }

func (t *Tariff) query(ctx context.Context, name, q string, cols int, args ...any) (TextRows, error) {
	rows, err := t.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	defer rows.Close()
	var out TextRows
	for rows.Next() {
		vals := make([]*string, cols)
		dest := make([]any, cols)
		for i := range vals {
			dest[i] = &vals[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		out = append(out, vals)
	}
	return out, rows.Err()
}

// List returns one page of a tariff kind, ordered by code, after f.After. f.Status: "active", "inactive" or "".
func (t *Tariff) List(ctx context.Context, k TariffKind, f TariffFilter) (TextRows, error) {
	like := ""
	if f.Query != "" {
		like = "%" + LikeEscape(f.Query) + "%"
	}
	args := []any{f.Query, like, like}
	for _, name := range k.Filters {
		v := map[string]string{"payer": f.Payer, "class": f.Class, "place": f.Place}[name]
		args = append(args, v, v)
	}
	status := map[string]string{"active": "1", "inactive": "0"}[f.Status]
	args = append(args, status, status, f.After, f.Limit)
	return t.query(ctx, k.Name, k.SQL, k.Cols, args...)
}

// LabItems returns the result items of one laboratory test.
func (t *Tariff) LabItems(ctx context.Context, code string) (TextRows, bool, error) {
	rows, err := t.query(ctx, TariffLabItems.Name, TariffLabItems.SQL, TariffLabItems.Cols, code, TariffLabItems.Cap+1)
	if err != nil {
		return nil, false, err
	}
	if len(rows) > TariffLabItems.Cap {
		return rows[:TariffLabItems.Cap], true, nil
	}
	return rows, false, nil
}
