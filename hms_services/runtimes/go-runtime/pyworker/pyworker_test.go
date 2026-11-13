package pyworker

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// python finds a Python 3.10+ interpreter that starts in the worker's bare environment, or skips: the worker tests
// need a real process. (The Windows Store "python3" alias runs only with the full user environment.)
func python(t *testing.T) string {
	t.Helper()
	for _, name := range []string{"python3", "python"} {
		path, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		cmd := exec.CommandContext(ctx, path, "-I", "-c",
			"import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)")
		cmd.Env = (&Runtime{}).env()
		err = cmd.Run()
		cancel()
		if err == nil {
			return path
		}
	}
	t.Skip("no Python 3.10+ interpreter on PATH")
	return ""
}

var realScript = filepath.Join("..", "..", "python-workers", "hms_worker.py")

func newRuntime(t *testing.T, cfg Config) *Runtime {
	t.Helper()
	if cfg.Python == "" {
		cfg.Python = python(t)
	}
	if cfg.Script == "" {
		cfg.Script = realScript
	}
	if cfg.Capabilities == nil {
		cfg.Capabilities = []Capability{PingCapability()}
	}
	if cfg.RestartDelay == 0 {
		cfg.RestartDelay = time.Millisecond
	}
	r, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

func fake(t *testing.T, env []string, caps ...string) *Runtime {
	t.Helper()
	cs := []Capability{PingCapability()}
	for _, c := range caps {
		cs = append(cs, Capability{Name: c, Timeout: 500 * time.Millisecond})
	}
	return newRuntime(t, Config{Script: filepath.Join("testdata", "fake_worker.py"), Capabilities: cs, Env: env})
}

func ping(t *testing.T, r *Runtime, echo string) {
	t.Helper()
	var out PingOutput
	if err := r.Call(context.Background(), PingName, PingInput{Echo: echo}, &out); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if out.Echo != echo {
		t.Fatalf("ping echo = %q, want %q", out.Echo, echo)
	}
}

func TestRealWorkerHandshakeAndPing(t *testing.T) {
	r := newRuntime(t, Config{})
	info, err := r.Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.Worker != "hms-worker" || info.Version != "1" || info.MemoryLimit != "none" {
		t.Fatalf("info = %+v", info)
	}
	ping(t, r, "hello")
	ping(t, r, "ünïcode") // same process, second call
}

func TestRealWorkerRefusalKeepsProcess(t *testing.T) {
	r := newRuntime(t, Config{})
	err := r.Call(context.Background(), PingName, PingInput{Echo: strings.Repeat("x", 65)}, &PingOutput{})
	var we *WorkerError
	if !errors.As(err, &we) || we.Code != "invalid_input" {
		t.Fatalf("err = %v, want WorkerError invalid_input", err)
	}
	ping(t, r, "still up")
}

func TestRealWorkerMemoryLimit(t *testing.T) {
	r := newRuntime(t, Config{MaxMemoryMB: 512, RequireLimits: true})
	info, err := r.Start(context.Background())
	if runtime.GOOS == "windows" {
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("windows: err = %v, want ErrUnavailable (limit unsupported)", err)
		}
		return
	}
	if err != nil || info.MemoryLimit != "applied" {
		t.Fatalf("info = %+v, err = %v", info, err)
	}
	ping(t, r, "limited")
}

func TestHandshakeMustListEveryCapability(t *testing.T) {
	r := newRuntime(t, Config{Capabilities: []Capability{PingCapability(), {Name: "runtime.missing"}}})
	if _, err := r.Start(context.Background()); !errors.Is(err, ErrProtocol) {
		t.Fatalf("err = %v, want ErrProtocol", err)
	}
}

func TestHandshakeFailures(t *testing.T) {
	for mode, want := range map[string]error{"bad_version": ErrProtocol, "silent": ErrUnavailable} {
		t.Run(mode, func(t *testing.T) {
			r := newRuntime(t, Config{Script: filepath.Join("testdata", "fake_worker.py"),
				Env: []string{"FAKE_HELLO=" + mode}, StartTimeout: time.Second})
			if _, err := r.Start(context.Background()); !errors.Is(err, want) {
				t.Fatalf("err = %v, want %v", err, want)
			}
		})
	}
}

func TestUnknownCapabilityIsNotSent(t *testing.T) {
	r, err := New(Config{Python: "python-not-needed", Script: realScript, Capabilities: []Capability{PingCapability()}})
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Call(context.Background(), "runtime.shell", nil, nil); !errors.Is(err, ErrUnknownCapability) {
		t.Fatalf("err = %v", err)
	}
	if r.w != nil {
		t.Fatal("a process was started for a refused capability")
	}
}

func TestInputTooLarge(t *testing.T) {
	r := newRuntime(t, Config{})
	err := r.Call(context.Background(), PingName, PingInput{Echo: strings.Repeat("x", 300)}, &PingOutput{})
	if !errors.Is(err, ErrInputTooLarge) {
		t.Fatalf("err = %v", err)
	}
}

// Each failure kills the process; the next call gets a fresh one.
func TestFailuresKillAndRestart(t *testing.T) {
	cases := map[string]error{
		"test.sleep":    ErrTimeout,
		"test.garbage":  ErrProtocol,
		"test.wrong_id": ErrProtocol,
		"test.huge":     ErrProtocol,
		"test.crash":    ErrUnavailable,
	}
	for capName, want := range cases {
		t.Run(capName, func(t *testing.T) {
			r := fake(t, nil, capName)
			ping(t, r, "before")
			first := r.w.(*process)
			start := time.Now()
			if err := r.Call(context.Background(), capName, map[string]any{}, nil); !errors.Is(err, want) {
				t.Fatalf("err = %v, want %v", err, want)
			}
			if d := time.Since(start); d > 3*time.Second {
				t.Fatalf("failure took %s", d)
			}
			if r.w != nil {
				t.Fatal("failed process kept")
			}
			select {
			case <-first.done:
			case <-time.After(5 * time.Second):
				t.Fatal("failed process not reaped")
			}
			time.Sleep(5 * time.Millisecond) // RestartDelay
			ping(t, r, "after")
		})
	}
}

func TestRestartDelayRefusesCrashLoop(t *testing.T) {
	r := newRuntime(t, Config{Script: filepath.Join("testdata", "fake_worker.py"), RestartDelay: time.Hour,
		Capabilities: []Capability{PingCapability(), {Name: "test.crash"}}})
	_ = r.Call(context.Background(), "test.crash", map[string]any{}, nil)
	if err := r.Call(context.Background(), PingName, PingInput{}, &PingOutput{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable during the restart delay", err)
	}
}

func TestOutputIsValidatedStrictly(t *testing.T) {
	r := fake(t, nil, "test.extra")
	var out PingOutput
	if err := r.Call(context.Background(), "test.extra", map[string]any{}, &out); !errors.Is(err, ErrInvalidOutput) {
		t.Fatalf("unknown field: err = %v", err)
	}
	ping(t, r, "kept") // bad output is not a protocol failure

	r2 := newRuntime(t, Config{Capabilities: []Capability{{Name: PingName,
		Validate: func(o json.RawMessage) error { return errors.New("rejected by policy") }}}})
	if err := r2.Call(context.Background(), PingName, PingInput{}, &out); !errors.Is(err, ErrInvalidOutput) {
		t.Fatalf("Validate: err = %v", err)
	}
}

func TestEnvironmentIsNotInherited(t *testing.T) {
	t.Setenv("HMS_PYWORKER_SENTINEL", "secret")
	r := fake(t, []string{"PASSED=yes"}, "test.env")
	var out struct {
		Seen   bool   `json:"seen"`
		Passed string `json:"passed"`
	}
	if err := r.Call(context.Background(), "test.env", map[string]any{}, &out); err != nil {
		t.Fatal(err)
	}
	if out.Seen || out.Passed != "yes" {
		t.Fatalf("out = %+v", out)
	}
}

func TestCallerCancellation(t *testing.T) {
	r := fake(t, nil, "test.stall_read")
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(100*time.Millisecond, cancel)
	if err := r.Call(ctx, "test.stall_read", map[string]any{}, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestConcurrentCallsAreSerialised(t *testing.T) {
	r := newRuntime(t, Config{})
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var out PingOutput
			errs <- r.Call(context.Background(), PingName, PingInput{Echo: "c"}, &out)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestClosedRuntime(t *testing.T) {
	r := newRuntime(t, Config{})
	ping(t, r, "x")
	p := r.w.(*process)
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-p.done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not exit on Close")
	}
	if err := r.Call(context.Background(), PingName, PingInput{}, &PingOutput{}); !errors.Is(err, ErrClosed) {
		t.Fatalf("err = %v", err)
	}
}

func TestNewValidation(t *testing.T) {
	base := Config{Python: "python", Script: realScript, Capabilities: []Capability{PingCapability()}}
	bad := map[string]func(c *Config){
		"no python":       func(c *Config) { c.Python = "" },
		"missing script":  func(c *Config) { c.Script = "nope.py" },
		"no capabilities": func(c *Config) { c.Capabilities = nil },
		"bad name":        func(c *Config) { c.Capabilities = []Capability{{Name: "Ping"}} },
		"duplicate":       func(c *Config) { c.Capabilities = append(c.Capabilities, PingCapability()) },
		"bad env":         func(c *Config) { c.Env = []string{"NOEQUALS"} },
		"limits w/o mem":  func(c *Config) { c.RequireLimits = true },
		"unknown engine":  func(c *Config) { c.Engine = "wasm" },
		"embedded+python": func(c *Config) { c.Engine = EngineEmbedded },
		"embedded small memory": func(c *Config) {
			c.Engine, c.Python, c.MaxMemoryMB = EngineEmbedded, "", minEmbeddedMemoryMB-1
		},
		"input >= line": func(c *Config) {
			c.MaxLineBytes = 1024
			c.Capabilities = []Capability{{Name: PingName, MaxInputBytes: 1024}}
		},
	}
	for name, mutate := range bad {
		c := base
		mutate(&c)
		if _, err := New(c); err == nil {
			t.Errorf("%s: New accepted it", name)
		}
	}
}
