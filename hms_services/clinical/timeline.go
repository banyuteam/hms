package clinical

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"hms/services/integrations/legacyhms"
)

// Visit timeline and saved bill (contract clinical-timeline-v1, ADR-SVC-004). Rows come from legacyhms.Clinical.Timeline
// and .Bill in the column order of their fixed statements; values are returned as recorded (legacy codes such as
// `kesadaran` or `stts_pulang` unchanged), only dates/times are turned into local timestamps.

type Payer struct {
	Code    string  `json:"code"`
	Name    *string `json:"name"`
	Company *string `json:"company"`
	Type    string  `json:"type"`
}

type Diagnosis struct {
	Code        string  `json:"code"`
	Name        *string `json:"name"`
	Priority    int     `json:"priority"`
	CareSetting string  `json:"care_setting"`
	Case        *string `json:"case"`
}

type CodedProcedure struct {
	Code        string  `json:"code"`
	Name        *string `json:"name"`
	Priority    int     `json:"priority"`
	CareSetting string  `json:"care_setting"`
}

type AttendingDoctor struct {
	Name     *string `json:"name"`
	Priority int     `json:"priority"`
}

type Coded struct {
	Code string  `json:"code"`
	Name *string `json:"name"`
}

type DischargeSummary struct {
	DoctorName          *string `json:"doctor_name"`
	ChiefComplaint      string  `json:"chief_complaint"`
	Course              string  `json:"course"`
	MainDiagnosis       Coded   `json:"main_diagnosis"`
	SecondaryDiagnosis  Coded   `json:"secondary_diagnosis"`
	MainProcedure       Coded   `json:"main_procedure"`
	Allergy             string  `json:"allergy"`
	Condition           string  `json:"condition"`
	DischargeMethod     string  `json:"discharge_method"`
	DischargeMedication string  `json:"discharge_medication"`
	Diet                string  `json:"diet"`
	Education           string  `json:"education"`
	Control             *string `json:"control"`
}

// SEP is one Surat Eligibilitas Peserta of a BPJS visit (legacy `bridging_sep`, ADR-SVC-007; decision B-1: the
// number is sent in full inside the audited timeline read). Codes are returned as recorded.
type SEP struct {
	Number            string  `json:"number"`
	Date              *string `json:"date"`
	ServiceType       *string `json:"service_type"` // jnspelayanan: '1' inpatient, '2' outpatient (BPJS)
	Class             *string `json:"class"`
	ReferralNumber    *string `json:"referral_number"`
	ReferringFacility *string `json:"referring_facility"`
	InitialDiagnosis  Coded   `json:"initial_diagnosis"`
	DestinationClinic *string `json:"destination_clinic"`
	DPJPName          *string `json:"dpjp_name"`
	DischargedAt      *string `json:"discharged_at"`
	COB               *string `json:"cob"`
	Suplesi           *string `json:"suplesi"`
	SuplesiSEPNumber  *string `json:"suplesi_sep_number"`
}

type TimelineSummary struct {
	CareSetting      string            `json:"care_setting"`
	Status           Status            `json:"status"`
	Payer            Payer             `json:"payer"`
	Diagnoses        []Diagnosis       `json:"diagnoses"`
	CodedProcedures  []CodedProcedure  `json:"coded_procedures"`
	AttendingDoctors []AttendingDoctor `json:"attending_doctors"`
	DischargeSummary *DischargeSummary `json:"discharge_summary"`
	SEP              []SEP             `json:"sep"`
}

// Entry is one timeline entry: `type`, `at` and the fields of its type (see the contract).
type Entry map[string]any

type Timeline struct {
	Number     string          `json:"encounter_number"`
	PatientMRN *string         `json:"patient_mrn"`
	Summary    TimelineSummary `json:"summary"`
	Entries    []Entry         `json:"entries"`
	Truncated  []string        `json:"truncated"`
}

// col returns column i of a row (nil when absent).
func col(r []*string, i int) *string {
	if i < len(r) {
		return r[i]
	}
	return nil
}

func text(r []*string, i int) string { return Clean(col(r, i)) }
func opt(r []*string, i int) *string { return optional(col(r, i)) }
func integer(r []*string, i int) int { n, _ := strconv.Atoi(Clean(col(r, i))); return n }
func careSetting(v *string) string   { return careSettings[strings.ToLower(Clean(v))] }
func rowStamp(r []*string, d, t int, loc *time.Location) *time.Time {
	return LocalTime(col(r, d), col(r, t), loc)
}

var careSettings = map[string]string{"ralan": "outpatient", "ranap": "inpatient"}

func stamp(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

// LocalTime combines a stored date and time (hospital local time) into an instant; nil when the date is not a real
// date. A missing time means midnight. A stored DATETIME may be passed as the date with a nil time.
func LocalTime(date, clock *string, loc *time.Location) *time.Time {
	d := ValidDate(date)
	if d == nil {
		return nil
	}
	tm := "00:00:00"
	if clock == nil && len(*date) > 11 {
		clock = new(string)
		*clock = (*date)[11:]
	}
	if clock != nil {
		if m := storedTime.FindString(*clock); m != "" {
			tm = m
		}
	}
	t, err := time.ParseInLocation("2006-01-02 15:04:05", *d+" "+tm, loc)
	if err != nil {
		return nil
	}
	return &t
}

// PayerType applies the legacy rule: "-" or UMU = personal, BPJ = BPJS, anything else an insurer.
func PayerType(code string) string {
	switch strings.ToUpper(code) {
	case "", "UMU":
		return "personal"
	case "BPJ":
		return "bpjs"
	}
	return "insurer"
}

type sortable struct {
	at  *time.Time
	seq int
	e   Entry
}

type timelineBuilder struct {
	loc     *time.Location
	entries []sortable
}

func (b *timelineBuilder) add(typ string, at *time.Time, fields Entry) {
	fields["type"], fields["at"] = typ, stamp(at)
	b.entries = append(b.entries, sortable{at, len(b.entries), fields})
}

// sorted orders entries by time (undated last), keeping read order for equal times.
func (b *timelineBuilder) sorted() []Entry {
	sort.SliceStable(b.entries, func(i, j int) bool {
		a, c := b.entries[i].at, b.entries[j].at
		if a == nil || c == nil {
			return a != nil && c == nil
		}
		return a.Before(*c)
	})
	out := make([]Entry, 0, len(b.entries))
	for _, s := range b.entries {
		out = append(out, s.e)
	}
	return out
}

// MapTimeline maps the rows of legacyhms.Clinical.Timeline.
func MapTimeline(number string, rows legacyhms.SectionRows, loc *time.Location) Timeline {
	b := &timelineBuilder{loc: loc}
	tl := Timeline{Number: number, Truncated: append([]string{}, rows.Truncated...)}
	tl.Summary = TimelineSummary{CareSetting: "unknown", Status: Status{System: statusSystem},
		Diagnoses: []Diagnosis{}, CodedProcedures: []CodedProcedure{}, AttendingDoctors: []AttendingDoctor{}, SEP: []SEP{}}

	if h := rows.Rows["header"]; len(h) > 0 {
		r := h[0]
		tl.PatientMRN = opt(r, 0)
		if cs := careSetting(col(r, 1)); cs != "" {
			tl.Summary.CareSetting = cs
		}
		tl.Summary.Status.Code = opt(r, 2)
		code := text(r, 3)
		tl.Summary.Payer = Payer{Code: code, Name: opt(r, 4), Company: opt(r, 5), Type: PayerType(code)}
		b.add("registration", rowStamp(r, 7, 8, loc), Entry{
			"queue_number": opt(r, 6), "care_setting": tl.Summary.CareSetting, "status": tl.Summary.Status,
			"payer": tl.Summary.Payer, "clinic": opt(r, 9), "doctor_name": opt(r, 10),
		})
	}
	for _, r := range rows.Rows["room_stay"] {
		b.add("room_stay", rowStamp(r, 0, 1, loc), Entry{
			"room_code": text(r, 2), "room_class": opt(r, 3), "ward": opt(r, 4), "admission_diagnosis": opt(r, 5),
			"discharge_diagnosis": opt(r, 6), "discharged_at": stamp(rowStamp(r, 7, 8, loc)), "length_of_stay": opt(r, 9),
			"discharge_status": opt(r, 10),
		})
	}
	for _, s := range []struct{ section, care string }{{"clinical_note_outpatient", "outpatient"}, {"clinical_note_inpatient", "inpatient"}} {
		for _, r := range rows.Rows[s.section] {
			b.add("clinical_note", rowStamp(r, 0, 1, loc), Entry{
				"care_setting": s.care, "author_id": text(r, 2), "author_name": opt(r, 3),
				"subjective": text(r, 4), "objective": text(r, 5), "assessment": text(r, 6), "plan": text(r, 7),
				"instruction": text(r, 8), "evaluation": text(r, 9), "allergy": text(r, 10), "consciousness": opt(r, 11),
				"vitals": map[string]*string{
					"blood_pressure": opt(r, 12), "pulse": opt(r, 13), "respiration": opt(r, 14), "temperature": opt(r, 15),
					"spo2": opt(r, 16), "gcs": opt(r, 17), "height": opt(r, 18), "weight": opt(r, 19),
				},
			})
		}
	}
	for _, p := range legacyhms.ProcedureSources {
		for _, r := range rows.Rows["procedure_"+p.Table] {
			b.add("procedure", rowStamp(r, 0, 1, loc), Entry{
				"care_setting": p.CareSetting, "performed_by": p.PerformedBy, "code": text(r, 2), "name": opt(r, 3),
				"doctor_name": opt(r, 4), "staff_name": opt(r, 5),
			})
		}
	}
	mapLab(b, rows)
	for _, r := range rows.Rows["radiology_exam"] {
		b.add("radiology_exam", rowStamp(r, 0, 1, loc), Entry{
			"code": text(r, 2), "name": opt(r, 3), "care_setting": careSetting(col(r, 4)), "doctor_name": opt(r, 5),
			"referring_doctor_name": opt(r, 6), "radiographer_name": opt(r, 7), "projection": text(r, 8),
		})
	}
	for _, r := range rows.Rows["radiology_report"] {
		b.add("radiology_report", rowStamp(r, 0, 1, loc), Entry{"text": text(r, 2)})
	}
	mapPrescriptions(b, rows)
	for _, r := range rows.Rows["medication_given"] {
		b.add("medication_given", rowStamp(r, 0, 1, loc), Entry{
			"drug_code": text(r, 2), "drug_name": opt(r, 3), "quantity": text(r, 4), "unit": opt(r, 5), "batch": text(r, 6),
			"ward": opt(r, 7), "care_setting": careSetting(col(r, 8)), "instructions": opt(r, 9),
		})
	}
	for _, r := range rows.Rows["surgery"] {
		b.add("surgery", LocalTime(col(r, 0), nil, loc), Entry{
			"name": opt(r, 1), "operator_name": opt(r, 2), "anesthesiologist_name": opt(r, 3), "anesthesia": text(r, 4),
			"category": text(r, 5), "care_setting": careSetting(col(r, 6)),
		})
	}
	for _, r := range rows.Rows["surgery_report"] {
		b.add("surgery_report", LocalTime(col(r, 0), nil, loc), Entry{
			"preoperative_diagnosis": text(r, 1), "postoperative_diagnosis": text(r, 2), "report": text(r, 3),
			"bleeding": text(r, 4), "complication": text(r, 5), "finished_at": stamp(LocalTime(col(r, 6), nil, loc)),
		})
	}
	mapAdmissionAndEmergency(b, rows)
	mapSummary(&tl.Summary, rows)
	// Column order: legacyhms.SEPColumns.
	for _, r := range rows.Rows["sep"] {
		tl.Summary.SEP = append(tl.Summary.SEP, SEP{
			Number: text(r, 0), Date: ValidDate(col(r, 1)), ServiceType: opt(r, 2), Class: opt(r, 3),
			ReferralNumber: opt(r, 4), ReferringFacility: opt(r, 5), InitialDiagnosis: Coded{Code: text(r, 6), Name: opt(r, 7)},
			DestinationClinic: opt(r, 8), DPJPName: opt(r, 9), DischargedAt: stamp(LocalTime(col(r, 10), nil, loc)),
			COB: opt(r, 11), Suplesi: opt(r, 12), SuplesiSEPNumber: opt(r, 13),
		})
	}
	tl.Entries = b.sorted()
	return tl
}

// mapAdmissionAndEmergency maps the admission order (perintah_ranap) and the emergency medical assessment
// (penilaian_medis_igd), one row each per visit. The admission order stores a date without a time: it is placed at
// 00:00 of that date (owner decision 2026-11-11) and says so with `time_recorded: false`, so no client reads 00:00 as
// a recorded time. Coded values (kesadaran, the body-region results, cara_keluar …) are returned as recorded.
func mapAdmissionAndEmergency(b *timelineBuilder, rows legacyhms.SectionRows) {
	for _, r := range rows.Rows["admission_order"] {
		b.add("admission_order", LocalTime(col(r, 0), nil, b.loc), Entry{
			"time_recorded": false, "room_code": text(r, 1), "ward": opt(r, 2), "room_class": opt(r, 3),
			"diagnosis": opt(r, 4), "note": opt(r, 5), "dpjp_name": opt(r, 6),
		})
	}
	for _, r := range rows.Rows["emergency_assessment"] {
		b.add("emergency_assessment", LocalTime(col(r, 0), nil, b.loc), Entry{
			"doctor_name": opt(r, 1), "history_source": text(r, 2), "informant_relationship": text(r, 3),
			"chief_complaint": text(r, 4), "present_illness": text(r, 5), "past_illness": text(r, 6),
			"family_history": text(r, 7), "medication_history": text(r, 8), "allergy": text(r, 9),
			"general_condition": text(r, 10), "consciousness": opt(r, 12),
			"vitals": map[string]*string{
				"blood_pressure": opt(r, 13), "pulse": opt(r, 14), "respiration": opt(r, 15), "temperature": opt(r, 16),
				"spo2": opt(r, 17), "gcs": opt(r, 11), "weight": opt(r, 18), "height": opt(r, 19),
			},
			"physical_exam": map[string]*string{
				"head": opt(r, 20), "eyes": opt(r, 21), "teeth": opt(r, 22), "neck": opt(r, 23), "thorax": opt(r, 24),
				"abdomen": opt(r, 25), "genitals": opt(r, 26), "extremities": opt(r, 27),
			},
			"physical_findings": text(r, 28), "local_findings": text(r, 29), "ecg": text(r, 30), "radiology": text(r, 31),
			"laboratory": text(r, 32), "diagnosis": text(r, 33), "management": text(r, 34), "disposition": text(r, 35),
			"disposition_detail": text(r, 36), "indication": text(r, 37),
		})
	}
}

func mapLab(b *timelineBuilder, rows legacyhms.SectionRows) {
	// Result lines attach to their test by the shared legacy key (date, time, test code).
	key := func(r []*string) string { return text(r, 0) + "|" + text(r, 1) + "|" + text(r, 2) }
	results := map[string][]map[string]any{}
	for _, r := range rows.Rows["lab_result"] {
		results[key(r)] = append(results[key(r)], map[string]any{
			"template_id": integer(r, 3), "item": opt(r, 4), "value": text(r, 5), "reference_range": text(r, 6),
			"unit": opt(r, 7), "note": text(r, 8),
		})
	}
	for _, r := range rows.Rows["lab_test"] {
		lines := results[key(r)]
		if lines == nil {
			lines = []map[string]any{}
		}
		b.add("lab_test", rowStamp(r, 0, 1, b.loc), Entry{
			"code": text(r, 2), "name": opt(r, 3), "category": text(r, 4), "care_setting": careSetting(col(r, 5)),
			"doctor_name": opt(r, 6), "referring_doctor_name": opt(r, 7), "analyst_name": opt(r, 8), "results": lines,
		})
	}
}

func mapPrescriptions(b *timelineBuilder, rows legacyhms.SectionRows) {
	items, compounds := map[string][]map[string]any{}, map[string][]map[string]any{}
	for _, r := range rows.Rows["prescription_item"] {
		items[text(r, 0)] = append(items[text(r, 0)], map[string]any{
			"drug_code": text(r, 1), "drug_name": opt(r, 2), "quantity": text(r, 3), "unit": opt(r, 4), "instructions": text(r, 5),
		})
	}
	for _, r := range rows.Rows["prescription_compound"] {
		compounds[text(r, 0)] = append(compounds[text(r, 0)], map[string]any{
			"number": text(r, 1), "name": text(r, 2), "quantity": text(r, 3), "instructions": text(r, 4), "note": text(r, 5),
		})
	}
	nonNil := func(v []map[string]any) []map[string]any {
		if v == nil {
			return []map[string]any{}
		}
		return v
	}
	for _, r := range rows.Rows["prescription"] {
		no := text(r, 0)
		prescribed := rowStamp(r, 1, 2, b.loc)
		at := prescribed
		if at == nil {
			at = rowStamp(r, 3, 4, b.loc)
		}
		b.add("prescription", at, Entry{
			"number": no, "prescribed_at": stamp(prescribed), "dispensed_at": stamp(rowStamp(r, 5, 6, b.loc)),
			"care_setting": careSetting(col(r, 7)), "doctor_name": opt(r, 8),
			"items": nonNil(items[no]), "compounds": nonNil(compounds[no]),
		})
	}
}

func mapSummary(s *TimelineSummary, rows legacyhms.SectionRows) {
	cases := map[string]string{"baru": "new", "lama": "existing"}
	for _, r := range rows.Rows["diagnosis"] {
		d := Diagnosis{Code: text(r, 0), Name: opt(r, 1), CareSetting: careSetting(col(r, 2)), Priority: integer(r, 3)}
		if c, ok := cases[strings.ToLower(text(r, 4))]; ok {
			d.Case = &c
		}
		s.Diagnoses = append(s.Diagnoses, d)
	}
	for _, r := range rows.Rows["coded_procedure"] {
		s.CodedProcedures = append(s.CodedProcedures, CodedProcedure{
			Code: text(r, 0), Name: opt(r, 1), CareSetting: careSetting(col(r, 2)), Priority: integer(r, 3)})
	}
	for _, r := range rows.Rows["attending_doctor"] {
		s.AttendingDoctors = append(s.AttendingDoctors, AttendingDoctor{Name: opt(r, 0), Priority: integer(r, 1)})
	}
	if d := rows.Rows["discharge_summary"]; len(d) > 0 {
		r := d[0]
		s.DischargeSummary = &DischargeSummary{
			DoctorName: opt(r, 0), ChiefComplaint: text(r, 1), Course: text(r, 2),
			MainDiagnosis:      Coded{Code: text(r, 3), Name: opt(r, 4)},
			SecondaryDiagnosis: Coded{Code: text(r, 5), Name: opt(r, 6)},
			MainProcedure:      Coded{Code: text(r, 7), Name: opt(r, 8)},
			Allergy:            text(r, 9), Condition: text(r, 10), DischargeMethod: text(r, 11),
			DischargeMedication: text(r, 12), Diet: text(r, 13), Education: text(r, 14), Control: opt(r, 15),
		}
	}
}
