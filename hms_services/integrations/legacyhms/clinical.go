package legacyhms

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Clinical reads patients (`pasien`), encounters (`reg_periksa`), payer names (`penjab`) and recorded allergies
// (`pemeriksaan_ralan`, `pemeriksaan_ranap`, `resume_pasien_ranap`) from the legacy HMS, read-only (ADR-SVC-003). Every
// statement is fixed at construction and listed by Statements(); only bound parameters vary. Values are returned as
// stored: mapping to HMS terms happens in package clinical.

// Rows is a forward-only result set; *sql.Rows satisfies it.
type Rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
	Close() error
}

// RowsQuerier runs read-only queries returning rows or one row.
type RowsQuerier interface {
	Querier
	Query(ctx context.Context, query string, args ...any) (Rows, error)
}

// PatientRow is one `pasien` row as stored (NULL = nil).
type PatientRow struct {
	MRN, Name, Sex, BirthPlace, BirthDate, BloodType, MaritalStatus, Religion, Education, Occupation *string
	FirstRegistered, MotherName, NIK, Phone, Email, Address, PayerCode, MembershipNo, Employer       *string
	Relationship, ResponsibleName, ResponsibleOccupation, ResponsibleAddress                         *string
}

// PatientHitRow is a search result.
type PatientHitRow struct {
	MRN, Name, Sex, BirthDate *string
}

// EncounterRow is one `reg_periksa` row as stored.
type EncounterRow struct {
	Number, Queue, MRN, RegDate, RegTime, CareSetting, Status, PayerCode *string
}

// PayerVisitRow is one `reg_periksa` row of a patient with the name of its payer (`penjab.png_jawab`, nil when the
// code has no `penjab` row).
type PayerVisitRow struct {
	Number, RegDate, RegTime, CareSetting, Status, PayerCode, PayerName *string
}

// EncounterHitRow is an encounter search result with the patient's name (`pasien.nm_pasien`, nil when the MRN has no
// `pasien` row).
type EncounterHitRow struct {
	EncounterRow
	PatientName *string
}

// AllergyRow is one recorded allergy entry of a patient as stored. Source is the legacy table it came from
// (`pemeriksaan_ralan`, `pemeriksaan_ranap` or `resume_pasien_ranap`); a discharge summary has no time of its own, so
// its Date and Time are nil.
type AllergyRow struct {
	Date, Time, Number, Source, Text *string
}

// IdentifierRow holds the sensitive columns that are only ever returned one at a time by a reveal.
type IdentifierRow struct {
	NIK, Phone, Email, Address, MembershipNo, ResponsibleAddress *string
}

const (
	patientCols = "`no_rkm_medis`, `nm_pasien`, `jk`, `tmp_lahir`, CAST(`tgl_lahir` AS CHAR), `gol_darah`, `stts_nikah`, " +
		"`agama`, `pnd`, `pekerjaan`, CAST(`tgl_daftar` AS CHAR), `nm_ibu`, `no_ktp`, `no_tlp`, `email`, `alamat`, `kd_pj`, " +
		"`no_peserta`, `perusahaan_pasien`, `keluarga`, `namakeluarga`, `pekerjaanpj`, `alamatpj`"
	encounterCols = "`no_rawat`, `no_reg`, `no_rkm_medis`, CAST(`tgl_registrasi` AS CHAR), CAST(`jam_reg` AS CHAR), " +
		"`status_lanjut`, `stts`, `kd_pj`"
	// MaxSearchWords bounds the patient search (the previous implementation's measured rule).
	MaxSearchWords = 5
	// allergyFilter keeps only entries with something written: NULL, blank and the legacy "-" placeholder are not
	// entries, so the row cap counts real ones.
	allergyFilter = " WHERE r.`no_rkm_medis` = ? AND TRIM(x.`alergi`) NOT IN ('', '-')"
)

var ErrNotFound = errors.New("legacyhms: not found")

type Clinical struct {
	db                 RowsQuerier
	qPatient           string
	qPatientSearch     [MaxSearchWords + 1]string // by number of words (index 1..5)
	qIdentifiers       string
	qEncounter         string
	qPatientEncounters string
	qEncounterSearch   string
	qPayerVisits       string
	qPatientScan       string
	// Encounter search with the patient's name, used only when the caller may also read patients (clinical-read-v1 1.2.0).
	qEncounterSearchNamed string
	qPatientAllergies     string
}

func NewClinical(db RowsQuerier) *Clinical {
	c := &Clinical{
		db:           db,
		qPatient:     "SELECT " + patientCols + " FROM `pasien` WHERE `no_rkm_medis` = ? LIMIT 1",
		qIdentifiers: "SELECT `no_ktp`, `no_tlp`, `email`, `alamat`, `no_peserta`, `alamatpj` FROM `pasien` WHERE `no_rkm_medis` = ? LIMIT 1",
		qEncounter:   "SELECT " + encounterCols + " FROM `reg_periksa` WHERE `no_rawat` = ? LIMIT 1",
		// Newest first; `before` pages backwards along the primary key.
		qPatientEncounters: "SELECT " + encounterCols + " FROM `reg_periksa` WHERE `no_rkm_medis` = ? AND `no_rawat` < ? ORDER BY `no_rawat` DESC LIMIT ?",
		qEncounterSearch:   "SELECT " + encounterCols + " FROM `reg_periksa` WHERE `no_rawat` LIKE ? ESCAPE '!' ORDER BY `no_rawat` DESC LIMIT ?",
		// Every visit of one patient with its payer, latest registration first (index on no_rkm_medis; the sort runs over
		// that patient's rows only).
		qPayerVisits: "SELECT r.`no_rawat`, CAST(r.`tgl_registrasi` AS CHAR), CAST(r.`jam_reg` AS CHAR), r.`status_lanjut`, " +
			"r.`stts`, r.`kd_pj`, pj.`png_jawab` FROM `reg_periksa` r LEFT JOIN `penjab` pj ON pj.`kd_pj` = r.`kd_pj` " +
			"WHERE r.`no_rkm_medis` = ? ORDER BY r.`tgl_registrasi` DESC, r.`jam_reg` DESC, r.`no_rawat` DESC LIMIT ?",
	}
	c.qEncounterSearchNamed = "SELECT r.`no_rawat`, r.`no_reg`, r.`no_rkm_medis`, CAST(r.`tgl_registrasi` AS CHAR), " +
		"CAST(r.`jam_reg` AS CHAR), r.`status_lanjut`, r.`stts`, r.`kd_pj`, p.`nm_pasien` FROM `reg_periksa` r " +
		"LEFT JOIN `pasien` p ON p.`no_rkm_medis` = r.`no_rkm_medis` WHERE r.`no_rawat` LIKE ? ESCAPE '!' " +
		"ORDER BY r.`no_rawat` DESC LIMIT ?"
	// Every recorded allergy entry of one patient (via the reg_periksa index on no_rkm_medis), newest first; discharge
	// summaries have no time of their own (NULL date, sorted last). CAST gives the three text columns one character set
	// and collation for the UNION.
	c.qPatientAllergies = "SELECT CAST(x.`tgl_perawatan` AS CHAR) AS `d`, CAST(x.`jam_rawat` AS CHAR) AS `t`, r.`no_rawat` AS `n`, " +
		"'pemeriksaan_ranap' AS `src`, CAST(x.`alergi` AS CHAR) AS `a` FROM `pemeriksaan_ranap` x " +
		"JOIN `reg_periksa` r ON r.`no_rawat` = x.`no_rawat`" + allergyFilter +
		" UNION ALL SELECT CAST(x.`tgl_perawatan` AS CHAR), CAST(x.`jam_rawat` AS CHAR), r.`no_rawat`, 'pemeriksaan_ralan', " +
		"CAST(x.`alergi` AS CHAR) FROM `pemeriksaan_ralan` x JOIN `reg_periksa` r ON r.`no_rawat` = x.`no_rawat`" + allergyFilter +
		" UNION ALL SELECT NULL, NULL, r.`no_rawat`, 'resume_pasien_ranap', CAST(x.`alergi` AS CHAR) FROM `resume_pasien_ranap` x " +
		"JOIN `reg_periksa` r ON r.`no_rawat` = x.`no_rawat`" + allergyFilter +
		" ORDER BY `d` DESC, `t` DESC, `n` DESC LIMIT ?"
	// The legacy bridge's snapshot scan (ADR-SVC-010): primary-key range in key order, bounded by the batch size.
	c.qPatientScan = "SELECT " + patientCols + " FROM `pasien` WHERE `no_rkm_medis` > ? ORDER BY `no_rkm_medis` LIMIT ?"
	for n := 1; n <= MaxSearchWords; n++ {
		conds := make([]string, n)
		for i := range conds {
			conds[i] = "(`nm_pasien` LIKE ? ESCAPE '!' OR `no_rkm_medis` LIKE ? ESCAPE '!')"
		}
		c.qPatientSearch[n] = "SELECT `no_rkm_medis`, `nm_pasien`, `jk`, CAST(`tgl_lahir` AS CHAR) FROM `pasien` WHERE " +
			strings.Join(conds, " AND ") + " ORDER BY `no_rkm_medis` = ? DESC, `nm_pasien`, `no_rkm_medis` LIMIT ?"
	}
	return c
}

// Statements returns every SQL statement this reader can send.
func (c *Clinical) Statements() []string {
	s := []string{c.qPatient, c.qIdentifiers, c.qEncounter, c.qPatientEncounters, c.qEncounterSearch, c.qPayerVisits, c.qPatientScan,
		c.qEncounterSearchNamed, c.qPatientAllergies}
	return append(s, c.qPatientSearch[1:]...)
}

// LikeEscape makes a word literal inside LIKE (escape character '!'), so a typed % or _ never widens the match.
func LikeEscape(w string) string {
	return strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(w)
}

func (c *Clinical) Patient(ctx context.Context, mrn string) (PatientRow, error) {
	var p PatientRow
	err := c.db.QueryRow(ctx, c.qPatient, mrn).Scan(&p.MRN, &p.Name, &p.Sex, &p.BirthPlace, &p.BirthDate, &p.BloodType,
		&p.MaritalStatus, &p.Religion, &p.Education, &p.Occupation, &p.FirstRegistered, &p.MotherName, &p.NIK, &p.Phone,
		&p.Email, &p.Address, &p.PayerCode, &p.MembershipNo, &p.Employer, &p.Relationship, &p.ResponsibleName,
		&p.ResponsibleOccupation, &p.ResponsibleAddress)
	return p, notFoundAs(err, ErrNotFound)
}

// PatientScan returns up to limit patients whose MRN sorts after `after` ("" = from the first), in MRN order.
func (c *Clinical) PatientScan(ctx context.Context, after string, limit int) ([]PatientRow, error) {
	rows, err := c.db.Query(ctx, c.qPatientScan, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PatientRow
	for rows.Next() {
		var p PatientRow
		if err := rows.Scan(&p.MRN, &p.Name, &p.Sex, &p.BirthPlace, &p.BirthDate, &p.BloodType, &p.MaritalStatus,
			&p.Religion, &p.Education, &p.Occupation, &p.FirstRegistered, &p.MotherName, &p.NIK, &p.Phone, &p.Email,
			&p.Address, &p.PayerCode, &p.MembershipNo, &p.Employer, &p.Relationship, &p.ResponsibleName,
			&p.ResponsibleOccupation, &p.ResponsibleAddress); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (c *Clinical) Identifiers(ctx context.Context, mrn string) (IdentifierRow, error) {
	var r IdentifierRow
	err := c.db.QueryRow(ctx, c.qIdentifiers, mrn).Scan(&r.NIK, &r.Phone, &r.Email, &r.Address, &r.MembershipNo,
		&r.ResponsibleAddress)
	return r, notFoundAs(err, ErrNotFound)
}

// SearchPatients finds patients whose name or MRN contains every word (1..MaxSearchWords words), exact MRN first.
func (c *Clinical) SearchPatients(ctx context.Context, words []string, limit int) ([]PatientHitRow, error) {
	if len(words) < 1 || len(words) > MaxSearchWords {
		return nil, fmt.Errorf("legacyhms: %d search words", len(words))
	}
	args := make([]any, 0, 2*len(words)+2)
	for _, w := range words {
		e := "%" + LikeEscape(w) + "%"
		args = append(args, e, e)
	}
	args = append(args, words[0], limit)
	rows, err := c.db.Query(ctx, c.qPatientSearch[len(words)], args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PatientHitRow
	for rows.Next() {
		var h PatientHitRow
		if err := rows.Scan(&h.MRN, &h.Name, &h.Sex, &h.BirthDate); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (c *Clinical) Encounter(ctx context.Context, number string) (EncounterRow, error) {
	var e EncounterRow
	err := c.db.QueryRow(ctx, c.qEncounter, number).Scan(encounterDest(&e)...)
	return e, notFoundAs(err, ErrNotFound)
}

// PatientEncounters lists encounters of a patient newest first, strictly before `before` ("" = from the newest).
func (c *Clinical) PatientEncounters(ctx context.Context, mrn, before string, limit int) ([]EncounterRow, error) {
	if before == "" {
		before = "~" // sorts after every encounter number (digits and '/')
	}
	return c.encounters(ctx, c.qPatientEncounters, mrn, before, limit)
}

// SearchEncounters finds encounters whose number starts with prefix, newest first.
func (c *Clinical) SearchEncounters(ctx context.Context, prefix string, limit int) ([]EncounterRow, error) {
	return c.encounters(ctx, c.qEncounterSearch, LikeEscape(prefix)+"%", limit)
}

// PayerVisits lists a patient's visits with their payer, latest registration first, at most limit rows.
func (c *Clinical) PayerVisits(ctx context.Context, mrn string, limit int) ([]PayerVisitRow, error) {
	rows, err := c.db.Query(ctx, c.qPayerVisits, mrn, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PayerVisitRow
	for rows.Next() {
		var v PayerVisitRow
		if err := rows.Scan(&v.Number, &v.RegDate, &v.RegTime, &v.CareSetting, &v.Status, &v.PayerCode, &v.PayerName); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// SearchEncountersNamed is SearchEncounters with each visit's patient name, for callers that may also read patients.
func (c *Clinical) SearchEncountersNamed(ctx context.Context, prefix string, limit int) ([]EncounterHitRow, error) {
	rows, err := c.db.Query(ctx, c.qEncounterSearchNamed, LikeEscape(prefix)+"%", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EncounterHitRow
	for rows.Next() {
		var h EncounterHitRow
		if err := rows.Scan(append(encounterDest(&h.EncounterRow), &h.PatientName)...); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// PatientAllergies lists the patient's recorded allergy entries (visit notes and discharge summaries), newest first with
// undated entries last, at most limit rows.
func (c *Clinical) PatientAllergies(ctx context.Context, mrn string, limit int) ([]AllergyRow, error) {
	rows, err := c.db.Query(ctx, c.qPatientAllergies, mrn, mrn, mrn, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AllergyRow
	for rows.Next() {
		var a AllergyRow
		if err := rows.Scan(&a.Date, &a.Time, &a.Number, &a.Source, &a.Text); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (c *Clinical) encounters(ctx context.Context, q string, args ...any) ([]EncounterRow, error) {
	rows, err := c.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EncounterRow
	for rows.Next() {
		var e EncounterRow
		if err := rows.Scan(encounterDest(&e)...); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func encounterDest(e *EncounterRow) []any {
	return []any{&e.Number, &e.Queue, &e.MRN, &e.RegDate, &e.RegTime, &e.CareSetting, &e.Status, &e.PayerCode}
}

// Query implements RowsQuerier for the *sql.DB adapter.
func (q sqlQuerier) Query(ctx context.Context, query string, args ...any) (Rows, error) {
	if !strings.HasPrefix(query, "SELECT ") {
		return nil, errors.New("legacyhms: only SELECT statements are allowed")
	}
	rows, err := q.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// RowsQuerierFor adapts a *sql.DB to RowsQuerier.
func RowsQuerierFor(db *sql.DB) RowsQuerier { return sqlQuerier{db: db} }
