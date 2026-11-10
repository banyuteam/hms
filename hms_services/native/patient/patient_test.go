package patient

import (
	"errors"
	"testing"
	"time"

	"hms/services/canonical/patient"
)

func TestRegistrationRules(t *testing.T) {
	today := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	nik := patient.Identifier{System: patient.SystemNIK, Value: "3374010101900001"}
	ok := Registration{Name: "  Siti \t Aminah ", Gender: "female", BirthDate: "1990-01-01", Identifiers: []patient.Identifier{nik}}
	p, err := ok.Validate(today)
	if err != nil || p.Name != "Siti Aminah" || len(p.Identifiers) != 1 {
		t.Fatalf("valid registration: %+v %v", p, err)
	}
	bad := map[string]Registration{
		"no name":         {Gender: "female"},
		"gender":          {Name: "A", Gender: "F"},
		"future birth":    {Name: "A", Gender: "male", BirthDate: "2026-11-11"},
		"impossible date": {Name: "A", Gender: "male", BirthDate: "1990-02-30"},
		"id format":       {ID: "123", Name: "A", Gender: "male"},
		"nik format":      {Name: "A", Gender: "male", Identifiers: []patient.Identifier{{System: patient.SystemNIK, Value: "33740101"}}},
		"nik placeholder": {Name: "A", Gender: "male", Identifiers: []patient.Identifier{{System: patient.SystemNIK, Value: "9999999999999999"}}},
		// The MRN is allocated by HMS, never chosen by a client.
		"client mrn":     {Name: "A", Gender: "male", Identifiers: []patient.Identifier{{System: patient.SystemMRN, Value: "000001"}}},
		"unknown system": {Name: "A", Gender: "male", Identifiers: []patient.Identifier{{System: "urn:x", Value: "1"}}},
		"two niks":       {Name: "A", Gender: "male", Identifiers: []patient.Identifier{nik, nik}},
	}
	for name, r := range bad {
		var ve ValidationError
		if _, err := r.Validate(today); !errors.As(err, &ve) {
			t.Errorf("%s: accepted (%v)", name, err)
		}
	}
}

func TestMaskKeepsLastFour(t *testing.T) {
	if got := Mask("3374010101900001"); got != "••••••••••••0001" {
		t.Errorf("Mask = %q", got)
	}
	if got := Mask("123"); got != "•••" {
		t.Errorf("short values are fully masked: %q", got)
	}
}
