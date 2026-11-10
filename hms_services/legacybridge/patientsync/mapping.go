// Package patientsync is the legacy bridge for patients (ADR-ROOT-002, ADR-SVC-010): it reads the legacy HMS
// patient table `pasien` (SELECT-only), maps each row to the canonical Patient with a versioned mapping, and writes it
// through the canonical store as service legacy-bridge while the organization's patient domain has legacy authority.
// It never writes the legacy HMS and never invents a value the legacy row does not hold.
package patientsync

import (
	"crypto/sha256"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"hms/services/canonical/patient"
	"hms/services/integrations/legacyhms"
)

// MappingVersion names this mapping in the crosswalk and in bridge issues. Change the number whenever a rule below
// changes: the row hash includes it, so every row is mapped again with the new rules.
const MappingVersion = "legacy-hms.pasien/1"

// Columns this mapping reads (the hash covers exactly these). Not mapped in version 1, pending terminology maps or
// their canonical tables: gol_darah, stts_nikah, agama, pnd, pekerjaan (code lists), tgl_daftar, nm_ibu, no_tlp,
// email, alamat (telecom/address), kd_pj, no_peserta, perusahaan_pasien (coverage), keluarga, namakeluarga,
// pekerjaanpj, alamatpj (contacts).
var mappedColumns = []string{"no_rkm_medis", "nm_pasien", "jk", "tgl_lahir", "tmp_lahir", "no_ktp"}

// Issue is a problem with one legacy row: Kind "rejected" (row not written) or "partial" (written without the field).
type Issue struct {
	Kind   string
	Reason string
	Field  string // legacy column; "" = the whole row
}

// Mapped is the outcome of mapping one row.
type Mapped struct {
	Key      string // the MRN as stored (source key)
	Patient  patient.Patient
	Issues   []Issue
	Rejected bool
	Hash     [32]byte
}

var (
	mrnPattern = regexp.MustCompile(`^[A-Za-z0-9.-]{1,15}$`)
	nikPattern = regexp.MustCompile(`^[0-9]{16}$`)
	dashes     = regexp.MustCompile(`^-+$`)
	storedDate = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})`)
	spaces     = regexp.MustCompile(`\s+`)
)

// clean trims a stored text; the legacy HMS writes "-" for unknown, which means not recorded (as in package clinical).
func clean(v *string) string {
	if v == nil {
		return ""
	}
	s := strings.TrimSpace(*v)
	if dashes.MatchString(s) {
		return ""
	}
	return s
}

// Map maps one `pasien` row. today bounds the birth date.
func Map(row legacyhms.PatientRow, today time.Time) Mapped {
	m := Mapped{Key: clean(row.MRN), Hash: rowHash(row)}
	if !mrnPattern.MatchString(m.Key) {
		m.Rejected = true
		m.Issues = append(m.Issues, Issue{Kind: "rejected", Reason: "invalid_mrn", Field: "no_rkm_medis"})
	} else {
		m.Patient.Identifiers = append(m.Patient.Identifiers, patient.Identifier{System: patient.SystemMRN, Value: m.Key})
	}

	m.Patient.Name = spaces.ReplaceAllString(clean(row.Name), " ")
	if n := utf8.RuneCountInString(m.Patient.Name); n < 1 || n > 200 {
		m.Rejected = true
		m.Issues = append(m.Issues, Issue{Kind: "rejected", Reason: "missing_name", Field: "nm_pasien"})
	}

	// jk: L = laki-laki, P = perempuan (evidence: the legacy read slice, ADR-SVC-003). Anything else is unknown; a
	// value that is neither empty nor "-" is reported.
	switch s := clean(row.Sex); s {
	case "L":
		m.Patient.Gender = "male"
	case "P":
		m.Patient.Gender = "female"
	case "":
		m.Patient.Gender = "unknown"
	default:
		m.Patient.Gender = "unknown"
		m.Issues = append(m.Issues, Issue{Kind: "partial", Reason: "unknown_sex_code", Field: "jk"})
	}

	// tgl_lahir: a real calendar date from 1900 up to today; "0000-00-00" and empty mean not recorded.
	if raw := clean(row.BirthDate); raw != "" && !strings.HasPrefix(raw, "0000-00-00") {
		d, err := time.Parse("2006-01-02", storedDate.FindString(raw))
		switch {
		case err != nil || d.Year() < 1900:
			m.Issues = append(m.Issues, Issue{Kind: "partial", Reason: "invalid_birth_date", Field: "tgl_lahir"})
		case d.After(today):
			m.Issues = append(m.Issues, Issue{Kind: "partial", Reason: "future_birth_date", Field: "tgl_lahir"})
		default:
			m.Patient.BirthDate = d.Format("2006-01-02")
		}
	}

	if place := clean(row.BirthPlace); utf8.RuneCountInString(place) <= 200 {
		m.Patient.BirthPlace = place
	} else {
		m.Issues = append(m.Issues, Issue{Kind: "partial", Reason: "birth_place_too_long", Field: "tmp_lahir"})
	}

	// no_ktp: a 16-digit NIK. 9999999999999999 is the national placeholder for "no NIK" and is not an identifier.
	switch nik := clean(row.NIK); {
	case nik == "" || nik == "9999999999999999":
	case nikPattern.MatchString(nik):
		m.Patient.Identifiers = append(m.Patient.Identifiers, patient.Identifier{System: patient.SystemNIK, Value: nik})
	default:
		m.Issues = append(m.Issues, Issue{Kind: "partial", Reason: "invalid_nik", Field: "no_ktp"})
	}
	return m
}

// WithoutNIK drops the NIK and records why (used when the NIK is already another patient's).
func (m Mapped) WithoutNIK(reason string) Mapped {
	var ids []patient.Identifier
	for _, i := range m.Patient.Identifiers {
		if i.System != patient.SystemNIK {
			ids = append(ids, i)
		}
	}
	m.Patient.Identifiers = ids
	m.Issues = append(append([]Issue{}, m.Issues...), Issue{Kind: "partial", Reason: reason, Field: "no_ktp"})
	return m
}

// HasNIK reports whether the mapped patient carries a NIK.
func (m Mapped) HasNIK() bool {
	for _, i := range m.Patient.Identifiers {
		if i.System == patient.SystemNIK {
			return true
		}
	}
	return false
}

// rowHash fingerprints the mapped columns as stored, with the mapping version: any change to them, or a new mapping
// version, maps the row again; changes to other columns do not.
func rowHash(row legacyhms.PatientRow) [32]byte {
	h := sha256.New()
	h.Write([]byte(MappingVersion))
	for _, v := range []*string{row.MRN, row.Name, row.Sex, row.BirthDate, row.BirthPlace, row.NIK} {
		h.Write([]byte{0x1f})
		if v == nil {
			h.Write([]byte{0})
			continue
		}
		h.Write([]byte{1})
		h.Write([]byte(*v))
	}
	var sum [32]byte
	copy(sum[:], h.Sum(nil))
	return sum
}
