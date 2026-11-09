package rules

import "strings"

// Claim readiness (ADR-SVC-006 Decision 6, owner decisions O-1 to O-4 of 2026-11-09). An internal checklist for
// casemix staff: it points at gaps, never proposes a code and never says an insurer will accept a claim.
// Version 2 (ADR-SVC-007): the SEP of a BPJS visit is read from `bridging_sep` (v1 reported it as not connected).
// Version 3 (ADR-SVC-007 B-4): two more SEP checks, the service type matches the care setting and an inpatient SEP has
// its discharge date.

// Rule ids of claim-readiness v1, in evaluation order.
const (
	RuleSEPPresent              = "sep_present"
	RuleSEPServiceTypeMatches   = "sep_service_type_matches"
	RuleSEPDischargeDate        = "sep_discharge_date_recorded"
	RulePrimaryDiagnosisCoded   = "primary_diagnosis_coded"
	RuleDischargeSummaryPresent = "discharge_summary_present"
	RuleDiagnosisMatchesSummary = "primary_diagnosis_matches_summary"
	RuleDoctorProceduresCoded   = "doctor_procedures_coded"
	RuleLengthOfStayRecorded    = "length_of_stay_recorded"
	RuleDischargeStatusRecorded = "discharge_status_recorded"
)

var ClaimReadiness = RuleSet{
	ID: "claim-readiness", Version: 3, ResourceTypes: []string{ResourceEncounter}, MaxReferences: 1,
	Rules: []string{RuleSEPPresent, RuleSEPServiceTypeMatches, RuleSEPDischargeDate, RulePrimaryDiagnosisCoded,
		RuleDischargeSummaryPresent, RuleDiagnosisMatchesSummary, RuleDoctorProceduresCoded, RuleLengthOfStayRecorded,
		RuleDischargeStatusRecorded},
}

// Visit is the normalized input of claim readiness, taken from one visit timeline (clinical-timeline-v1).
type Visit struct {
	CareSetting          string // inpatient, outpatient or unknown
	PayerCode            string // as stored; "" when not recorded
	Diagnoses            []Diagnosis
	HasDischargeSummary  bool
	SummaryMainDiagnosis string     // code in the discharge summary; "" when not recorded
	CodedProcedures      int        // ICD-9-CM procedures coded for the visit
	DoctorProcedures     int        // billed actions performed by a doctor, alone or with a nurse
	RoomStays            []RoomStay // time order, undated last
	Truncated            []string   // timeline sections that hit their row cap
	SEPs                 []SEP      // SEPs of the visit (bridging_sep), oldest first; "sep" in Truncated when cut
}

type SEP struct {
	ServiceType       string // as recorded: "1" inpatient, "2" outpatient (BPJS)
	DischargeRecorded bool
}

type Diagnosis struct {
	Code     string
	Priority int
}

type RoomStay struct {
	LengthOfStay    *string // nil when not recorded
	DischargeStatus *string // nil when not recorded ("" and "-" are not recorded)
}

// noClaimPayers have no claim to prepare (owner decision 2026-11-09): not recorded, UMU and KRX.
var noClaimPayers = map[string]bool{"": true, "-": true, "UMU": true, "KRX": true}

func normCode(s string) string { return strings.ToUpper(strings.TrimSpace(s)) }

// EvaluateClaimReadiness applies claim-readiness v1 to one visit. Same input, same outcome.
func EvaluateClaimReadiness(v Visit) Outcome {
	payer := normCode(v.PayerCode)
	if noClaimPayers[payer] {
		o := finish([]Finding{}, nil, v.Truncated)
		o.Status = StatusNotApplicable
		reason := ReasonPayerNotClaimable
		o.Applicability = Applicability{Applies: false, Reason: &reason}
		return o
	}
	var findings []Finding
	if payer == "BPJ" {
		findings = append(findings, sepFindings(v)...)
	}

	primary, hasPrimary := primaryDiagnosis(v.Diagnoses)
	if hasPrimary {
		findings = append(findings, finding(RulePrimaryDiagnosisCoded, Passed, Error, "", "summary.diagnoses"))
	} else {
		findings = append(findings, finding(RulePrimaryDiagnosisCoded, Failed, Error, ReasonMissing, "summary.diagnoses"))
	}

	// inpatientOnly answers rules that apply to inpatient stays; ok=false means the rule is already decided.
	inpatientOnly := func(id, severity string, fields ...string) (Finding, bool) {
		switch v.CareSetting {
		case "inpatient":
			return Finding{}, true
		case "outpatient":
			return finding(id, NotApplicable, severity, ReasonOutpatient, fields...), false
		}
		return finding(id, NotEvaluated, severity, ReasonCareSettingUnknown, fields...), false
	}

	fields := []string{"summary.discharge_summary"}
	if f, ok := inpatientOnly(RuleDischargeSummaryPresent, Error, fields...); !ok {
		findings = append(findings, f)
	} else if v.HasDischargeSummary {
		findings = append(findings, finding(RuleDischargeSummaryPresent, Passed, Error, "", fields...))
	} else {
		findings = append(findings, finding(RuleDischargeSummaryPresent, Failed, Error, ReasonMissing, fields...))
	}

	fields = []string{"summary.discharge_summary.main_diagnosis.code", "summary.diagnoses"}
	switch f, ok := inpatientOnly(RuleDiagnosisMatchesSummary, Warning, fields...); {
	case !ok:
		findings = append(findings, f)
	case !v.HasDischargeSummary || !hasPrimary:
		findings = append(findings, finding(RuleDiagnosisMatchesSummary, NotEvaluated, Warning, ReasonPrerequisiteFailed, fields...))
	case normCode(v.SummaryMainDiagnosis) == "":
		findings = append(findings, finding(RuleDiagnosisMatchesSummary, Failed, Warning, ReasonMissing, fields...))
	case normCode(v.SummaryMainDiagnosis) == normCode(primary.Code):
		findings = append(findings, finding(RuleDiagnosisMatchesSummary, Passed, Warning, "", fields...))
	default:
		findings = append(findings, finding(RuleDiagnosisMatchesSummary, Failed, Warning, ReasonMismatch, fields...))
	}

	fields = []string{"summary.coded_procedures", "entries.procedure.performed_by"}
	switch {
	case v.DoctorProcedures > 0 && v.CodedProcedures > 0:
		findings = append(findings, finding(RuleDoctorProceduresCoded, Passed, Warning, "", fields...))
	case v.DoctorProcedures > 0:
		findings = append(findings, finding(RuleDoctorProceduresCoded, Failed, Warning, ReasonMissing, fields...))
	case truncatedPrefix(v.Truncated, "procedure_"):
		findings = append(findings, finding(RuleDoctorProceduresCoded, NotEvaluated, Warning, ReasonSectionTruncated, fields...))
	default:
		findings = append(findings, finding(RuleDoctorProceduresCoded, NotApplicable, Warning, ReasonNoDoctorProcedures, fields...))
	}

	// Length of stay and discharge status come from the last room stay, the one the patient left from (O-2).
	for _, r := range []struct {
		id, field string
		value     func(RoomStay) *string
	}{
		{RuleLengthOfStayRecorded, "entries.room_stay.length_of_stay", func(s RoomStay) *string { return s.LengthOfStay }},
		{RuleDischargeStatusRecorded, "entries.room_stay.discharge_status", func(s RoomStay) *string { return s.DischargeStatus }},
	} {
		f, ok := inpatientOnly(r.id, Error, r.field)
		switch {
		case !ok:
		case truncatedPrefix(v.Truncated, "room_stay"):
			f = finding(r.id, NotEvaluated, Error, ReasonSectionTruncated, r.field)
		case len(v.RoomStays) == 0 || recorded(r.value(v.RoomStays[len(v.RoomStays)-1])) == "":
			f = finding(r.id, Failed, Error, ReasonMissing, r.field)
		default:
			f = finding(r.id, Passed, Error, "", r.field)
		}
		findings = append(findings, f)
	}
	return finish(findings, nil, v.Truncated)
}

// sepServiceType is the SEP service type a care setting needs (BPJS jnspelayanan).
var sepServiceType = map[string]string{"inpatient": "1", "outpatient": "2"}

// sepFindings are the SEP checks of a BPJS visit: an SEP exists; one of them is for the visit's care setting; for an
// inpatient stay, the latest inpatient SEP has its discharge date (sent to BPJS when the patient goes home).
func sepFindings(v Visit) []Finding {
	present := []string{"summary.sep"}
	typeFields := []string{"summary.sep.service_type", "summary.care_setting"}
	dischargeFields := []string{"summary.sep.discharged_at"}
	if len(v.SEPs) == 0 {
		discharge := finding(RuleSEPDischargeDate, NotEvaluated, Error, ReasonPrerequisiteFailed, dischargeFields...)
		if v.CareSetting == "outpatient" {
			discharge = finding(RuleSEPDischargeDate, NotApplicable, Error, ReasonOutpatient, dischargeFields...)
		}
		return []Finding{
			finding(RuleSEPPresent, Failed, Error, ReasonMissing, present...),
			finding(RuleSEPServiceTypeMatches, NotEvaluated, Warning, ReasonPrerequisiteFailed, typeFields...),
			discharge,
		}
	}
	out := []Finding{finding(RuleSEPPresent, Passed, Error, "", present...)}
	cut := truncatedPrefix(v.Truncated, "sep")
	want, known := sepServiceType[v.CareSetting]
	if !known {
		return append(out,
			finding(RuleSEPServiceTypeMatches, NotEvaluated, Warning, ReasonCareSettingUnknown, typeFields...),
			finding(RuleSEPDischargeDate, NotEvaluated, Error, ReasonCareSettingUnknown, dischargeFields...))
	}
	var matching []SEP
	for _, s := range v.SEPs {
		if strings.TrimSpace(s.ServiceType) == want {
			matching = append(matching, s)
		}
	}
	switch {
	case len(matching) > 0:
		out = append(out, finding(RuleSEPServiceTypeMatches, Passed, Warning, "", typeFields...))
	case cut:
		out = append(out, finding(RuleSEPServiceTypeMatches, NotEvaluated, Warning, ReasonSectionTruncated, typeFields...))
	default:
		out = append(out, finding(RuleSEPServiceTypeMatches, Failed, Warning, ReasonMismatch, typeFields...))
	}
	switch {
	case v.CareSetting == "outpatient":
		out = append(out, finding(RuleSEPDischargeDate, NotApplicable, Error, ReasonOutpatient, dischargeFields...))
	case cut:
		// The latest inpatient SEP may be among the rows that were cut.
		out = append(out, finding(RuleSEPDischargeDate, NotEvaluated, Error, ReasonSectionTruncated, dischargeFields...))
	case len(matching) == 0:
		out = append(out, finding(RuleSEPDischargeDate, NotEvaluated, Error, ReasonPrerequisiteFailed, dischargeFields...))
	case matching[len(matching)-1].DischargeRecorded:
		out = append(out, finding(RuleSEPDischargeDate, Passed, Error, "", dischargeFields...))
	default:
		out = append(out, finding(RuleSEPDischargeDate, Failed, Error, ReasonMissing, dischargeFields...))
	}
	return out
}

// primaryDiagnosis is the diagnosis with the lowest priority number (first in read order on a tie).
func primaryDiagnosis(ds []Diagnosis) (Diagnosis, bool) {
	if len(ds) == 0 {
		return Diagnosis{}, false
	}
	best := ds[0]
	for _, d := range ds[1:] {
		if d.Priority < best.Priority {
			best = d
		}
	}
	return best, true
}

func truncatedPrefix(sections []string, prefix string) bool {
	for _, s := range sections {
		if strings.HasPrefix(s, prefix) {
			return true
		}
	}
	return false
}

func recorded(v *string) string {
	if v == nil {
		return ""
	}
	if s := strings.TrimSpace(*v); s != "-" {
		return s
	}
	return ""
}
