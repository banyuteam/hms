package legacyhms

import (
	"context"
	"fmt"
)

// Visit timeline and saved bill (ADR-SVC-004). One fixed SELECT per section, filtered by the encounter number through an
// indexed column (verified against the schema snapshot of 2026-11-06); name lookups are LEFT JOINs on primary keys, so
// they cannot multiply rows. Every value is returned as text (numbers cast in SQL, money as DECIMAL(18,2)), and each
// section reads one row more than its cap so truncation is detected exactly.

// TextRows are the rows of one section; nil means NULL.
type TextRows [][]*string

// Section is one fixed statement of the timeline or the bill.
type Section struct {
	Name string
	SQL  string
	Cols int
	Cap  int // rows kept; 1 for single-row sections
}

// ProcedureSource describes one of the six legacy procedure tables.
type ProcedureSource struct {
	Table, ItemTable, CareSetting, PerformedBy string
	Doctor, Staff                              bool
}

// ProcedureSources are read in this order; their rows share one column layout.
var ProcedureSources = []ProcedureSource{
	{"rawat_jl_dr", "jns_perawatan", "outpatient", "doctor", true, false},
	{"rawat_jl_pr", "jns_perawatan", "outpatient", "nurse", false, true},
	{"rawat_jl_drpr", "jns_perawatan", "outpatient", "doctor_and_nurse", true, true},
	{"rawat_inap_dr", "jns_perawatan_inap", "inpatient", "doctor", true, false},
	{"rawat_inap_pr", "jns_perawatan_inap", "inpatient", "nurse", false, true},
	{"rawat_inap_drpr", "jns_perawatan_inap", "inpatient", "doctor_and_nurse", true, true},
}

const noteCols = "CAST(n.`tgl_perawatan` AS CHAR), CAST(n.`jam_rawat` AS CHAR), n.`nip`, p.`nama`, n.`keluhan`, n.`pemeriksaan`, " +
	"n.`penilaian`, n.`rtl`, n.`instruksi`, n.`evaluasi`, n.`alergi`, CAST(n.`kesadaran` AS CHAR), n.`tensi`, n.`nadi`, " +
	"n.`respirasi`, n.`suhu_tubuh`, n.`spo2`, n.`gcs`, n.`tinggi`, n.`berat`"

func money(col string) string { return "CAST(CAST(" + col + " AS DECIMAL(18,2)) AS CHAR)" }

func procedureSQL(p ProcedureSource) string {
	doctor, staff, joins := "NULL", "NULL", ""
	if p.Doctor {
		doctor = "d.`nm_dokter`"
		joins += " LEFT JOIN `dokter` d ON d.`kd_dokter` = t.`kd_dokter`"
	}
	if p.Staff {
		staff = "pt.`nama`"
		joins += " LEFT JOIN `petugas` pt ON pt.`nip` = t.`nip`"
	}
	return "SELECT CAST(t.`tgl_perawatan` AS CHAR), CAST(t.`jam_rawat` AS CHAR), t.`kd_jenis_prw`, j.`nm_perawatan`, " + doctor +
		", " + staff + " FROM `" + p.Table + "` t LEFT JOIN `" + p.ItemTable + "` j ON j.`kd_jenis_prw` = t.`kd_jenis_prw`" +
		joins + " WHERE t.`no_rawat` = ? ORDER BY t.`tgl_perawatan`, t.`jam_rawat`, t.`kd_jenis_prw` LIMIT ?"
}

// TimelineHeader is the visit row (summary and registration); not found means no such encounter.
var TimelineHeader = Section{"header", "SELECT r.`no_rkm_medis`, CAST(r.`status_lanjut` AS CHAR), CAST(r.`stts` AS CHAR), r.`kd_pj`, " +
	"pj.`png_jawab`, pj.`nama_perusahaan`, r.`no_reg`, CAST(r.`tgl_registrasi` AS CHAR), CAST(r.`jam_reg` AS CHAR), " +
	"pl.`nm_poli`, d.`nm_dokter` FROM `reg_periksa` r LEFT JOIN `penjab` pj ON pj.`kd_pj` = r.`kd_pj` " +
	"LEFT JOIN `poliklinik` pl ON pl.`kd_poli` = r.`kd_poli` LEFT JOIN `dokter` d ON d.`kd_dokter` = r.`kd_dokter` " +
	"WHERE r.`no_rawat` = ? LIMIT 1", 11, 1}

// TimelineSections are read after the header, in this order.
var TimelineSections = func() []Section {
	s := []Section{
		{"room_stay", "SELECT CAST(ki.`tgl_masuk` AS CHAR), CAST(ki.`jam_masuk` AS CHAR), ki.`kd_kamar`, CAST(k.`kelas` AS CHAR), " +
			"b.`nm_bangsal`, ki.`diagnosa_awal`, ki.`diagnosa_akhir`, CAST(ki.`tgl_keluar` AS CHAR), CAST(ki.`jam_keluar` AS CHAR), " +
			"CAST(ki.`lama` AS CHAR), CAST(ki.`stts_pulang` AS CHAR) FROM `kamar_inap` ki LEFT JOIN `kamar` k ON k.`kd_kamar` = ki.`kd_kamar` " +
			"LEFT JOIN `bangsal` b ON b.`kd_bangsal` = k.`kd_bangsal` WHERE ki.`no_rawat` = ? ORDER BY ki.`tgl_masuk`, ki.`jam_masuk` LIMIT ?", 11, 200},
		{"clinical_note_outpatient", "SELECT " + noteCols + " FROM `pemeriksaan_ralan` n LEFT JOIN `pegawai` p ON p.`nik` = n.`nip` " +
			"WHERE n.`no_rawat` = ? ORDER BY n.`tgl_perawatan`, n.`jam_rawat` LIMIT ?", 20, 2000},
		{"clinical_note_inpatient", "SELECT " + noteCols + " FROM `pemeriksaan_ranap` n LEFT JOIN `pegawai` p ON p.`nik` = n.`nip` " +
			"WHERE n.`no_rawat` = ? ORDER BY n.`tgl_perawatan`, n.`jam_rawat` LIMIT ?", 20, 2000},
	}
	for _, p := range ProcedureSources {
		s = append(s, Section{"procedure_" + p.Table, procedureSQL(p), 6, 2000})
	}
	return append(s,
		Section{"lab_test", "SELECT CAST(t.`tgl_periksa` AS CHAR), CAST(t.`jam` AS CHAR), t.`kd_jenis_prw`, j.`nm_perawatan`, " +
			"CAST(t.`kategori` AS CHAR), CAST(t.`status` AS CHAR), d.`nm_dokter`, rf.`nm_dokter`, pt.`nama` FROM `periksa_lab` t " +
			"LEFT JOIN `jns_perawatan_lab` j ON j.`kd_jenis_prw` = t.`kd_jenis_prw` LEFT JOIN `dokter` d ON d.`kd_dokter` = t.`kd_dokter` " +
			"LEFT JOIN `dokter` rf ON rf.`kd_dokter` = t.`dokter_perujuk` LEFT JOIN `petugas` pt ON pt.`nip` = t.`nip` " +
			"WHERE t.`no_rawat` = ? ORDER BY t.`tgl_periksa`, t.`jam`, t.`kd_jenis_prw` LIMIT ?", 9, 2000},
		Section{"lab_result", "SELECT CAST(r.`tgl_periksa` AS CHAR), CAST(r.`jam` AS CHAR), r.`kd_jenis_prw`, CAST(r.`id_template` AS CHAR), " +
			"tl.`Pemeriksaan`, r.`nilai`, r.`nilai_rujukan`, tl.`satuan`, r.`keterangan` FROM `detail_periksa_lab` r " +
			"LEFT JOIN `template_laboratorium` tl ON tl.`id_template` = r.`id_template` WHERE r.`no_rawat` = ? " +
			"ORDER BY r.`tgl_periksa`, r.`jam`, r.`kd_jenis_prw`, tl.`urut`, r.`id_template` LIMIT ?", 9, 10000},
		Section{"radiology_exam", "SELECT CAST(t.`tgl_periksa` AS CHAR), CAST(t.`jam` AS CHAR), t.`kd_jenis_prw`, j.`nm_perawatan`, " +
			"CAST(t.`status` AS CHAR), d.`nm_dokter`, rf.`nm_dokter`, pt.`nama`, t.`proyeksi` FROM `periksa_radiologi` t " +
			"LEFT JOIN `jns_perawatan_radiologi` j ON j.`kd_jenis_prw` = t.`kd_jenis_prw` LEFT JOIN `dokter` d ON d.`kd_dokter` = t.`kd_dokter` " +
			"LEFT JOIN `dokter` rf ON rf.`kd_dokter` = t.`dokter_perujuk` LEFT JOIN `petugas` pt ON pt.`nip` = t.`nip` " +
			"WHERE t.`no_rawat` = ? ORDER BY t.`tgl_periksa`, t.`jam`, t.`kd_jenis_prw` LIMIT ?", 9, 2000},
		Section{"radiology_report", "SELECT CAST(h.`tgl_periksa` AS CHAR), CAST(h.`jam` AS CHAR), h.`hasil` FROM `hasil_radiologi` h " +
			"WHERE h.`no_rawat` = ? ORDER BY h.`tgl_periksa`, h.`jam` LIMIT ?", 3, 2000},
		Section{"prescription", "SELECT r.`no_resep`, CAST(r.`tgl_peresepan` AS CHAR), CAST(r.`jam_peresepan` AS CHAR), " +
			"CAST(r.`tgl_perawatan` AS CHAR), CAST(r.`jam` AS CHAR), CAST(r.`tgl_penyerahan` AS CHAR), CAST(r.`jam_penyerahan` AS CHAR), " +
			"CAST(r.`status` AS CHAR), d.`nm_dokter` FROM `resep_obat` r LEFT JOIN `dokter` d ON d.`kd_dokter` = r.`kd_dokter` " +
			"WHERE r.`no_rawat` = ? ORDER BY r.`no_resep` LIMIT ?", 9, 2000},
		Section{"prescription_item", "SELECT d.`no_resep`, d.`kode_brng`, b.`nama_brng`, CAST(d.`jml` AS CHAR), b.`kode_sat`, d.`aturan_pakai` " +
			"FROM `resep_obat` r JOIN `resep_dokter` d ON d.`no_resep` = r.`no_resep` LEFT JOIN `databarang` b ON b.`kode_brng` = d.`kode_brng` " +
			"WHERE r.`no_rawat` = ? ORDER BY d.`no_resep`, d.`kode_brng` LIMIT ?", 6, 10000},
		Section{"prescription_compound", "SELECT c.`no_resep`, c.`no_racik`, c.`nama_racik`, CAST(c.`jml_dr` AS CHAR), c.`aturan_pakai`, " +
			"c.`keterangan` FROM `resep_obat` r JOIN `resep_dokter_racikan` c ON c.`no_resep` = r.`no_resep` " +
			"WHERE r.`no_rawat` = ? ORDER BY c.`no_resep`, c.`no_racik` LIMIT ?", 6, 2000},
		Section{"medication_given", "SELECT CAST(m.`tgl_perawatan` AS CHAR), CAST(m.`jam` AS CHAR), m.`kode_brng`, b.`nama_brng`, " +
			"CAST(m.`jml` AS CHAR), b.`kode_sat`, m.`no_batch`, w.`nm_bangsal`, CAST(m.`status` AS CHAR), a.`aturan` " +
			"FROM `detail_pemberian_obat` m LEFT JOIN `databarang` b ON b.`kode_brng` = m.`kode_brng` " +
			"LEFT JOIN `bangsal` w ON w.`kd_bangsal` = m.`kd_bangsal` LEFT JOIN `aturan_pakai` a ON a.`tgl_perawatan` = m.`tgl_perawatan` " +
			"AND a.`jam` = m.`jam` AND a.`no_rawat` = m.`no_rawat` AND a.`kode_brng` = m.`kode_brng` " +
			"WHERE m.`no_rawat` = ? ORDER BY m.`tgl_perawatan`, m.`jam`, m.`kode_brng` LIMIT ?", 10, 5000},
		Section{"surgery", "SELECT CAST(o.`tgl_operasi` AS CHAR), p.`nm_perawatan`, op.`nm_dokter`, an.`nm_dokter`, o.`jenis_anasthesi`, " +
			"CAST(o.`kategori` AS CHAR), CAST(o.`status` AS CHAR) FROM `operasi` o LEFT JOIN `paket_operasi` p ON p.`kode_paket` = o.`kode_paket` " +
			"LEFT JOIN `dokter` op ON op.`kd_dokter` = o.`operator1` LEFT JOIN `dokter` an ON an.`kd_dokter` = o.`dokter_anestesi` " +
			"WHERE o.`no_rawat` = ? ORDER BY o.`tgl_operasi` LIMIT ?", 7, 200},
		Section{"surgery_report", "SELECT CAST(l.`tanggal` AS CHAR), l.`diagnosa_preop`, l.`diagnosa_postop`, l.`laporan_operasi`, " +
			"CAST(l.`perdarahan` AS CHAR), CAST(l.`komplikasi` AS CHAR), CAST(l.`selesaioperasi` AS CHAR) FROM `laporan_operasi` l " +
			"WHERE l.`no_rawat` = ? ORDER BY l.`tanggal` LIMIT ?", 7, 200},
		Section{"diagnosis", "SELECT dp.`kd_penyakit`, p.`nm_penyakit`, CAST(dp.`status` AS CHAR), CAST(dp.`prioritas` AS CHAR), " +
			"CAST(dp.`status_penyakit` AS CHAR) FROM `diagnosa_pasien` dp LEFT JOIN `penyakit` p ON p.`kd_penyakit` = dp.`kd_penyakit` " +
			"WHERE dp.`no_rawat` = ? ORDER BY dp.`status`, dp.`prioritas` LIMIT ?", 5, 500},
		Section{"coded_procedure", "SELECT pp.`kode`, i.`deskripsi_panjang`, CAST(pp.`status` AS CHAR), CAST(pp.`prioritas` AS CHAR) " +
			"FROM `prosedur_pasien` pp LEFT JOIN `icd9` i ON i.`kode` = pp.`kode` WHERE pp.`no_rawat` = ? " +
			"ORDER BY pp.`status`, pp.`prioritas` LIMIT ?", 4, 500},
		Section{"attending_doctor", "SELECT d.`nm_dokter`, CAST(a.`prioritas` AS CHAR) FROM `dpjp_ranap` a " +
			"LEFT JOIN `dokter` d ON d.`kd_dokter` = a.`kd_dokter` WHERE a.`no_rawat` = ? ORDER BY a.`prioritas` LIMIT ?", 2, 100},
		Section{"discharge_summary", "SELECT d.`nm_dokter`, s.`keluhan_utama`, s.`jalannya_penyakit`, s.`kd_diagnosa_utama`, " +
			"s.`diagnosa_utama`, s.`kd_diagnosa_sekunder`, s.`diagnosa_sekunder`, s.`kd_prosedur_utama`, s.`prosedur_utama`, s.`alergi`, " +
			"CAST(s.`keadaan` AS CHAR), CAST(s.`cara_keluar` AS CHAR), s.`obat_pulang`, s.`diet`, s.`edukasi`, s.`kontrol` " +
			"FROM `resume_pasien_ranap` s LEFT JOIN `dokter` d ON d.`kd_dokter` = s.`kd_dokter` WHERE s.`no_rawat` = ? LIMIT 1", 16, 1},
	)
}()

// SectionRows is what a timeline or bill read returns: rows per section name and the sections that hit their cap.
type SectionRows struct {
	Rows      map[string]TextRows
	Truncated []string
}

// TimelineStatements lists every timeline and bill statement (for the allowlist test and the counts-only check).
func TimelineStatements() []string {
	out := []string{TimelineHeader.SQL}
	for _, s := range append(append([]Section{}, TimelineSections...), BillSections...) {
		out = append(out, s.SQL)
	}
	return out
}

// readSection runs one section. Single-row sections (Cap 1) use LIMIT 1 in their SQL; the others read Cap+1 rows.
func (c *Clinical) readSection(ctx context.Context, s Section, number string) (TextRows, bool, error) {
	args := []any{number}
	if s.Cap > 1 {
		args = append(args, s.Cap+1)
	}
	rows, err := c.db.Query(ctx, s.SQL, args...)
	if err != nil {
		return nil, false, fmt.Errorf("%s: %w", s.Name, err)
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
			return nil, false, fmt.Errorf("%s: %w", s.Name, err)
		}
		out = append(out, vals)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("%s: %w", s.Name, err)
	}
	if s.Cap > 1 && len(out) > s.Cap {
		return out[:s.Cap], true, nil
	}
	return out, false, nil
}

func (c *Clinical) readAll(ctx context.Context, sections []Section, number string, into *SectionRows) error {
	for _, s := range sections {
		rows, truncated, err := c.readSection(ctx, s, number)
		if err != nil {
			return err
		}
		into.Rows[s.Name] = rows
		if truncated {
			into.Truncated = append(into.Truncated, s.Name)
		}
	}
	return nil
}

// Timeline reads the visit header, every timeline section and the visit's SEPs (`bridging_sep`, ADR-SVC-007; empty
// for visits without one). ErrNotFound when the encounter does not exist.
func (c *Clinical) Timeline(ctx context.Context, number string) (SectionRows, error) {
	out := SectionRows{Rows: map[string]TextRows{}}
	header, _, err := c.readSection(ctx, TimelineHeader, number)
	if err != nil {
		return out, err
	}
	if len(header) == 0 {
		return out, ErrNotFound
	}
	out.Rows[TimelineHeader.Name] = header
	if err := c.readAll(ctx, TimelineSections, number, &out); err != nil {
		return out, err
	}
	return out, c.readAll(ctx, []Section{SEPSection}, number, &out)
}
