// Package rules holds the assistant's deterministic rule sets (ADR-SVC-006). Rules are typed Go code: no stored
// expressions, no clock, no I/O. A rule set is immutable per version; any change in behaviour is a new version.
package rules

// Result of one rule.
const (
	Passed        = "passed"
	Failed        = "failed"
	NotApplicable = "not_applicable"
	NotEvaluated  = "not_evaluated"
)

// Severity of a rule when it fails.
const (
	Error   = "error"
	Warning = "warning"
	Info    = "info"
)

// Reasons (contract assistant-v1, Finding.reason and Applicability.reason).
const (
	ReasonMissing            = "missing"
	ReasonMismatch           = "mismatch"
	ReasonOutpatient         = "outpatient"
	ReasonNoDoctorProcedures = "no_doctor_procedures"
	ReasonCareSettingUnknown = "care_setting_unknown"
	ReasonPrerequisiteFailed = "prerequisite_failed"
	ReasonSectionTruncated   = "section_truncated"
	ReasonSourceNotConnected = "source_not_connected"
	ReasonPayerNotClaimable  = "payer_not_claimable"
)

// Evaluation status, resource types and data sources.
const (
	StatusComplete      = "complete"
	StatusPartial       = "partial"
	StatusNotApplicable = "not_applicable"

	ResourceEncounter = "encounter"
)

// Finding is the outcome of one rule. It carries codes and field paths, never record values.
type Finding struct {
	RuleID      string   `json:"rule_id"`
	Result      string   `json:"result"`
	Severity    string   `json:"severity"`
	Reason      *string  `json:"reason"`
	Fields      []string `json:"fields"`
	HumanReview bool     `json:"human_review"`
}

// Summary counts the findings by result (failed split by severity).
type Summary struct {
	Passed        int `json:"passed"`
	FailedError   int `json:"failed_error"`
	FailedWarning int `json:"failed_warning"`
	NotApplicable int `json:"not_applicable"`
	NotEvaluated  int `json:"not_evaluated"`
}

type Applicability struct {
	Applies bool    `json:"applies"`
	Reason  *string `json:"reason"`
}

type Completeness struct {
	Complete            bool     `json:"complete"`
	SourcesNotConnected []string `json:"sources_not_connected"`
	Truncated           []string `json:"truncated"`
}

// Outcome is the full, deterministic result of a rule set over one resource.
type Outcome struct {
	Status           string        `json:"status"`
	Applicability    Applicability `json:"applicability"`
	Findings         []Finding     `json:"findings"`
	Summary          Summary       `json:"summary"`
	DataCompleteness Completeness  `json:"data_completeness"`
}

// RuleSet describes a rule set (GET /assistant/rule-sets).
type RuleSet struct {
	ID            string   `json:"id"`
	Version       int      `json:"version"`
	ResourceTypes []string `json:"resource_types"`
	MaxReferences int      `json:"max_references"`
	Rules         []string `json:"rules"`
}

func finding(id, result, severity, reason string, fields ...string) Finding {
	f := Finding{RuleID: id, Result: result, Severity: severity, Fields: fields,
		HumanReview: result == Failed || result == NotEvaluated}
	if f.Fields == nil {
		f.Fields = []string{}
	}
	if reason != "" {
		f.Reason = &reason
	}
	return f
}

// finish derives status, summary and completeness from the findings.
func finish(findings []Finding, sources, truncated []string) Outcome {
	o := Outcome{Status: StatusComplete, Applicability: Applicability{Applies: true}, Findings: findings,
		DataCompleteness: Completeness{SourcesNotConnected: nonNil(sources), Truncated: nonNil(truncated)}}
	for _, f := range findings {
		switch {
		case f.Result == Passed:
			o.Summary.Passed++
		case f.Result == NotApplicable:
			o.Summary.NotApplicable++
		case f.Result == NotEvaluated:
			o.Summary.NotEvaluated++
			o.Status = StatusPartial
		case f.Severity == Error:
			o.Summary.FailedError++
		default:
			o.Summary.FailedWarning++
		}
	}
	o.DataCompleteness.Complete = len(o.DataCompleteness.SourcesNotConnected) == 0 && len(o.DataCompleteness.Truncated) == 0
	return o
}

func nonNil(v []string) []string {
	if v == nil {
		return []string{}
	}
	return append([]string{}, v...)
}
