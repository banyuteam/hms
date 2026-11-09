package clinical

import (
	"testing"
	"time"

	"hms/services/integrations/legacyhms"
)

func s(v string) *string { return &v }

// Synthetic row; expected values are the web's previous adapter tests (livePatientApi.test.ts).
func row() legacyhms.PatientRow {
	return legacyhms.PatientRow{
		MRN: s("000001"), Name: s("  Pasien Contoh "), Sex: s("P"), BirthPlace: s("Semarang"), BirthDate: s("1985-02-10"),
		BloodType: s("O"), MaritalStatus: s("MENIKAH"), Religion: s("ISLAM"), Education: s("SLTA/SEDERAJAT"),
		Occupation: s("Guru"), FirstRegistered: s("2010-05-01"), MotherName: s("-"), NIK: s("3273010210850002"),
		Phone: s("081234563344"), Email: s("contoh@example.com"), Address: s("Jl. Melati No. 12"), PayerCode: s("BPJ"),
		MembershipNo: s("0001234567890"), Employer: s("-"), Relationship: s("SUAMI"), ResponsibleName: s("Wali Contoh"),
		ResponsibleOccupation: s("Swasta"), ResponsibleAddress: s("Jl. Mawar No. 3"),
	}
}

func TestMapPatientMasksAndCleans(t *testing.T) {
	p := MapPatient(row())
	want := map[string]string{
		"name": p.Name, "sex": p.Sex, "nik": p.NIK.Masked, "phone": p.Phone.Masked, "email": p.Email.Masked,
		"address": p.Address.Masked, "membership": p.Guarantor.MembershipNumber.Masked, "payer": p.Guarantor.PayerCode,
		"mother": p.MotherName, "relationship": p.ResponsiblePerson.Relationship, "blood": p.BloodType, "education": p.Education,
	}
	for k, v := range map[string]string{
		"name": "Pasien Contoh", "sex": "female", "nik": "3273••••••••0002", "phone": "0812••••3344",
		"email": "co••••@example.com", "address": "Jl. Mela•••", "membership": "0001••••••890", "payer": "BPJ",
		"mother": "", "relationship": "husband", "blood": "O", "education": "SLTA",
	} {
		if want[k] != v {
			t.Errorf("%s = %q, want %q", k, want[k], v)
		}
	}
	if p.Guarantor.Employer != nil {
		t.Error(`"-" employer must be null (not recorded)`)
	}
	if p.BirthDate == nil || *p.BirthDate != "1985-02-10" || p.MaritalStatus == nil || *p.MaritalStatus != "married" {
		t.Errorf("birth date %v marital %v", p.BirthDate, p.MaritalStatus)
	}
}

func TestMapPatientInventsNothing(t *testing.T) {
	p := MapPatient(legacyhms.PatientRow{MRN: s("000002"), BirthDate: s("0000-00-00"), NIK: s("  - "), Sex: s("X")})
	if p.Sex != "unknown" || p.BirthDate != nil || p.NIK.Masked != "" || p.BloodType != "unknown" ||
		p.Education != "none" || p.MaritalStatus != nil || p.ResponsiblePerson.Relationship != "unknown" {
		t.Errorf("unexpected values: %+v", p)
	}
	for _, d := range []string{"1985-02-30", "1700-01-01", "abc"} {
		if ValidDate(&d) != nil {
			t.Errorf("%s accepted as a date", d)
		}
	}
	if MapPatient(legacyhms.PatientRow{Relationship: s("LAIN")}).ResponsiblePerson.Relationship != "unknown" {
		t.Error("unlisted relationship must be unknown")
	}
	for raw, want := range map[string]string{"BELUM MENIKAH": "single", "JOMBLO": "single", "JANDA": "widowed_divorced", "DUDHA": "widowed_divorced"} {
		if got := MapPatient(legacyhms.PatientRow{MaritalStatus: s(raw)}).MaritalStatus; got == nil || *got != want {
			t.Errorf("marital %s -> %v", raw, got)
		}
	}
}

func TestMasks(t *testing.T) {
	cases := []struct{ got, want string }{
		{MaskEnds("12345678", 4, 4), "••••••••"},
		{MaskEnds("123456789", 4, 4), "1234•6789"},
		{maskEmail("x@example.com"), "x••••@example.com"},
		{maskEmail("@nodomain"), "•••••••••"},
		{maskAddress("Jl. Mawar"), "Jl. Mawa•••"},
		{maskAddress("Jl. A 1"), "•••••••"}, // short: hidden entirely (the old rule showed it)
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
}

func TestMapEncounterLocalTime(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		t.Fatal(err)
	}
	e := MapEncounter(legacyhms.EncounterRow{Number: s("2026/10/26/000123"), Queue: s("004"), MRN: s("000001"),
		RegDate: s("2026-10-26"), RegTime: s("08:15:00"), CareSetting: s("Ralan"), Status: s("Sudah"), PayerCode: s("BPJ")}, loc)
	if e.RegisteredAt == nil || *e.RegisteredAt != "2026-10-26T08:15:00+07:00" || e.CareSetting != "outpatient" ||
		e.Status.Code == nil || *e.Status.Code != "Sudah" || e.Status.System != "legacy-hms:reg_periksa.stts" {
		t.Errorf("unexpected encounter %+v", e)
	}
	in := MapEncounter(legacyhms.EncounterRow{Number: s("2026/10/27/000001"), RegDate: s("0000-00-00"), RegTime: s("10:00:00"),
		CareSetting: s("Ranap")}, loc)
	if in.RegisteredAt != nil || in.CareSetting != "inpatient" || in.Status.Code != nil || in.QueueNumber != nil {
		t.Errorf("unexpected encounter %+v", in)
	}
}
