package pyworker

import (
	"context"
	"flag"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	gopy "github.com/goccy/go-python"
)

// pyTarget lets a developer run any Python tests in the embedded interpreter, e.g.
//
//	go test ./runtimes/go-runtime/pyworker -run 'TestEmbeddedPythonUnitTests$' -v -args -py=/abs/path/test_rules.py
//
// A directory runs every test_*.py in it; a file runs that file. Either way every .py file under the directory
// (subdirectories included) is copied into the interpreter, so the tests can import their neighbours. A relative path
// is resolved from this package's directory, where go test runs. Test-only: the binary has no such entry point.
var pyTarget = flag.String("py", "", "Python test file or directory to run in the embedded interpreter "+
	"(default: runtimes/python-workers)")

// discoverAndRun runs the test files matching HMS_TEST_PATTERN under /hms with unittest and returns the outcome as one
// JSON line.
const discoverAndRun = `
import io, json, os, unittest
_stream = io.StringIO()
_suite = unittest.defaultTestLoader.discover("/hms", pattern=os.environ["HMS_TEST_PATTERN"], top_level_dir="/hms")
_result = unittest.TextTestRunner(stream=_stream, verbosity=2).run(_suite)
json.dumps({"run": _result.testsRun, "failures": len(_result.failures), "errors": len(_result.errors),
            "skipped": len(_result.skipped), "ok": _result.wasSuccessful(), "report": _stream.getvalue()})
`

type pythonTestRun struct {
	Run      int    `json:"run"`
	Failures int    `json:"failures"`
	Errors   int    `json:"errors"`
	Skipped  int    `json:"skipped"`
	OK       bool   `json:"ok"`
	Report   string `json:"report"`
}

// runPythonTests runs unittest discovery for pattern over files (slash path -> source) in a confined embedded
// interpreter.
func runPythonTests(t *testing.T, files map[string][]byte, pattern string) pythonTestRun {
	t.Helper()
	py, err := newInterpreter(files, []string{"HMS_TEST_PATTERN=" + pattern}, 256, &counter{})
	if err != nil {
		t.Fatal(err)
	}
	defer py.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	res, err := py.Eval(ctx, discoverAndRun)
	if err != nil {
		t.Fatalf("eval: %v", err)
	}
	if res.Error != nil {
		t.Fatalf("test runner raised: %v", res.Error)
	}
	line, err := gopy.As[gopy.StrValue](res.Value)
	if err != nil {
		t.Fatalf("runner returned %s", res.Value.Kind())
	}
	var out pythonTestRun
	if err := decodeStrict([]byte(line.String()), &out); err != nil {
		t.Fatalf("runner output: %v", err)
	}
	return out
}

// TestEmbeddedPythonUnitTests runs the worker's own Python test suite (runtimes/python-workers/test_*.py) inside the
// embedded interpreter, confined as the engine confines it. The embedded standard library is trimmed, so a capability
// that passes on a host Python can still fail here (ADR-SVC-011 Amendment 1). Needs no Python installed.
func TestEmbeddedPythonUnitTests(t *testing.T) {
	dir, pattern := filepath.Dir(realScript), "test_*.py"
	if *pyTarget != "" {
		st, err := os.Stat(*pyTarget)
		if err != nil {
			t.Fatalf("-py: %v", err)
		}
		if st.IsDir() {
			dir = *pyTarget
		} else {
			dir, pattern = filepath.Dir(*pyTarget), filepath.Base(*pyTarget)
		}
	}
	files := pythonFiles(t, dir)
	if _, ok := files["test_hms_worker.py"]; !ok && *pyTarget == "" {
		t.Fatalf("test_hms_worker.py not found in %s", dir)
	}

	out := runPythonTests(t, files, pattern)
	t.Logf("%s (%s)", dir, pattern)
	t.Logf("embedded CPython: %d run, %d failures, %d errors, %d skipped", out.Run, out.Failures, out.Errors, out.Skipped)
	if !out.OK || out.Run == 0 {
		t.Fatalf("Python tests failed in the embedded interpreter:\n%s", out.Report)
	}
	if testing.Verbose() {
		t.Log("\n" + out.Report)
	}
}

// pythonFiles reads every .py file under dir, keyed by its slash path relative to dir.
func pythonFiles(t *testing.T, dir string) map[string][]byte {
	t.Helper()
	files := map[string][]byte{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if p != dir && (d.Name() == "__pycache__" || strings.HasPrefix(d.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(p) != ".py" {
			return nil
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		src, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(rel)] = src
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

// The runner must report a failing test, and a test module that cannot be imported (as with a standard-library module
// missing from the embedded build), as failures rather than pass silently.
func TestEmbeddedPythonUnitTestsDetectFailures(t *testing.T) {
	cases := map[string]struct {
		src                    string
		wantFailures, wantErrs int
	}{
		"failing assertion": {"import unittest\n\nclass T(unittest.TestCase):\n" +
			"    def test_fails(self):\n        self.assertEqual(1, 2)\n", 1, 0},
		"missing module": {"import hms_module_that_does_not_exist\n", 0, 1},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			out := runPythonTests(t, map[string][]byte{"test_case.py": []byte(c.src)}, "test_*.py")
			if out.OK || out.Failures != c.wantFailures || out.Errors != c.wantErrs {
				t.Fatalf("got %+v, want %d failures and %d errors", out, c.wantFailures, c.wantErrs)
			}
		})
	}
}
