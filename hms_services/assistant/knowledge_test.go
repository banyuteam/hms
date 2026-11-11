package assistant

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"hms/services/runtimes/python-workers/assistant/datasets"
)

func TestShippedGeneralHelpIsPublishedWithoutPlaceholdersOrTestSet(t *testing.T) {
	rel, err := LoadKnowledge(datasets.GeneralHelp)
	if err != nil {
		t.Fatalf("shipped dataset: %v", err)
	}
	if rel.Dataset != "hms-assistant.general-help" || rel.Version == "" || rel.ApprovedAt == "" {
		t.Fatalf("release header = %+v", rel)
	}
	tags := map[string]bool{}
	for _, in := range rel.Intents {
		tags[in.Tag] = true
		if len(in.Patterns) == 0 {
			t.Errorf("%s: no patterns", in.Tag)
		}
		for _, lang := range rel.Languages {
			if in.Responses[lang] == "" || strings.Contains(in.Responses[lang], "TODO") {
				t.Errorf("%s: response %s = %q", in.Tag, lang, in.Responses[lang])
			}
		}
	}
	if tags["help.contact_support"] {
		t.Error("help.contact_support (needs_owner, TODO) must not be published")
	}
	if !tags["greeting"] || !tags["safety.advice_refusal"] || !tags["out_of_scope"] {
		t.Errorf("expected intents missing: %v", tags)
	}
	body, _ := json.Marshal(rel)
	if strings.Contains(string(body), `"test"`) || strings.Contains(string(body), "approved_by") {
		t.Errorf("the held-out test set and the approver are not served: %s", body)
	}
}

const draft = `{"dataset":"d","version":"0.1.0","status":"draft","approval":{"approved_by":null,"approved_at":null},
"languages":["id","en"],"intents":[{"tag":"greeting","patterns":["halo"],"responses":[{"lang":"id","text":"Halo"},
{"lang":"en","text":"Hello"}],"context_set":"","review":"from_app"}],"test":[{"text":"hai","tag":"greeting"}]}`

func TestDraftIsNotPublished(t *testing.T) {
	if _, err := LoadKnowledge([]byte(draft)); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("draft: err = %v, want ErrNotApproved", err)
	}
}

func TestApprovedReleaseLeavesOutIncompleteIntents(t *testing.T) {
	raw := strings.NewReplacer(`"status":"draft"`, `"status":"approved"`,
		`"approved_by":null,"approved_at":null`, `"approved_by":"owner","approved_at":"2026-11-10"`).Replace(draft)
	raw = strings.Replace(raw, `"intents":[`, `"intents":[{"tag":"x","patterns":["p"],"responses":[{"lang":"id","text":"a"}],"context_set":"","review":"from_app"},`+
		`{"tag":"y","patterns":["p"],"responses":[{"lang":"id","text":"TODO(owner)"},{"lang":"en","text":"b"}],"context_set":"","review":"from_app"},`+
		`{"tag":"z","patterns":["p"],"responses":[{"lang":"id","text":"a"},{"lang":"en","text":"b"}],"context_set":"","review":"needs_owner"},`, 1)
	rel, err := LoadKnowledge([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(rel.Intents) != 1 || rel.Intents[0].Tag != "greeting" {
		t.Fatalf("intents = %+v (missing language, TODO and needs_owner are left out)", rel.Intents)
	}
}

func TestMalformedDatasetIsAnError(t *testing.T) {
	for name, raw := range map[string]string{
		"not json":         `{`,
		"repeated tag":     strings.Replace(draft, `"intents":[`, `"intents":[{"tag":"greeting","patterns":["a"],"responses":[]},`, 1),
		"no patterns":      strings.Replace(draft, `"patterns":["halo"]`, `"patterns":[]`, 1),
		"approved, no who": strings.Replace(draft, `"status":"draft"`, `"status":"approved"`, 1),
	} {
		if _, err := LoadKnowledge([]byte(raw)); err == nil || errors.Is(err, ErrNotApproved) {
			t.Errorf("%s: err = %v, want a validation error", name, err)
		}
	}
}

func TestGeneralHelpServesTheReleaseOrNotFound(t *testing.T) {
	h := &Handler{knowledge: &KnowledgeRelease{Dataset: "d", Version: "1", Intents: []KnowledgeIntent{}}}
	w := httptest.NewRecorder()
	h.generalHelp(w, httptest.NewRequest(http.MethodGet, "/api/v1/assistant/knowledge/general-help", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"dataset":"d"`) {
		t.Fatalf("approved: %d %s", w.Code, w.Body)
	}
	h.knowledge = nil
	w = httptest.NewRecorder()
	h.generalHelp(w, httptest.NewRequest(http.MethodGet, "/api/v1/assistant/knowledge/general-help", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("none approved: %d", w.Code)
	}
}
