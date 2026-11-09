// Package clinical serves patient and encounter reads (contract clinical-read-v1, ADR-SVC-003): legacy HMS rows are read
// through package legacyhms and mapped here to HMS terms. Nothing is invented: a value the legacy HMS did not record maps
// to "" / null / "unknown". The rules match the web's previous live adapter (hms_workspace/web/src/api/livePatientApi.ts).
package clinical

import (
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"hms/services/integrations/legacyhms"
)

// Masked is a sensitive value as sent to clients: only the mask. "" means not recorded.
type Masked struct {
	Masked string `json:"masked"`
}

type PatientHit struct {
	MRN       string  `json:"mrn"`
	Name      string  `json:"name"`
	Sex       string  `json:"sex"`
	BirthDate *string `json:"birth_date"`
}

type Guarantor struct {
	PayerCode        string  `json:"payer_code"`
	MembershipNumber Masked  `json:"membership_number"`
	Employer         *string `json:"employer"`
}

type ResponsiblePerson struct {
	Name         string `json:"name"`
	Relationship string `json:"relationship"`
	Occupation   string `json:"occupation"`
	Address      Masked `json:"address"`
}

type Patient struct {
	MRN               string            `json:"mrn"`
	Name              string            `json:"name"`
	Sex               string            `json:"sex"`
	BirthDate         *string           `json:"birth_date"`
	BirthPlace        string            `json:"birth_place"`
	MotherName        string            `json:"mother_name"`
	BloodType         string            `json:"blood_type"`
	MaritalStatus     *string           `json:"marital_status"`
	Religion          string            `json:"religion"`
	Education         string            `json:"education"`
	Occupation        string            `json:"occupation"`
	FirstRegisteredOn *string           `json:"first_registered_on"`
	NIK               Masked            `json:"nik"`
	Phone             Masked            `json:"phone"`
	Email             Masked            `json:"email"`
	Address           Masked            `json:"address"`
	Guarantor         Guarantor         `json:"guarantor"`
	ResponsiblePerson ResponsiblePerson `json:"responsible_person"`
}

type Status struct {
	Code   *string `json:"code"`
	System string  `json:"system"`
}

type Encounter struct {
	Number       string  `json:"encounter_number"`
	QueueNumber  *string `json:"queue_number"`
	PatientMRN   *string `json:"patient_mrn"`
	RegisteredAt *string `json:"registered_at"`
	CareSetting  string  `json:"care_setting"`
	Status       Status  `json:"status"`
	PayerCode    *string `json:"payer_code"`
}

// UsedPayer is one payer used on a patient's visits, with those visits latest first.
type UsedPayer struct {
	Code        string      `json:"code"`
	Name        *string     `json:"name"`
	LastVisitAt *string     `json:"last_visit_at"`
	VisitCount  int         `json:"visit_count"`
	Encounters  []Encounter `json:"encounters"`
}

// PayerHistory groups a patient's visits by payer; payers are ordered by their latest visit.
type PayerHistory struct {
	Payers    []UsedPayer `json:"payers"`
	Truncated bool        `json:"truncated"`
}

const statusSystem = "legacy-hms:reg_periksa.stts"

var dashes = regexp.MustCompile(`^-+$`)

// Clean trims a stored text; the legacy HMS writes "-" for unknown, which means not recorded.
func Clean(v *string) string {
	if v == nil {
		return ""
	}
	s := strings.TrimSpace(*v)
	if dashes.MatchString(s) {
		return ""
	}
	return s
}

func optional(v *string) *string {
	if s := Clean(v); s != "" {
		return &s
	}
	return nil
}

var storedDate = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})`)

// ValidDate returns a real calendar date (YYYY-MM-DD, year >= 1800) or nil; "0000-00-00" means unknown.
func ValidDate(v *string) *string {
	if v == nil {
		return nil
	}
	m := storedDate.FindString(*v)
	if m == "" {
		return nil
	}
	t, err := time.Parse("2006-01-02", m)
	if err != nil || t.Year() < 1800 {
		return nil
	}
	return &m
}

func sex(v *string) string {
	switch Clean(v) {
	case "L":
		return "male"
	case "P":
		return "female"
	}
	return "unknown"
}

var (
	marital = map[string]string{
		"BELUM MENIKAH": "single", "JOMBLO": "single", "MENIKAH": "married",
		"JANDA": "widowed_divorced", "DUDHA": "widowed_divorced",
	}
	education = map[string]string{
		"TS": "TS", "TK": "TK", "SD": "SD", "SMP": "SMP", "SMA": "SMA", "SLTA/SEDERAJAT": "SLTA",
		"D1": "D1", "D2": "D2", "D3": "D3", "D4": "D4", "S1": "S1", "S2": "S2", "S3": "S3",
	}
	relationship = map[string]string{
		"AYAH": "father", "IBU": "mother", "ISTRI": "wife", "SUAMI": "husband", "SAUDARA": "sibling", "ANAK": "child",
	}
)

// MaskEnds keeps `head` and `tail` characters and hides the rest; short values are hidden entirely.
func MaskEnds(v string, head, tail int) string {
	r := []rune(v)
	if len(r) <= head+tail {
		return strings.Repeat("•", len(r))
	}
	return string(r[:head]) + strings.Repeat("•", len(r)-head-tail) + string(r[len(r)-tail:])
}

func maskEmail(v string) string {
	at := strings.IndexRune(v, '@')
	if at < 1 {
		return strings.Repeat("•", utf8.RuneCountInString(v))
	}
	keep := min(2, utf8.RuneCountInString(v[:at]))
	return string([]rune(v)[:keep]) + "••••" + v[at:]
}

// maskAddress shows the start of the line only. A line of 8 characters or fewer is hidden entirely (the previous web
// rule showed it in full).
func maskAddress(v string) string {
	r := []rune(v)
	if len(r) <= 8 {
		return strings.Repeat("•", len(r))
	}
	return string(r[:8]) + "•••"
}

func mask(v *string, show func(string) string) Masked {
	if s := Clean(v); s != "" {
		return Masked{Masked: show(s)}
	}
	return Masked{}
}

func nikMask(s string) string        { return MaskEnds(s, 4, 4) }
func phoneMask(s string) string      { return MaskEnds(s, 4, 4) }
func membershipMask(s string) string { return MaskEnds(s, 4, 3) }

// MapPatient maps a stored `pasien` row; sensitive values are masked.
func MapPatient(r legacyhms.PatientRow) Patient {
	p := Patient{
		MRN:               Clean(r.MRN),
		Name:              Clean(r.Name),
		Sex:               sex(r.Sex),
		BirthDate:         ValidDate(r.BirthDate),
		BirthPlace:        Clean(r.BirthPlace),
		MotherName:        Clean(r.MotherName),
		BloodType:         "unknown",
		Religion:          Clean(r.Religion),
		Education:         "none",
		Occupation:        Clean(r.Occupation),
		FirstRegisteredOn: ValidDate(r.FirstRegistered),
		NIK:               mask(r.NIK, nikMask),
		Phone:             mask(r.Phone, phoneMask),
		Email:             mask(r.Email, maskEmail),
		Address:           mask(r.Address, maskAddress),
		Guarantor: Guarantor{
			PayerCode:        Clean(r.PayerCode),
			MembershipNumber: mask(r.MembershipNo, membershipMask),
			Employer:         optional(r.Employer),
		},
		ResponsiblePerson: ResponsiblePerson{
			Name:         Clean(r.ResponsibleName),
			Relationship: "unknown",
			Occupation:   Clean(r.ResponsibleOccupation),
			Address:      mask(r.ResponsibleAddress, maskAddress),
		},
	}
	switch bt := Clean(r.BloodType); bt {
	case "A", "B", "O", "AB":
		p.BloodType = bt
	}
	if m, ok := marital[Clean(r.MaritalStatus)]; ok {
		p.MaritalStatus = &m
	}
	if e, ok := education[Clean(r.Education)]; ok {
		p.Education = e
	}
	if rel, ok := relationship[Clean(r.Relationship)]; ok {
		p.ResponsiblePerson.Relationship = rel
	}
	return p
}

func MapHit(r legacyhms.PatientHitRow) PatientHit {
	return PatientHit{MRN: Clean(r.MRN), Name: Clean(r.Name), Sex: sex(r.Sex), BirthDate: ValidDate(r.BirthDate)}
}

var storedTime = regexp.MustCompile(`^(\d{2}):(\d{2}):(\d{2})`)

// MapEncounter maps a stored `reg_periksa` row. The registration date and time are hospital local time, so they are
// returned with the facility's offset (loc).
func MapEncounter(r legacyhms.EncounterRow, loc *time.Location) Encounter {
	e := Encounter{
		Number:      Clean(r.Number),
		QueueNumber: optional(r.Queue),
		PatientMRN:  optional(r.MRN),
		CareSetting: "unknown",
		Status:      Status{Code: optional(r.Status), System: statusSystem},
		PayerCode:   optional(r.PayerCode),
	}
	switch Clean(r.CareSetting) {
	case "Ralan":
		e.CareSetting = "outpatient"
	case "Ranap":
		e.CareSetting = "inpatient"
	}
	if d := ValidDate(r.RegDate); d != nil && r.RegTime != nil {
		if tm := storedTime.FindString(*r.RegTime); tm != "" {
			if t, err := time.ParseInLocation("2006-01-02 15:04:05", *d+" "+tm, loc); err == nil {
				s := t.Format(time.RFC3339)
				e.RegisteredAt = &s
			}
		}
	}
	return e
}

// MapPayerHistory groups visit rows (already latest first) by payer code, keeping that order: the first visit seen for a
// payer is its latest, so payers come out ordered by their latest visit. A visit with no payer code is grouped under
// code "" (not recorded). The name is `penjab.png_jawab`, null when the code has no `penjab` row.
func MapPayerHistory(mrn string, rows []legacyhms.PayerVisitRow, truncated bool, loc *time.Location) PayerHistory {
	out := PayerHistory{Payers: []UsedPayer{}, Truncated: truncated}
	index := map[string]int{}
	for _, v := range rows {
		code := Clean(v.PayerCode)
		e := MapEncounter(legacyhms.EncounterRow{Number: v.Number, MRN: &mrn, RegDate: v.RegDate, RegTime: v.RegTime,
			CareSetting: v.CareSetting, Status: v.Status, PayerCode: v.PayerCode}, loc)
		i, seen := index[code]
		if !seen {
			i = len(out.Payers)
			index[code] = i
			out.Payers = append(out.Payers, UsedPayer{Code: code, Name: optional(v.PayerName), LastVisitAt: e.RegisteredAt})
		}
		p := &out.Payers[i]
		p.VisitCount++
		p.Encounters = append(p.Encounters, e)
		if p.LastVisitAt == nil {
			p.LastVisitAt = e.RegisteredAt // the latest visit had no valid date; keep the latest dated one
		}
	}
	return out
}

// IdentifierKinds are the values a reveal may return, one at a time.
var IdentifierKinds = []string{"nik", "phone", "email", "address", "membership_number", "responsible_address"}

// Identifier returns one cleaned sensitive value ("" = not recorded).
func Identifier(r legacyhms.IdentifierRow, kind string) string {
	switch kind {
	case "nik":
		return Clean(r.NIK)
	case "phone":
		return Clean(r.Phone)
	case "email":
		return Clean(r.Email)
	case "address":
		return Clean(r.Address)
	case "membership_number":
		return Clean(r.MembershipNo)
	case "responsible_address":
		return Clean(r.ResponsibleAddress)
	}
	return ""
}
