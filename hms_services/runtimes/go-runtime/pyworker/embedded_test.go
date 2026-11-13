package pyworker

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The embedded engine needs no Python on the machine, so these tests never skip.

func embeddedRuntime(t *testing.T, cfg Config) *Runtime {
	t.Helper()
	cfg.Engine = EngineEmbedded
	if cfg.Script == "" {
		cfg.Script = realScript
	}
	if cfg.Capabilities == nil {
		cfg.Capabilities = []Capability{PingCapability()}
	}
	if cfg.RestartDelay == 0 {
		cfg.RestartDelay = time.Millisecond
	}
	if cfg.StartTimeout == 0 {
		cfg.StartTimeout = 30 * time.Second // the race detector slows interpreter start-up a lot
	}
	r, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

func fakeEmbedded(t *testing.T, env []string, caps ...string) *Runtime {
	t.Helper()
	cs := []Capability{PingCapability()}
	for _, c := range caps {
		cs = append(cs, Capability{Name: c, Timeout: 2 * time.Second})
	}
	return embeddedRuntime(t, Config{Script: filepath.Join("testdata", "fake_embedded.py"), Capabilities: cs, Env: env})
}

func TestEmbeddedRealWorkerHandshakeAndPing(t *testing.T) {
	r := embeddedRuntime(t, Config{})
	info, err := r.Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.Worker != "hms-worker" || info.Version != "1" || info.MemoryLimit != "none" {
		t.Fatalf("info = %+v", info)
	}
	ping(t, r, "hello")
	ping(t, r, "ünïcode") // same interpreter, second call
}

func TestEmbeddedRealWorkerRefusalKeepsInterpreter(t *testing.T) {
	r := embeddedRuntime(t, Config{})
	ping(t, r, "first")
	first := r.w
	err := r.Call(context.Background(), PingName, PingInput{Echo: strings.Repeat("x", 65)}, &PingOutput{})
	var we *WorkerError
	if !errors.As(err, &we) || we.Code != "invalid_input" {
		t.Fatalf("err = %v, want WorkerError invalid_input", err)
	}
	ping(t, r, "still up")
	if r.w != first {
		t.Fatal("a refusal replaced the interpreter")
	}
}

// Unlike the process engine, the memory limit is enforced by the host on every OS, so RequireLimits is satisfied.
// The 256 MiB allocation succeeds without a limit, so the MemoryError comes from the limit.
func TestEmbeddedMemoryLimit(t *testing.T) {
	hog := func(t *testing.T, memoryMB int) (info Info, memoryError bool) {
		r := embeddedRuntime(t, Config{Script: filepath.Join("testdata", "fake_embedded.py"), MaxMemoryMB: memoryMB,
			RequireLimits: memoryMB > 0, Capabilities: []Capability{PingCapability(), {Name: "test.hog", Timeout: 10 * time.Second}}})
		info, err := r.Start(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		var out struct {
			MemoryError bool `json:"memory_error"`
			Size        int  `json:"size"`
		}
		if err := r.Call(context.Background(), "test.hog", map[string]any{}, &out); err != nil {
			t.Fatal(err)
		}
		ping(t, r, "after the allocation")
		return info, out.MemoryError
	}
	if info, memErr := hog(t, 0); memErr || info.MemoryLimit != "none" {
		t.Fatalf("no limit: memory_error %t, info %+v", memErr, info)
	}
	for _, mb := range []int{minEmbeddedMemoryMB, 128} {
		if info, memErr := hog(t, mb); !memErr || info.MemoryLimit != "applied" {
			t.Fatalf("%d MiB: memory_error %t, info %+v", mb, memErr, info)
		}
	}
}

func TestEmbeddedHandshakeFailures(t *testing.T) {
	cases := map[string]Config{
		"bad_version": {Env: []string{"FAKE_HELLO=bad_version"}},
		"not_str":     {Env: []string{"FAKE_HELLO=not_str"}},
		"missing cap": {Capabilities: []Capability{PingCapability(), {Name: "runtime.missing"}}},
		"no entry":    {Script: filepath.Join("testdata", "fake_worker.py")}, // a process worker has no hello_line
	}
	for name, cfg := range cases {
		t.Run(name, func(t *testing.T) {
			if cfg.Script == "" {
				cfg.Script = filepath.Join("testdata", "fake_embedded.py")
			}
			r := embeddedRuntime(t, cfg)
			if _, err := r.Start(context.Background()); !errors.Is(err, ErrProtocol) && !errors.Is(err, ErrUnavailable) {
				t.Fatalf("err = %v, want ErrProtocol or ErrUnavailable", err)
			}
		})
	}
}

// Each failure discards the interpreter; the next call gets a fresh one.
func TestEmbeddedFailuresDiscardAndRestart(t *testing.T) {
	cases := map[string]error{
		"test.loop":     ErrTimeout,
		"test.garbage":  ErrProtocol,
		"test.wrong_id": ErrProtocol,
		"test.huge":     ErrProtocol,
		"test.raise":    ErrProtocol,
		"test.exit":     ErrProtocol,
	}
	for capName, want := range cases {
		t.Run(capName, func(t *testing.T) {
			var logs bytes.Buffer
			r := fakeEmbedded(t, nil, capName)
			r.cfg.Logger = slog.New(slog.NewTextHandler(&logs, nil))
			ping(t, r, "before")
			first := r.w.(*embedded)
			start := time.Now()
			err := r.Call(context.Background(), capName, map[string]any{}, nil)
			if !errors.Is(err, want) {
				t.Fatalf("err = %v, want %v", err, want)
			}
			if d := time.Since(start); d > 5*time.Second {
				t.Fatalf("failure took %s", d)
			}
			if strings.Contains(err.Error(), "MRN") || strings.Contains(logs.String(), "MRN") {
				t.Fatalf("Python error text leaked: %v / %s", err, logs.String())
			}
			if r.w != nil {
				t.Fatal("failed interpreter kept")
			}
			select {
			case <-first.closed: // a Python loop stops at the deadline, so the interpreter is finalised
			case <-time.After(10 * time.Second):
				t.Fatal("failed interpreter not finalised")
			}
			time.Sleep(5 * time.Millisecond) // RestartDelay
			ping(t, r, "after")
		})
	}
}

func TestEmbeddedOutputIsValidatedStrictly(t *testing.T) {
	r := fakeEmbedded(t, nil, "test.extra")
	var out PingOutput
	if err := r.Call(context.Background(), "test.extra", map[string]any{}, &out); !errors.Is(err, ErrInvalidOutput) {
		t.Fatalf("unknown field: err = %v", err)
	}
	ping(t, r, "kept")
}

func TestEmbeddedPrintIsDropped(t *testing.T) {
	r := fakeEmbedded(t, nil, "test.print")
	var out PingOutput
	if err := r.Call(context.Background(), "test.print", map[string]any{}, &out); err != nil {
		t.Fatal(err)
	}
	if n := r.w.outputBytes(); n == 0 {
		t.Fatal("print() output was not counted")
	}
}

func TestEmbeddedEnvironmentIsNotInherited(t *testing.T) {
	t.Setenv("HMS_PYWORKER_SENTINEL", "secret")
	r := fakeEmbedded(t, []string{"PASSED=yes"}, "test.env")
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

// The interpreter cannot read host files, open connections or start processes.
func TestEmbeddedSandbox(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	host, err := filepath.Abs(realScript)
	if err != nil {
		t.Fatal(err)
	}
	port := strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
	r := embeddedRuntime(t, Config{Script: filepath.Join("testdata", "fake_embedded.py"),
		Env:          []string{"HOST_FILE=" + host, "HOST_PORT=" + port},
		Capabilities: []Capability{PingCapability(), {Name: "test.escape", Timeout: 10 * time.Second}}})
	var out map[string]bool
	if err := r.Call(context.Background(), "test.escape", map[string]any{}, &out); err != nil {
		t.Fatal(err)
	}
	for _, way := range []string{"file", "network", "subprocess"} {
		if seen, ok := out[way]; !ok || seen {
			t.Errorf("%s escape: %v (present %t)", way, seen, ok)
		}
	}
}

func TestEmbeddedCallerCancellation(t *testing.T) {
	r := fakeEmbedded(t, nil, "test.loop")
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(100*time.Millisecond, cancel)
	if err := r.Call(ctx, "test.loop", map[string]any{}, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestEmbeddedLingeringInterpretersBlockStart(t *testing.T) {
	r := embeddedRuntime(t, Config{})
	r.lingering.Store(maxLingering)
	if _, err := r.Start(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
	r.lingering.Store(0)
	r.failed = time.Time{}
	ping(t, r, "after")
}

func TestEmbeddedClosedRuntime(t *testing.T) {
	r := embeddedRuntime(t, Config{})
	ping(t, r, "x")
	e := r.w.(*embedded)
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-e.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("interpreter not finalised on Close")
	}
	if err := r.Call(context.Background(), PingName, PingInput{}, &PingOutput{}); !errors.Is(err, ErrClosed) {
		t.Fatalf("err = %v", err)
	}
}
