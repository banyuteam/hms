package legacyhms

import (
	"context"
	"fmt"
	"strings"
)

// Visit bill (ADR-SVC-004, amended 2026-11-08): the charges are aggregated from the tables where the legacy HMS records
// each service with its cost, the way its own billing screen collects them at discharge. The cashier's `billing` table
// is not read here (only by the reconciliation check). Amounts are summed as DECIMAL(18,2) in SQL, so no floating-point
// error enters the totals. Every charge section returns the same six columns:
// code, label, quantity, unit price, additional (embalase + tuslah for drugs), amount.
// Discounts and drug returns are negative amounts. The service fee is not stored: it is computed from the subtotals
// and the legacy service settings (package clinical).

// sumMoney sums a column exactly as DECIMAL(18,2).
func sumMoney(expr string) string { return "CAST(SUM(CAST(" + expr + " AS DECIMAL(18,2))) AS CHAR)" }

// ChargeSection is one source of charges and the legacy billing category it belongs to.
type ChargeSection struct {
	Section
	Category       string // HMS category (contract)
	LegacyCategory string // `billing.status` the legacy HMS files these charges under
	// Tariff tells where today's tariff of a line is (ADR-SVC-005): "" none, TariffSingle in column 6,
	// TariffDrugClass in columns 6.. (DrugClassColumns; the caller picks the price for the visit's class).
	Tariff string
}

const (
	TariffSingle    = "single"
	TariffDrugClass = "drug_class"
)

// DrugClassColumns are the `databarang` prices a bill line can be compared with: outpatient, then by room class.
var DrugClassColumns = []string{"ralan", "kelas1", "kelas2", "kelas3", "utama", "vip", "vvip"}

func drugClassTariff(alias string) (cols, group string) {
	var c []string
	for _, col := range DrugClassColumns {
		c = append(c, alias+".`"+col+"`")
	}
	g := strings.Join(c, ", ")
	for i := range c {
		c[i] = money(c[i])
	}
	return strings.Join(c, ", "), g
}

// surgeryCostColumns are the fee columns of `operasi` that make up the cost of one operation.
var surgeryCostColumns = []string{
	"biayaoperator1", "biayaoperator2", "biayaoperator3", "biayaasisten_operator1", "biayaasisten_operator2",
	"biayaasisten_operator3", "biayainstrumen", "biayadokter_anak", "biayaperawaat_resusitas", "biayadokter_anestesi",
	"biayaasisten_anestesi", "biayaasisten_anestesi2", "biayabidan", "biayabidan2", "biayabidan3", "biayaperawat_luar",
	"biayaalat", "biayasewaok", "akomodasi", "bagian_rs", "biaya_omloop", "biaya_omloop2", "biaya_omloop3", "biaya_omloop4",
	"biaya_omloop5", "biayasarpras", "biaya_dokter_pjanak", "biaya_dokter_umum",
}

// SurgeryCost is the cost of one operation (NULL fees count as 0).
func SurgeryCost(alias string) string {
	parts := make([]string, len(surgeryCostColumns))
	for i, c := range surgeryCostColumns {
		parts[i] = "IFNULL(" + alias + ".`" + c + "`,0)"
	}
	return strings.Join(parts, "+")
}

var procedureCategories = map[string][2]string{
	"rawat_jl_dr":     {"outpatient_doctor", "Ralan Dokter"},
	"rawat_jl_pr":     {"outpatient_nurse", "Ralan Paramedis"},
	"rawat_jl_drpr":   {"outpatient_doctor_nurse", "Ralan Dokter Paramedis"},
	"rawat_inap_dr":   {"inpatient_doctor", "Ranap Dokter"},
	"rawat_inap_pr":   {"inpatient_nurse", "Ranap Paramedis"},
	"rawat_inap_drpr": {"inpatient_doctor_nurse", "Ranap Dokter Paramedis"},
}

// procedureTariff is the tariff column of a procedure, by who performed it.
var procedureTariff = map[string]string{"doctor": "total_byrdr", "nurse": "total_byrpr", "doctor_and_nurse": "total_byrdrpr"}

// ChargeSections are read in this order, which is also the order of the bill. Grouping by code, name and unit price
// matches the legacy billing screen (one line per service and price, with the count as quantity). Today's tariff
// comes from the item table already joined for the name (a primary-key lookup, grouped with it).
var ChargeSections = func() []ChargeSection {
	s := []ChargeSection{
		{Section{"charge_registration", "SELECT r.`kd_poli`, pl.`nm_poli`, '1', " + money("r.`biaya_reg`") + ", '0.00', " +
			money("r.`biaya_reg`") + " FROM `reg_periksa` r LEFT JOIN `poliklinik` pl ON pl.`kd_poli` = r.`kd_poli` " +
			"WHERE r.`no_rawat` = ? AND r.`biaya_reg` <> 0 LIMIT 1", 6, 1}, "registration", "Registrasi", ""},
		{Section{"charge_room", "SELECT ki.`kd_kamar`, b.`nm_bangsal`, " + sumMoney("ki.`lama`") + ", " +
			money("ki.`trf_kamar`") + ", '0.00', " + sumMoney("ki.`ttl_biaya`") + " FROM `kamar_inap` ki " +
			"LEFT JOIN `kamar` k ON k.`kd_kamar` = ki.`kd_kamar` LEFT JOIN `bangsal` b ON b.`kd_bangsal` = k.`kd_bangsal` " +
			"WHERE ki.`no_rawat` = ? GROUP BY ki.`kd_kamar`, b.`nm_bangsal`, ki.`trf_kamar` " +
			"ORDER BY MIN(ki.`tgl_masuk`), ki.`kd_kamar` LIMIT ?", 6, 200}, "room", "Kamar", ""},
	}
	for _, p := range ProcedureSources {
		cat := procedureCategories[p.Table]
		tariff := "j.`" + procedureTariff[p.PerformedBy] + "`"
		s = append(s, ChargeSection{Section{"charge_" + p.Table, "SELECT t.`kd_jenis_prw`, j.`nm_perawatan`, " +
			"CAST(COUNT(*) AS CHAR), " + money("t.`biaya_rawat`") + ", '0.00', " + sumMoney("t.`biaya_rawat`") + ", " + money(tariff) +
			" FROM `" + p.Table + "` t LEFT JOIN `" + p.ItemTable + "` j ON j.`kd_jenis_prw` = t.`kd_jenis_prw` " +
			"WHERE t.`no_rawat` = ? GROUP BY t.`kd_jenis_prw`, j.`nm_perawatan`, t.`biaya_rawat`, " + tariff + " " +
			"ORDER BY MIN(t.`tgl_perawatan`), t.`kd_jenis_prw` LIMIT ?", 7, 2000}, cat[0], cat[1], TariffSingle})
	}
	drugCols, drugGroup := drugClassTariff("b")
	return append(s,
		ChargeSection{Section{"charge_surgery", "SELECT o.`kode_paket`, p.`nm_perawatan`, '1', " + money(SurgeryCost("o")) +
			", '0.00', " + money(SurgeryCost("o")) + ", " + money(PackagePrice("p")) + " FROM `operasi` o " +
			"LEFT JOIN `paket_operasi` p ON p.`kode_paket` = o.`kode_paket` " +
			"WHERE o.`no_rawat` = ? ORDER BY o.`tgl_operasi`, o.`kode_paket` LIMIT ?", 7, 200}, "surgery", "Operasi", TariffSingle},
		ChargeSection{Section{"charge_lab_test", "SELECT t.`kd_jenis_prw`, j.`nm_perawatan`, CAST(COUNT(*) AS CHAR), " +
			money("t.`biaya`") + ", '0.00', " + sumMoney("t.`biaya`") + ", " + money("j.`total_byr`") + " FROM `periksa_lab` t " +
			"LEFT JOIN `jns_perawatan_lab` j ON j.`kd_jenis_prw` = t.`kd_jenis_prw` WHERE t.`no_rawat` = ? " +
			"GROUP BY t.`kd_jenis_prw`, j.`nm_perawatan`, t.`biaya`, j.`total_byr` " +
			"ORDER BY MIN(t.`tgl_periksa`), t.`kd_jenis_prw` LIMIT ?", 7, 2000}, "laboratory", "Laborat", TariffSingle},
		// Result items carry their own price only when the test is priced per item; free items are not bill lines.
		ChargeSection{Section{"charge_lab_item", "SELECT CAST(r.`id_template` AS CHAR), tl.`Pemeriksaan`, CAST(COUNT(*) AS CHAR), " +
			money("r.`biaya_item`") + ", '0.00', " + sumMoney("r.`biaya_item`") + ", " + money("tl.`biaya_item`") +
			" FROM `detail_periksa_lab` r LEFT JOIN `template_laboratorium` tl ON tl.`id_template` = r.`id_template` " +
			"WHERE r.`no_rawat` = ? AND r.`biaya_item` <> 0 GROUP BY r.`id_template`, tl.`Pemeriksaan`, r.`biaya_item`, tl.`biaya_item` " +
			"ORDER BY MIN(r.`tgl_periksa`), r.`id_template` LIMIT ?", 7, 5000}, "laboratory", "Laborat", TariffSingle},
		ChargeSection{Section{"charge_radiology", "SELECT t.`kd_jenis_prw`, j.`nm_perawatan`, CAST(COUNT(*) AS CHAR), " +
			money("t.`biaya`") + ", '0.00', " + sumMoney("t.`biaya`") + ", " + money("j.`total_byr`") + " FROM `periksa_radiologi` t " +
			"LEFT JOIN `jns_perawatan_radiologi` j ON j.`kd_jenis_prw` = t.`kd_jenis_prw` WHERE t.`no_rawat` = ? " +
			"GROUP BY t.`kd_jenis_prw`, j.`nm_perawatan`, t.`biaya`, j.`total_byr` " +
			"ORDER BY MIN(t.`tgl_periksa`), t.`kd_jenis_prw` LIMIT ?", 7, 2000}, "radiology", "Radiologi", TariffSingle},
		ChargeSection{Section{"charge_medication", "SELECT m.`kode_brng`, b.`nama_brng`, " + sumMoney("m.`jml`") + ", " +
			money("m.`biaya_obat`") + ", " + sumMoney("IFNULL(m.`embalase`,0)+IFNULL(m.`tuslah`,0)") + ", " + sumMoney("m.`total`") +
			", " + drugCols + " FROM `detail_pemberian_obat` m LEFT JOIN `databarang` b ON b.`kode_brng` = m.`kode_brng` " +
			"WHERE m.`no_rawat` = ? GROUP BY m.`kode_brng`, b.`nama_brng`, m.`biaya_obat`, " + drugGroup + " " +
			"ORDER BY MIN(m.`tgl_perawatan`), m.`kode_brng` LIMIT ?", 6 + len(DrugClassColumns), 5000}, "medication", "Obat", TariffDrugClass},
		ChargeSection{Section{"charge_take_home", "SELECT x.`kode_brng`, b.`nama_brng`, " + sumMoney("x.`jml_barang`") + ", " +
			money("x.`harga`") + ", '0.00', " + sumMoney("x.`total`") + ", " + drugCols + " FROM `resep_pulang` x " +
			"LEFT JOIN `databarang` b ON b.`kode_brng` = x.`kode_brng` WHERE x.`no_rawat` = ? " +
			"GROUP BY x.`kode_brng`, b.`nama_brng`, x.`harga`, " + drugGroup + " ORDER BY MIN(x.`tanggal`), x.`kode_brng` LIMIT ?",
			6 + len(DrugClassColumns), 2000}, "take_home_medication", "Resep Pulang", TariffDrugClass},
		// A return has no price of its own: it is priced at what the patient was charged for that drug, batch and
		// invoice (no such issue = no price, and the line is shown without an amount). Negative: it reduces the bill.
		ChargeSection{Section{"charge_return", "SELECT x.`kode_brng`, b.`nama_brng`, " + money("-x.`jml`") + ", " +
			money("MAX(d.`biaya_obat`)") + ", '0.00', " + money("-x.`jml`*MAX(d.`biaya_obat`)") + " FROM `returpasien` x " +
			"LEFT JOIN `detail_pemberian_obat` d ON d.`no_rawat` = x.`no_rawat` AND d.`kode_brng` = x.`kode_brng` " +
			"AND d.`no_batch` = x.`no_batch` AND d.`no_faktur` = x.`no_faktur` LEFT JOIN `databarang` b ON b.`kode_brng` = x.`kode_brng` " +
			"WHERE x.`no_rawat` = ? GROUP BY x.`tanggal`, x.`kode_brng`, x.`no_batch`, x.`no_faktur`, x.`jml`, b.`nama_brng` " +
			"ORDER BY x.`tanggal`, x.`kode_brng` LIMIT ?", 6, 500}, "medication_return", "Retur Obat", ""},
		ChargeSection{Section{"charge_extra", "SELECT '', t.`nama_biaya`, '1', " + money("t.`besar_biaya`") + ", '0.00', " +
			money("t.`besar_biaya`") + " FROM `tambahan_biaya` t WHERE t.`no_rawat` = ? ORDER BY t.`nama_biaya` LIMIT ?", 6, 200},
			"extra_charge", "Tambahan", ""},
		ChargeSection{Section{"charge_discount", "SELECT '', p.`nama_pengurangan`, '1', " + money("-IFNULL(p.`besar_pengurangan`,0)") +
			", '0.00', " + money("-IFNULL(p.`besar_pengurangan`,0)") + " FROM `pengurangan_biaya` p WHERE p.`no_rawat` = ? " +
			"ORDER BY p.`nama_pengurangan` LIMIT ?", 6, 200}, "discount", "Potongan", ""},
	)
}()

// VisitClass is the class of the visit's latest room (it decides which drug price a bill line is compared with).
var VisitClass = Section{"visit_class", "SELECT CAST(k.`kelas` AS CHAR) FROM `kamar_inap` ki " +
	"LEFT JOIN `kamar` k ON k.`kd_kamar` = ki.`kd_kamar` WHERE ki.`no_rawat` = ? " +
	"ORDER BY ki.`tgl_masuk` DESC, ki.`jam_masuk` DESC LIMIT 1", 1, 1}

// ServiceFlagColumns are the category switches of a service setting, in column order after nama_service and besar.
var ServiceFlagColumns = []string{"laborat", "radiologi", "operasi", "obat", "ranap_dokter", "ranap_paramedis",
	"ralan_dokter", "ralan_paramedis", "tambahan", "potongan", "kamar", "registrasi", "harian", "retur_Obat", "resep_Pulang"}

func serviceSettingsSQL(table string) string {
	cols := make([]string, len(ServiceFlagColumns))
	for i, c := range ServiceFlagColumns {
		cols[i] = "CAST(s.`" + c + "` AS CHAR)"
	}
	return "SELECT s.`nama_service`, CAST(s.`besar` AS CHAR), " + strings.Join(cols, ", ") + " FROM `" + table +
		"` s ORDER BY s.`nama_service` LIMIT 21"
}

// ServiceSettings are the legacy inpatient service fee settings (not per visit): for patients paying themselves and
// for receivable payers (insurers, BPJS). Each row: name, percentage, then ServiceFlagColumns as Yes/No.
var ServiceSettings = []Section{
	{"service_settings_cash", serviceSettingsSQL("set_service_ranap"), 2 + len(ServiceFlagColumns), 20},
	{"service_settings_receivable", serviceSettingsSQL("set_service_ranap_piutang"), 2 + len(ServiceFlagColumns), 20},
}

// BillSections are read for the bill: the charges, then the cashier's bill header, payments and receivable as saved
// (these come from `nota_*`, `detail_nota_*` and `piutang_pasien`, not from `billing`).
var BillSections = func() []Section {
	var s []Section
	for _, c := range ChargeSections {
		s = append(s, c.Section)
	}
	return append(s, VisitClass,
		Section{"bill_outpatient", "SELECT n.`no_nota`, CAST(n.`tanggal` AS CHAR), CAST(n.`jam` AS CHAR) FROM `nota_jalan` n WHERE n.`no_rawat` = ? LIMIT 1", 3, 1},
		Section{"bill_inpatient", "SELECT n.`no_nota`, CAST(n.`tanggal` AS CHAR), CAST(n.`jam` AS CHAR) FROM `nota_inap` n WHERE n.`no_rawat` = ? LIMIT 1", 3, 1},
		Section{"payment_outpatient", "SELECT p.`nama_bayar`, " + money("p.`besar_bayar`") + ", " + money("p.`besarppn`") +
			" FROM `detail_nota_jalan` p WHERE p.`no_rawat` = ? ORDER BY p.`nama_bayar` LIMIT ?", 3, 100},
		Section{"payment_inpatient", "SELECT p.`nama_bayar`, " + money("p.`besar_bayar`") + ", " + money("p.`besarppn`") +
			" FROM `detail_nota_inap` p WHERE p.`no_rawat` = ? ORDER BY p.`nama_bayar` LIMIT ?", 3, 100},
		Section{"receivable", "SELECT CAST(p.`status` AS CHAR), " + money("p.`totalpiutang`") + ", " + money("p.`uangmuka`") + ", " +
			money("p.`sisapiutang`") + ", CAST(p.`tgltempo` AS CHAR) FROM `piutang_pasien` p WHERE p.`no_rawat` = ? LIMIT 1", 5, 1},
	)
}()

// readSettings reads one service settings table (no parameters; small, capped at 20 with one row more read so a cut
// is reported).
func (c *Clinical) readSettings(ctx context.Context, s Section) (TextRows, error) {
	rows, err := c.db.Query(ctx, s.SQL)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", s.Name, err)
	}
	defer rows.Close()
	var out TextRows
	for rows.Next() {
		vals := make([]*string, s.Cols)
		dest := make([]any, s.Cols)
		for i := range vals {
			dest[i] = &vals[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("%s: %w", s.Name, err)
		}
		out = append(out, vals)
	}
	return out, rows.Err()
}

// Bill reads the charges, the service fee settings and the saved bill header, payments and receivable. ErrNotFound
// when the encounter does not exist. The encounter's care setting and payer code are returned as section "encounter".
func (c *Clinical) Bill(ctx context.Context, number string) (SectionRows, error) {
	out := SectionRows{Rows: map[string]TextRows{}}
	e, err := c.Encounter(ctx, number)
	if err != nil {
		return out, err
	}
	out.Rows["encounter"] = TextRows{{e.CareSetting, e.PayerCode}}
	for _, s := range ServiceSettings {
		rows, err := c.readSettings(ctx, s)
		if err != nil {
			return out, err
		}
		if len(rows) > s.Cap {
			rows = rows[:s.Cap]
			out.Truncated = append(out.Truncated, s.Name)
		}
		out.Rows[s.Name] = rows
	}
	return out, c.readAll(ctx, BillSections, number, &out)
}
