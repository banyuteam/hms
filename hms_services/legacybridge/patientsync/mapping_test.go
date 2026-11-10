package patientsync

import (
	"testing"
	"time"

	"hms/services/canonical/patient"
	"hms/services/integrations/legacyhms"
)

func str(s string) *string { return &s }

var today = time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)

func row(mrn, name, sex, birth, place, nik string) legacyhms.PatientRow {
	return legacyhms.PatientRow{MRN: str(mrn), Name: str(name), Sex: str(sex), BirthDate: str(birth), BirthPlace: str(place), NIK: str(nik)}
}

func reasons(m Mapped) map[string]string {
	out := map[string]string{}
	for _, is := range m.Issues {
		out[is.Reason] = is.Kind + ":" + is.Field
	}
	return out
}

func TestMapCleanRow(t *testing.T) {
	m := Map(row("000123", "  Siti   Aminah ", "P", "1980-04-05", "Semarang", "3374010101800001"), today)
	if m.Rejected || len(m.Issues) != 0 {
		t.Fatalf("clean row: rejected=%v issues=%v", m.Rejected, m.Issues)
	}
	want := patient.Patient{Name: "Siti Aminah", Gender: "female", BirthDate: "1980-04-05", BirthPlace: "Semarang",
		Identifiers: []patient.Identifier{{System: patient.SystemMRN, Value: "000123"}, {System: patient.SystemNIK, Value: "3374010101800001"}}}
	if m.Key != "000123" || m.Patient.Name != want.Name || m.Patient.Gender != want.Gender || m.Patient.BirthDate != want.BirthDate ||
		m.Patient.BirthPlace != want.BirthPlace || len(m.Patient.Identifiers) != 2 || m.Patient.Identifiers[0] != want.Identifiers[0] ||
		m.Patient.Identifiers[1] != want.Identifiers[1] {
		t.Errorf("mapped %+v", m.Patient)
	}
}

func TestMapNothingInvented(t *testing.T) {
	// "-" and "0000-00-00" mean not recorded; the NIK placeholder means no NIK. None of them is an issue.
	m := Map(row("000124", "Budi", "-", "0000-00-00", "-", "9999999999999999"), today)
	if m.Rejected || len(m.Issues) != 0 {
		t.Fatalf("unrecorded values are not issues: %v", m.Issues)
	}
	if m.Patient.Gender != "unknown" || m.Patient.BirthDate != "" || m.Patient.BirthPlace != "" || len(m.Patient.Identifiers) != 1 {
		t.Errorf("mapped %+v", m.Patient)
	}
	m = Map(legacyhms.PatientRow{MRN: str("000125"), Name: str("Ani")}, today)
	if m.Rejected || m.Patient.Gender != "unknown" || m.Patient.BirthDate != "" {
		t.Errorf("NULL columns: %+v %v", m.Patient, m.Issues)
	}
}

func TestMapPartialAndRejected(t *testing.T) {
	m := Map(row("000126", "Dewi", "X", "1980-02-30", "Solo", "33740101"), today)
	got := reasons(m)
	if m.Rejected || got["unknown_sex_code"] != "partial:jk" || got["invalid_birth_date"] != "partial:tgl_lahir" ||
		got["invalid_nik"] != "partial:no_ktp" {
		t.Errorf("partial issues: rejected=%v %v", m.Rejected, got)
	}
	if m.Patient.BirthDate != "" || m.HasNIK() {
		t.Errorf("invalid values must not be written: %+v", m.Patient)
	}
	if got := reasons(Map(row("000127", "Eko", "L", "2027-01-01", "", ""), today)); got["future_birth_date"] != "partial:tgl_lahir" {
		t.Errorf("future birth date: %v", got)
	}

	m = Map(row("000128", "-", "L", "1990-01-01", "", ""), today)
	if !m.Rejected || reasons(m)["missing_name"] != "rejected:nm_pasien" {
		t.Errorf("missing name rejects the row: %v", m.Issues)
	}
	m = Map(row("RM 12/3", "Fajar", "L", "1990-01-01", "", ""), today)
	if !m.Rejected || reasons(m)["invalid_mrn"] != "rejected:no_rkm_medis" {
		t.Errorf("invalid MRN rejects the row: %v", m.Issues)
	}
}

func TestHashCoversMappedColumnsAndVersion(t *testing.T) {
	base := row("000129", "Gita", "P", "1991-01-01", "Kudus", "3374010101910001")
	h := Map(base, today).Hash
	if Map(base, today).Hash != h {
		t.Fatal("hash is not deterministic")
	}
	changed := base
	changed.NIK = str("3374010101910002")
	if Map(changed, today).Hash == h {
		t.Error("a mapped column change must change the hash")
	}
	nilVsEmpty := base
	nilVsEmpty.BirthPlace = nil
	empty := base
	empty.BirthPlace = str("")
	if Map(nilVsEmpty, today).Hash == Map(empty, today).Hash {
		t.Error("NULL and empty must hash differently")
	}
	other := base
	other.Phone = str("0811") // not mapped in version 1
	if Map(other, today).Hash != h {
		t.Error("an unmapped column must not change the hash")
	}
	if len(mappedColumns) != 6 {
		t.Errorf("hash covers 6 columns; update mappedColumns with the hash: %v", mappedColumns)
	}
}

func TestWithoutNIK(t *testing.T) {
	m := Map(row("000130", "Hadi", "L", "", "", "3374010101910003"), today)
	n := m.WithoutNIK("duplicate_nik")
	if n.HasNIK() || !m.HasNIK() || reasons(n)["duplicate_nik"] != "partial:no_ktp" || len(m.Issues) != 0 {
		t.Errorf("WithoutNIK: %+v / original %+v", n, m)
	}
}
