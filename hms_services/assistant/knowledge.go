package assistant

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"hms/services/core/httpx"
	"hms/services/runtimes/python-workers/assistant/datasets"
)

// Knowledge release: the general-help dataset (how to use HMS; no patient data) as the assistant may use it.
// Published only when the dataset is approved (status "approved" with approver and date). Of an approved dataset only
// intents written from the app ("review": "from_app") with every response filled in are served: an intent waiting for
// facts from the hospital ("needs_owner", or a response still marked TODO) is left out. The held-out "test" set is
// never served: it is for measuring, not for matching.

// KnowledgeIntent is one intent as served: example messages and the answer per language.
type KnowledgeIntent struct {
	Tag       string            `json:"tag"`
	Patterns  []string          `json:"patterns"`
	Responses map[string]string `json:"responses"`
}

// KnowledgeRelease is the response of GET /assistant/knowledge/general-help.
type KnowledgeRelease struct {
	Dataset    string            `json:"dataset"`
	Version    string            `json:"version"`
	ApprovedAt string            `json:"approved_at"`
	Languages  []string          `json:"languages"`
	Intents    []KnowledgeIntent `json:"intents"`
}

type seedDataset struct {
	Dataset   string   `json:"dataset"`
	Version   string   `json:"version"`
	Status    string   `json:"status"`
	Languages []string `json:"languages"`
	Approval  struct {
		ApprovedBy *string `json:"approved_by"`
		ApprovedAt *string `json:"approved_at"`
	} `json:"approval"`
	Intents []struct {
		Tag       string   `json:"tag"`
		Patterns  []string `json:"patterns"`
		Responses []struct {
			Lang string `json:"lang"`
			Text string `json:"text"`
		} `json:"responses"`
		ContextSet string `json:"context_set"`
		Review     string `json:"review"`
	} `json:"intents"`
}

// ErrNotApproved: the dataset is valid but not approved, so nothing is published.
var ErrNotApproved = errors.New("assistant: knowledge dataset not approved")

// LoadKnowledge validates a seed dataset and returns its release. A malformed dataset is an error; a draft is
// ErrNotApproved.
func LoadKnowledge(raw []byte) (*KnowledgeRelease, error) {
	var d seedDataset
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("assistant: knowledge dataset: %w", err)
	}
	if d.Dataset == "" || d.Version == "" || len(d.Languages) == 0 {
		return nil, errors.New("assistant: knowledge dataset needs dataset, version and languages")
	}
	tags := map[string]bool{}
	for _, in := range d.Intents {
		if in.Tag == "" || tags[in.Tag] {
			return nil, fmt.Errorf("assistant: knowledge intent tag %q empty or repeated", in.Tag)
		}
		tags[in.Tag] = true
		if len(in.Patterns) == 0 {
			return nil, fmt.Errorf("assistant: knowledge intent %q has no patterns", in.Tag)
		}
	}
	if d.Status != "approved" {
		return nil, ErrNotApproved
	}
	if d.Approval.ApprovedBy == nil || strings.TrimSpace(*d.Approval.ApprovedBy) == "" ||
		d.Approval.ApprovedAt == nil || strings.TrimSpace(*d.Approval.ApprovedAt) == "" {
		return nil, errors.New("assistant: knowledge dataset is approved without approver and date")
	}
	rel := &KnowledgeRelease{Dataset: d.Dataset, Version: d.Version, ApprovedAt: *d.Approval.ApprovedAt,
		Languages: d.Languages, Intents: []KnowledgeIntent{}}
	for _, in := range d.Intents {
		// General help only: an intent that needs an attached record is not part of this release.
		if in.Review != "from_app" || in.ContextSet != "" {
			continue
		}
		responses := map[string]string{}
		complete := true
		for _, r := range in.Responses {
			text := strings.TrimSpace(r.Text)
			if text == "" || strings.Contains(text, "TODO") {
				complete = false
			}
			responses[r.Lang] = text
		}
		for _, lang := range d.Languages {
			if responses[lang] == "" {
				complete = false
			}
		}
		if !complete {
			continue
		}
		patterns := make([]string, 0, len(in.Patterns))
		for _, p := range in.Patterns {
			if p = strings.TrimSpace(p); p != "" {
				patterns = append(patterns, p)
			}
		}
		rel.Intents = append(rel.Intents, KnowledgeIntent{Tag: in.Tag, Patterns: patterns, Responses: responses})
	}
	return rel, nil
}

// mustGeneralHelp loads the embedded dataset at startup: a malformed file stops the service (it is source-controlled
// and reviewed); a draft publishes nothing.
func mustGeneralHelp() *KnowledgeRelease {
	rel, err := LoadKnowledge(datasets.GeneralHelp)
	if errors.Is(err, ErrNotApproved) {
		return nil
	}
	if err != nil {
		panic(err)
	}
	return rel
}

// generalHelp serves the approved general-help release (static, no PHI, not audited). 404 not_found when none is
// approved.
func (h *Handler) generalHelp(w http.ResponseWriter, _ *http.Request) {
	if h.knowledge == nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No approved general-help release.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, h.knowledge)
}
