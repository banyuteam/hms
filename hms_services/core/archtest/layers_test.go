// Package archtest enforces the layer boundaries of ADR-ROOT-002 on the import graph (`go list -json`):
//
//   - native/...       the native transaction layer does not import the legacy HMS adapter, the bridge or the legacy
//     read-through slices (direct imports: platform/iam itself uses the legacy sign-in verifier, ADR-SVC-001);
//   - legacybridge/... the legacy bridge never reaches, even transitively, the native layer, IAM or the HTTP slices;
//   - canonical/...    the shared canonical store never reaches, even transitively, either layer or the legacy HMS.
package archtest

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

type pkg struct {
	ImportPath string
	Imports    []string // direct
	Deps       []string // transitive
}

func listDeps(t *testing.T, pattern string) []pkg {
	t.Helper()
	cmd := exec.Command("go", "list", "-json", pattern)
	cmd.Dir = "../.."
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list %s: %v", pattern, err)
	}
	var pkgs []pkg
	dec := json.NewDecoder(strings.NewReader(string(out)))
	for dec.More() {
		var p pkg
		if err := dec.Decode(&p); err != nil {
			t.Fatal(err)
		}
		pkgs = append(pkgs, p)
	}
	if len(pkgs) == 0 {
		t.Fatalf("no packages match %s", pattern)
	}
	return pkgs
}

func TestLayerBoundaries(t *testing.T) {
	const m = "hms/services/"
	rules := []struct {
		pattern    string
		transitive bool
		forbidden  []string
	}{
		{m + "native/...", false, []string{m + "legacybridge", m + "integrations/legacyhms", m + "clinical", m + "assistant"}},
		{m + "legacybridge/...", true, []string{m + "native", m + "platform/iam", m + "clinical", m + "assistant", m + "tariffs"}},
		{m + "canonical/...", true, []string{m + "native", m + "legacybridge", m + "integrations", m + "platform/iam", m + "clinical"}},
	}
	for _, r := range rules {
		for _, p := range listDeps(t, r.pattern) {
			deps := p.Imports
			if r.transitive {
				deps = p.Deps
			}
			for _, d := range deps {
				for _, f := range r.forbidden {
					if d == f || strings.HasPrefix(d, f+"/") {
						t.Errorf("%s depends on %s (forbidden for %s)", p.ImportPath, d, r.pattern)
					}
				}
			}
		}
	}
}
