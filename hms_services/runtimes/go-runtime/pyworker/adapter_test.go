package pyworker

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// The embedded engine loads the adapter and the capability modules, but no tests, caches or test data.
func TestWorkerSources(t *testing.T) {
	files, err := workerSources(realScript)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"hms_worker.py", "hms_runtime/__init__.py", "hms_runtime/protocol.py",
		"hms_runtime/schema.py", "capabilities/runtime.py"} {
		if _, ok := files[want]; !ok {
			t.Errorf("%s not loaded", want)
		}
	}
	for name := range files {
		base := name[strings.LastIndex(name, "/")+1:]
		if strings.HasPrefix(base, "test_") || strings.Contains(name, "__pycache__") || !strings.HasSuffix(name, ".py") {
			t.Errorf("%s loaded", name)
		}
	}
}

// Both engines run the same adapter code, so the same request gets the same answer: output, refusal code and the
// data-free refusal message.
func TestEnginesAgree(t *testing.T) {
	proc := newRuntime(t, Config{}) // skips without a host Python
	emb := embeddedRuntime(t, Config{})
	inputs := []any{
		map[string]any{"echo": "hello"},
		map[string]any{},                                   // default filled by the schema
		map[string]any{"echo": strings.Repeat("x", 65)},    // too long
		map[string]any{"echo": 7},                          // wrong type
		map[string]any{"echo": "x", "MRN-0001": "patient"}, // unknown field
		[]any{"not", "an", "object"},
	}
	type outcome struct {
		Output        json.RawMessage
		Code, Message string
	}
	run := func(r *Runtime, in any) outcome {
		var out json.RawMessage
		err := r.Call(context.Background(), PingName, in, &out)
		var we *WorkerError
		switch {
		case err == nil:
			return outcome{Output: out}
		case errors.As(err, &we):
			return outcome{Code: we.Code, Message: we.Message}
		default:
			t.Fatalf("input %v: %v", in, err)
			return outcome{}
		}
	}
	for _, in := range inputs {
		p, e := run(proc, in), run(emb, in)
		if !reflect.DeepEqual(p, e) {
			t.Errorf("input %v:\n process  %+v (%s)\n embedded %+v (%s)", in, p, p.Output, e, e.Output)
		}
		if strings.Contains(p.Message, "MRN") {
			t.Errorf("refusal message quotes the input: %q", p.Message)
		}
	}
	if got := run(emb, map[string]any{}); string(got.Output) != `{"echo":""}` {
		t.Errorf("default not filled: %+v", got)
	}
}
