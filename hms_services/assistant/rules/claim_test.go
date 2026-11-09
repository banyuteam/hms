package rules

import (
	"encoding/json"
	"reflect"
	"testing"
)

func str(s string) *string { return &s }

// inpatient is a complete insurer-paid inpatient stay with one room change (synthetic).
func inpatient() Visit {
	return Visit{
		CareSetting: "inpatient", PayerCode: "A09",
		Diagnoses:           []Diagnosis{{Code: "E11.9", Priority: 2}, {Code: "I10", Priority: 1}},
		HasDischargeSummary: true, SummaryMainDiagnosis: "I10",
		CodedProcedures: 1, DoctorProcedures: 3,
		RoomStays: []RoomStay{
			{LengthOfStay: str("1"), DischargeStatus: str("Pindah Kamar")},
			{LengthOfStay: str("3"), DischargeStatus: str("Sembuh")},
		},
		Truncated: []string{},
	}
}

func results(o Outcome) map[string]string {
	m := map[string]string{}
	for _, f := range o.Findings {
		m[f.RuleID] = f.Result
		if f.Reason != nil {
			m[f.RuleID] += "/" + *f.Reason
		}
	}
	return m
}

func TestCompleteInpatientStayPasses(t *testing.T) {
	o := EvaluateClaimReadiness(inpatient())
	if o.Status != StatusComplete || !o.Applicability.Applies || !o.DataCompleteness.Complete {
		t.Fatalf("outcome %+v", o)
	}
	if o.Summary != (Summary{Passed: 6}) || len(o.Findings) != 6 {
		t.Errorf("summary %+v findings %v", o.Summary, results(o))
	}
	if _, ok := results(o)[RuleSEPPresent]; ok {
		t.Error("no SEP rule for a payer other than BPJ")
	}
	for _, f := range o.Findings {
		if f.HumanReview || f.Reason != nil {
			t.Errorf("passed finding needs no review and has no reason: %+v", f)
		}
	}
}

func TestPayersWithoutAClaimAreNotApplicable(t *testing.T) {
	for _, code := range []string{"", " ", "-", "UMU", "umu", "KRX", " krx "} {
		v := inpatient()
		v.PayerCode = code
		o := EvaluateClaimReadiness(v)
		if o.Status != StatusNotApplicable || o.Applicability.Applies || *o.Applicability.Reason != ReasonPayerNotClaimable ||
			len(o.Findings) != 0 || o.Findings == nil {
			t.Errorf("payer %q: %+v", code, o)
		}
	}
	for _, code := range []string{"BPJ", "A09", "ASR"} {
		v := inpatient()
		v.PayerCode = code
		if o := EvaluateClaimReadiness(v); !o.Applicability.Applies {
			t.Errorf("payer %q needs a claim", code)
		}
	}
}

// bpjsStay is the inpatient stay paid by BPJS with an outpatient SEP (from the clinic) and its inpatient SEP.
func bpjsStay() Visit {
	v := inpatient()
	v.PayerCode = " bpj "
	v.SEPs = []SEP{{ServiceType: "2"}, {ServiceType: "1", DischargeRecorded: true}}
	return v
}

func sepResults(v Visit) [3]string {
	r := results(EvaluateClaimReadiness(v))
	return [3]string{r[RuleSEPPresent], r[RuleSEPServiceTypeMatches], r[RuleSEPDischargeDate]}
}

func TestSEPChecksForBPJSOnly(t *testing.T) {
	o := EvaluateClaimReadiness(bpjsStay())
	if got := sepResults(bpjsStay()); got != [3]string{Passed, Passed, Passed} || o.Status != StatusComplete ||
		!o.DataCompleteness.Complete || o.Summary.Passed != 9 {
		t.Fatalf("complete BPJS stay: %v %+v", got, o.Summary)
	}
	v := bpjsStay()
	v.PayerCode = "A09"
	for _, id := range []string{RuleSEPPresent, RuleSEPServiceTypeMatches, RuleSEPDischargeDate} {
		if _, ok := results(EvaluateClaimReadiness(v))[id]; ok {
			t.Errorf("%s: SEP rows on a non-BPJS visit add no SEP check", id)
		}
	}
}

func TestNoSEP(t *testing.T) {
	v := bpjsStay()
	v.SEPs = nil
	want := [3]string{Failed + "/" + ReasonMissing, NotEvaluated + "/" + ReasonPrerequisiteFailed,
		NotEvaluated + "/" + ReasonPrerequisiteFailed}
	if got := sepResults(v); got != want {
		t.Errorf("inpatient without SEP: %v", got)
	}
	v.CareSetting = "outpatient"
	if got := sepResults(v)[2]; got != NotApplicable+"/"+ReasonOutpatient {
		t.Errorf("outpatient without SEP needs no SEP discharge date: %s", got)
	}
}

func TestSEPServiceTypeMatchesCareSetting(t *testing.T) {
	v := bpjsStay()
	v.SEPs = []SEP{{ServiceType: "2"}} // only the clinic's SEP: no inpatient SEP for the stay
	if got := sepResults(v); got != [3]string{Passed, Failed + "/" + ReasonMismatch, NotEvaluated + "/" + ReasonPrerequisiteFailed} {
		t.Errorf("inpatient stay with an outpatient SEP only: %v", got)
	}
	v.Truncated = []string{"sep"}
	if got := sepResults(v); got[1] != NotEvaluated+"/"+ReasonSectionTruncated || got[2] != NotEvaluated+"/"+ReasonSectionTruncated {
		t.Errorf("a cut SEP list proves no mismatch: %v", got)
	}
	v = bpjsStay()
	v.CareSetting = "outpatient"
	v.SEPs = []SEP{{ServiceType: " 2 "}}
	if got := sepResults(v); got != [3]string{Passed, Passed, NotApplicable + "/" + ReasonOutpatient} {
		t.Errorf("outpatient visit with an outpatient SEP: %v", got)
	}
	v.CareSetting = "unknown"
	if got := sepResults(v); got[1] != NotEvaluated+"/"+ReasonCareSettingUnknown || got[2] != NotEvaluated+"/"+ReasonCareSettingUnknown {
		t.Errorf("unknown care setting: %v", got)
	}
}

func TestSEPDischargeDateOnTheLatestInpatientSEP(t *testing.T) {
	v := bpjsStay()
	v.SEPs = []SEP{{ServiceType: "1", DischargeRecorded: true}, {ServiceType: "1"}}
	if got := sepResults(v)[2]; got != Failed+"/"+ReasonMissing {
		t.Errorf("the latest inpatient SEP has no discharge date: %s", got)
	}
	o := EvaluateClaimReadiness(v)
	for _, f := range o.Findings {
		if f.RuleID == RuleSEPDischargeDate && (f.Severity != Error || !f.HumanReview) {
			t.Errorf("missing SEP discharge date is an error for review: %+v", f)
		}
		if f.RuleID == RuleSEPServiceTypeMatches && f.Severity != Warning {
			t.Errorf("service type is a consistency warning: %+v", f)
		}
	}
}

func TestDiagnosisMismatchAndCodeNormalization(t *testing.T) {
	v := inpatient()
	v.SummaryMainDiagnosis = "I11.0"
	o := EvaluateClaimReadiness(v)
	if results(o)[RuleDiagnosisMatchesSummary] != Failed+"/"+ReasonMismatch || o.Summary.FailedWarning != 1 ||
		o.Status != StatusComplete {
		t.Errorf("mismatch: %v %+v", results(o), o.Summary)
	}
	v.SummaryMainDiagnosis = " i10 " // O-4: trimmed and upper-cased
	if r := results(EvaluateClaimReadiness(v))[RuleDiagnosisMatchesSummary]; r != Passed {
		t.Errorf("normalized codes match: %s", r)
	}
	v.SummaryMainDiagnosis = ""
	if r := results(EvaluateClaimReadiness(v))[RuleDiagnosisMatchesSummary]; r != Failed+"/"+ReasonMissing {
		t.Errorf("summary without a main code: %s", r)
	}
	v = inpatient()
	v.HasDischargeSummary = false
	r := results(EvaluateClaimReadiness(v))
	if r[RuleDischargeSummaryPresent] != Failed+"/"+ReasonMissing ||
		r[RuleDiagnosisMatchesSummary] != NotEvaluated+"/"+ReasonPrerequisiteFailed {
		t.Errorf("no summary: %v", r)
	}
}

func TestOutpatientWithoutDiagnosis(t *testing.T) {
	v := Visit{CareSetting: "outpatient", PayerCode: "A09"}
	o := EvaluateClaimReadiness(v)
	want := map[string]string{
		RulePrimaryDiagnosisCoded:   Failed + "/" + ReasonMissing,
		RuleDischargeSummaryPresent: NotApplicable + "/" + ReasonOutpatient,
		RuleDiagnosisMatchesSummary: NotApplicable + "/" + ReasonOutpatient,
		RuleDoctorProceduresCoded:   NotApplicable + "/" + ReasonNoDoctorProcedures,
		RuleLengthOfStayRecorded:    NotApplicable + "/" + ReasonOutpatient,
		RuleDischargeStatusRecorded: NotApplicable + "/" + ReasonOutpatient,
	}
	if got := results(o); !reflect.DeepEqual(got, want) {
		t.Errorf("got %v", got)
	}
	if o.Summary != (Summary{FailedError: 1, NotApplicable: 5}) || o.Status != StatusComplete {
		t.Errorf("summary %+v status %s", o.Summary, o.Status)
	}
}

func TestUnknownCareSettingIsNotEvaluated(t *testing.T) {
	v := inpatient()
	v.CareSetting = "unknown"
	r := results(EvaluateClaimReadiness(v))
	for _, id := range []string{RuleDischargeSummaryPresent, RuleDiagnosisMatchesSummary, RuleLengthOfStayRecorded, RuleDischargeStatusRecorded} {
		if r[id] != NotEvaluated+"/"+ReasonCareSettingUnknown {
			t.Errorf("%s: %s (O-3: never not applicable on unknown data)", id, r[id])
		}
	}
}

func TestLastRoomStayDecides(t *testing.T) {
	v := inpatient()
	v.RoomStays[1] = RoomStay{LengthOfStay: nil, DischargeStatus: str(" - ")}
	r := results(EvaluateClaimReadiness(v))
	if r[RuleLengthOfStayRecorded] != Failed+"/"+ReasonMissing || r[RuleDischargeStatusRecorded] != Failed+"/"+ReasonMissing {
		t.Errorf("the first room's values must not count (O-2): %v", r)
	}
	v.RoomStays = nil
	if r := results(EvaluateClaimReadiness(v)); r[RuleLengthOfStayRecorded] != Failed+"/"+ReasonMissing {
		t.Errorf("inpatient without a room stay: %v", r)
	}
	v = inpatient()
	v.Truncated = []string{"room_stay"}
	o := EvaluateClaimReadiness(v)
	if r := results(o); r[RuleLengthOfStayRecorded] != NotEvaluated+"/"+ReasonSectionTruncated ||
		r[RuleDischargeStatusRecorded] != NotEvaluated+"/"+ReasonSectionTruncated {
		t.Errorf("a cut room list cannot show the last room: %v", r)
	}
	if o.DataCompleteness.Complete || !reflect.DeepEqual(o.DataCompleteness.Truncated, []string{"room_stay"}) {
		t.Errorf("completeness %+v", o.DataCompleteness)
	}
}

func TestDoctorProcedures(t *testing.T) {
	v := inpatient()
	v.CodedProcedures = 0
	if r := results(EvaluateClaimReadiness(v)); r[RuleDoctorProceduresCoded] != Failed+"/"+ReasonMissing {
		t.Errorf("doctor actions without a coded procedure: %v", r)
	}
	v.DoctorProcedures = 0
	v.Truncated = []string{"procedure_rawat_inap_dr"}
	if r := results(EvaluateClaimReadiness(v)); r[RuleDoctorProceduresCoded] != NotEvaluated+"/"+ReasonSectionTruncated {
		t.Errorf("no doctor action found in a cut list is not evaluated: %v", r)
	}
}

func TestPrimaryDiagnosisIsLowestPriority(t *testing.T) {
	d, ok := primaryDiagnosis([]Diagnosis{{"B", 2}, {"A", 1}, {"C", 1}})
	if !ok || d.Code != "A" {
		t.Errorf("got %+v", d)
	}
}

func TestDeterministic(t *testing.T) {
	v := inpatient()
	v.PayerCode = "BPJ"
	v.SummaryMainDiagnosis = "X00"
	a, _ := json.Marshal(EvaluateClaimReadiness(v))
	for i := 0; i < 50; i++ {
		if b, _ := json.Marshal(EvaluateClaimReadiness(v)); string(a) != string(b) {
			t.Fatalf("run %d differs:\n%s\n%s", i, a, b)
		}
	}
}

func TestRuleOrderMatchesTheRuleSet(t *testing.T) {
	v := inpatient()
	v.PayerCode = "BPJ"
	o := EvaluateClaimReadiness(v)
	var ids []string
	for _, f := range o.Findings {
		ids = append(ids, f.RuleID)
		if f.Fields == nil {
			t.Errorf("%s: fields must be a list", f.RuleID)
		}
	}
	if !reflect.DeepEqual(ids, ClaimReadiness.Rules) {
		t.Errorf("order %v", ids)
	}
}
