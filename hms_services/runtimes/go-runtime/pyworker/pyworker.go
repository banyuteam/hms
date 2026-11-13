// Package pyworker runs approved Python capabilities in a worker supervised by Go (ADR-SVC-011). Go stays the
// authority: it starts and stops the worker, allowlists capability names, bounds every call (input size, output
// size, wall clock) and validates the output before a caller sees it. The worker's answers are untrusted input.
//
// Protocol pyworker/1 is one JSON object per line (runtimes/python-workers/hms_worker.py). Two engines carry it:
//   - EngineProcess (process.go): an external CPython as a child process, lines on its stdin/stdout. Network and
//     filesystem confinement belong to the deployment (a process is not a sandbox).
//   - EngineEmbedded (embedded.go): CPython inside hms-services on go-python (compiled to WebAssembly, transpiled to
//     Go, no cgo), one line in and one line out per call. The interpreter sees only an in-memory filesystem with the
//     standard library and the worker script; it has no network and cannot start processes.
//
// A worker serves one call at a time. A timeout, crash or protocol violation discards it; the next call starts a
// fresh one, but not sooner than RestartDelay after the failure. The worker gets no inherited environment, no
// database credentials and no secrets.
package pyworker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

const protocolVersion = 1

const (
	defaultMaxLineBytes  = 1 << 20
	defaultMaxInputBytes = 64 << 10
	defaultCallTimeout   = 5 * time.Second
	defaultStartTimeout  = 10 * time.Second
	defaultRestartDelay  = time.Second
	maxMessageBytes      = 200
)

var (
	ErrUnknownCapability = errors.New("pyworker: capability not allowed")
	ErrInputTooLarge     = errors.New("pyworker: input too large")
	ErrTimeout           = errors.New("pyworker: deadline exceeded")
	ErrUnavailable       = errors.New("pyworker: worker unavailable")
	ErrProtocol          = errors.New("pyworker: protocol violation")
	ErrInvalidOutput     = errors.New("pyworker: invalid output")
	ErrClosed            = errors.New("pyworker: runtime closed")
)

// WorkerError is a refusal from the capability itself (bad input, internal failure). The process stays up. Code is a
// short snake_case token; Message is written by the capability's author but still comes from the worker, so it is
// for logs and diagnostics, not for clients verbatim.
type WorkerError struct {
	Code    string
	Message string
}

func (e *WorkerError) Error() string { return "pyworker: worker refused: " + e.Code }

// Engine selects how the worker runs.
type Engine string

const (
	EngineProcess  Engine = "process"  // Config.Python runs Script as a child process (default)
	EngineEmbedded Engine = "embedded" // go-python runs Script inside hms-services; Config.Python must be empty
)

// Capability is one allowlisted worker function. The worker must list it in its handshake.
type Capability struct {
	Name          string        // dotted lower-case, e.g. runtime.ping
	Timeout       time.Duration // wall clock per call, waiting for the process included; default 5s
	MaxInputBytes int           // encoded input; default 64 KiB
	// Validate checks the output before it is decoded (strictly) into the caller's value. Optional.
	Validate func(output json.RawMessage) error
}

type Config struct {
	Engine       Engine // default EngineProcess
	Python       string // process engine: interpreter, e.g. /usr/bin/python3; run with -I -B (isolated, no bytecode)
	Script       string // runtimes/python-workers/hms_worker.py
	Capabilities []Capability
	MaxLineBytes int // per protocol line, both directions; default 1 MiB
	// MaxMemoryMB limits the worker's memory; 0 means none. The process engine's worker applies it to itself as an
	// address-space limit (POSIX only). The embedded engine caps the interpreter's WebAssembly memory (any OS, at
	// least 64 MiB), so a Python allocation past it raises MemoryError.
	MaxMemoryMB int
	// RequireLimits refuses a worker that could not apply MaxMemoryMB (the process engine on Windows). Use it in
	// production.
	RequireLimits bool
	StartTimeout  time.Duration // spawn to handshake; default 10s
	RestartDelay  time.Duration // after a failure; default 1s
	Env           []string      // KEY=VALUE for the worker; the parent environment is never inherited
	Logger        *slog.Logger
}

// Info is the running worker's handshake.
type Info struct {
	Worker       string
	Version      string
	Capabilities []string
	MemoryLimit  string // applied | unsupported | failed | none
}

type Runtime struct {
	cfg  Config
	caps map[string]Capability
	slot chan struct{} // one call per worker
	seq  atomic.Uint64
	// lingering counts discarded embedded interpreters still busy in a call that ignored cancellation.
	lingering atomic.Int32

	mu     sync.Mutex
	w      worker
	info   Info
	failed time.Time
	closed bool
}

// worker is one running interpreter behind the protocol: a child process (process.go) or an embedded instance
// (embedded.go). Only the slot holder calls roundTrip.
type worker interface {
	roundTrip(ctx context.Context, req []byte) ([]byte, error) // one request line in (no newline), one line out
	exited() <-chan struct{}                                   // closed if the worker ended on its own; may be nil
	stop()                                                     // graceful within a bound, then kill
	kill()                                                     // at once; idempotent
	outputBytes() int64                                        // stderr/print() bytes, discarded; size only
	logAttrs() []any
}

var (
	namePattern = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`)
	codePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)
)

func New(cfg Config) (*Runtime, error) {
	switch cfg.Engine {
	case "", EngineProcess:
		cfg.Engine = EngineProcess
		if cfg.Python == "" {
			return nil, errors.New("pyworker: the process engine needs Python")
		}
	case EngineEmbedded:
		if cfg.Python != "" {
			return nil, errors.New("pyworker: the embedded engine runs no external Python; leave Python empty")
		}
	default:
		return nil, fmt.Errorf("pyworker: unknown engine %q", cfg.Engine)
	}
	if cfg.Script == "" {
		return nil, errors.New("pyworker: Script is required")
	}
	if st, err := os.Stat(cfg.Script); err != nil || st.IsDir() {
		return nil, fmt.Errorf("pyworker: worker script %s not found", cfg.Script)
	}
	script, err := filepath.Abs(cfg.Script) // the process runs in the script's directory
	if err != nil {
		return nil, fmt.Errorf("pyworker: worker script: %w", err)
	}
	cfg.Script = script
	if cfg.MaxLineBytes <= 0 {
		cfg.MaxLineBytes = defaultMaxLineBytes
	}
	if cfg.StartTimeout <= 0 {
		cfg.StartTimeout = defaultStartTimeout
	}
	if cfg.RestartDelay <= 0 {
		cfg.RestartDelay = defaultRestartDelay
	}
	if cfg.MaxMemoryMB < 0 {
		return nil, errors.New("pyworker: MaxMemoryMB must not be negative")
	}
	if cfg.RequireLimits && cfg.MaxMemoryMB == 0 {
		return nil, errors.New("pyworker: RequireLimits needs MaxMemoryMB")
	}
	if cfg.Engine == EngineEmbedded && cfg.MaxMemoryMB > 0 && cfg.MaxMemoryMB < minEmbeddedMemoryMB {
		// go-python silently ignores a cap below the interpreter's initial memory.
		return nil, fmt.Errorf("pyworker: the embedded engine needs MaxMemoryMB of at least %d", minEmbeddedMemoryMB)
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.DiscardHandler)
	}
	for _, kv := range cfg.Env {
		if k, _, ok := strings.Cut(kv, "="); !ok || k == "" {
			return nil, fmt.Errorf("pyworker: Env entry %q is not KEY=VALUE", kv)
		}
	}
	if len(cfg.Capabilities) == 0 {
		return nil, errors.New("pyworker: no capabilities allowed")
	}
	caps := make(map[string]Capability, len(cfg.Capabilities))
	for _, c := range cfg.Capabilities {
		if !namePattern.MatchString(c.Name) {
			return nil, fmt.Errorf("pyworker: capability name %q is not dotted lower-case", c.Name)
		}
		if _, dup := caps[c.Name]; dup {
			return nil, fmt.Errorf("pyworker: capability %q listed twice", c.Name)
		}
		if c.Timeout <= 0 {
			c.Timeout = defaultCallTimeout
		}
		if c.MaxInputBytes <= 0 {
			c.MaxInputBytes = defaultMaxInputBytes
		}
		if c.MaxInputBytes >= cfg.MaxLineBytes {
			return nil, fmt.Errorf("pyworker: capability %q input limit must be below the line limit", c.Name)
		}
		caps[c.Name] = c
	}
	return &Runtime{cfg: cfg, caps: caps, slot: make(chan struct{}, 1)}, nil
}

// Start launches the worker now (instead of on the first call) and returns its handshake.
func (r *Runtime) Start(ctx context.Context) (Info, error) {
	select {
	case r.slot <- struct{}{}:
	case <-ctx.Done():
		return Info{}, ctx.Err()
	}
	defer func() { <-r.slot }()
	if _, err := r.ensure(ctx); err != nil {
		return Info{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.info, nil
}

// Call runs one allowlisted capability: input is encoded as JSON, the output is validated and decoded strictly
// (unknown fields are an error) into output, which must be a pointer.
func (r *Runtime) Call(ctx context.Context, name string, input, output any) error {
	c, ok := r.caps[name]
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownCapability, name)
	}
	in, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("pyworker: encode input: %w", err)
	}
	if len(in) > c.MaxInputBytes {
		return ErrInputTooLarge
	}
	id := strconv.FormatUint(r.seq.Add(1), 10)
	req, err := json.Marshal(request{V: protocolVersion, ID: id, Capability: name, Input: in})
	if err != nil {
		return fmt.Errorf("pyworker: encode request: %w", err)
	}
	if len(req)+1 > r.cfg.MaxLineBytes {
		return ErrInputTooLarge
	}

	callCtx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()
	select {
	case r.slot <- struct{}{}:
	case <-callCtx.Done():
		return deadlineErr(ctx)
	}
	defer func() { <-r.slot }()
	w, err := r.ensure(callCtx)
	if err != nil {
		if callCtx.Err() != nil {
			return deadlineErr(ctx)
		}
		return err
	}

	line, err := w.roundTrip(callCtx, req)
	if err != nil {
		if callCtx.Err() != nil {
			r.discard(w, "deadline")
			return deadlineErr(ctx)
		}
		r.discard(w, "io")
		return err
	}
	out, err := parseResponse(line, id)
	if err != nil {
		if we := (*WorkerError)(nil); !errors.As(err, &we) { // a refusal is a clean answer; the worker stays
			r.discard(w, "protocol")
		}
		return err
	}
	if c.Validate != nil {
		if err := c.Validate(out); err != nil {
			return fmt.Errorf("%w: %s: %v", ErrInvalidOutput, name, err)
		}
	}
	if output != nil {
		if err := decodeStrict(out, output); err != nil {
			return fmt.Errorf("%w: %s: %v", ErrInvalidOutput, name, err)
		}
	}
	return nil
}

// Close stops the worker (gracefully, then by force after a grace period) and refuses further calls.
func (r *Runtime) Close() error {
	r.mu.Lock()
	r.closed = true
	w := r.w
	r.w = nil
	r.mu.Unlock()
	if w != nil {
		w.stop()
	}
	return nil
}

// deadlineErr tells a caller's own cancellation apart from the capability's timeout.
func deadlineErr(parent context.Context) error {
	if err := parent.Err(); err != nil {
		return err
	}
	return ErrTimeout
}

// ensure returns the running worker or starts one. Only the slot holder calls it.
func (r *Runtime) ensure(ctx context.Context) (worker, error) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil, ErrClosed
	}
	if w := r.w; w != nil {
		select {
		case <-w.exited(): // exited while idle (e.g. out of memory)
			r.w, r.failed = nil, time.Now()
			r.cfg.Logger.Warn("python worker exited while idle", "stderr_bytes", w.outputBytes())
		default:
			r.mu.Unlock()
			return w, nil
		}
	}
	if !r.failed.IsZero() && time.Since(r.failed) < r.cfg.RestartDelay {
		r.mu.Unlock()
		return nil, fmt.Errorf("%w: restarting after a failure", ErrUnavailable)
	}
	r.mu.Unlock()

	var (
		w    worker
		info Info
		err  error
	)
	if r.cfg.Engine == EngineEmbedded {
		w, info, err = r.spawnEmbedded(ctx)
	} else {
		w, info, err = r.spawnProcess(ctx)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err != nil {
		r.failed = time.Now()
		return nil, err
	}
	if r.closed {
		w.kill()
		return nil, ErrClosed
	}
	r.w, r.info = w, info
	r.cfg.Logger.Info("python worker started", append(w.logAttrs(), "worker", info.Worker, "version", info.Version,
		"capabilities", info.Capabilities, "memory_limit", info.MemoryLimit)...)
	return w, nil
}

func (r *Runtime) discard(w worker, reason string) {
	r.mu.Lock()
	if r.w == w {
		r.w, r.failed = nil, time.Now()
	}
	r.mu.Unlock()
	w.kill()
	// Never the stderr content: a traceback may quote patient data.
	r.cfg.Logger.Warn("python worker stopped", append(w.logAttrs(), "reason", reason,
		"stderr_bytes", w.outputBytes())...)
}

// env is the worker's whole environment: nothing is inherited, so no credential can leak in by accident.
func (r *Runtime) env() []string {
	var env []string
	if runtime.GOOS == "windows" {
		// CPython on Windows needs SYSTEMROOT to initialise (random, sockets).
		if v, ok := os.LookupEnv("SYSTEMROOT"); ok {
			env = append(env, "SYSTEMROOT="+v)
		}
	}
	return append(env, r.cfg.Env...)
}

type request struct {
	V          int             `json:"v"`
	ID         string          `json:"id"`
	Capability string          `json:"capability"`
	Input      json.RawMessage `json:"input"`
}

type response struct {
	V      int             `json:"v"`
	ID     string          `json:"id"`
	OK     *bool           `json:"ok"`
	Output json.RawMessage `json:"output"`
	Error  *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type hello struct {
	V            int      `json:"v"`
	Ready        bool     `json:"ready"`
	Worker       string   `json:"worker"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
	Limits       struct {
		Memory string `json:"memory"`
	} `json:"limits"`
}

func (r *Runtime) checkHello(line []byte) (Info, error) {
	var h hello
	if err := decodeStrict(line, &h); err != nil {
		return Info{}, fmt.Errorf("%w: handshake: %v", ErrProtocol, err)
	}
	if h.V != protocolVersion || !h.Ready || h.Worker == "" {
		return Info{}, fmt.Errorf("%w: handshake: protocol %d, ready %t", ErrProtocol, h.V, h.Ready)
	}
	for name := range r.caps {
		if !slices.Contains(h.Capabilities, name) {
			return Info{}, fmt.Errorf("%w: worker does not provide %s", ErrProtocol, name)
		}
	}
	if r.cfg.RequireLimits && h.Limits.Memory != "applied" {
		return Info{}, fmt.Errorf("%w: memory limit %s, required applied", ErrUnavailable, h.Limits.Memory)
	}
	return Info{Worker: h.Worker, Version: h.Version, Capabilities: h.Capabilities, MemoryLimit: h.Limits.Memory}, nil
}

func parseResponse(line []byte, id string) (json.RawMessage, error) {
	var resp response
	if err := decodeStrict(line, &resp); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProtocol, err)
	}
	if resp.V != protocolVersion || resp.ID != id || resp.OK == nil {
		return nil, fmt.Errorf("%w: unexpected response envelope", ErrProtocol)
	}
	if !*resp.OK {
		if resp.Error == nil || resp.Output != nil || !codePattern.MatchString(resp.Error.Code) {
			return nil, fmt.Errorf("%w: malformed error", ErrProtocol)
		}
		return nil, &WorkerError{Code: resp.Error.Code, Message: truncate(resp.Error.Message, maxMessageBytes)}
	}
	if resp.Error != nil || len(resp.Output) == 0 || bytes.Equal(resp.Output, []byte("null")) {
		return nil, fmt.Errorf("%w: success without output", ErrProtocol)
	}
	return resp.Output, nil
}

// decodeStrict decodes exactly one JSON value with no unknown fields and nothing after it.
func decodeStrict(b []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errors.New("trailing data after JSON value")
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// PingName is the worker's built-in liveness capability.
const PingName = "runtime.ping"

type PingInput struct {
	Echo string `json:"echo"` // at most 64 characters
}

type PingOutput struct {
	Echo string `json:"echo"`
}

// PingCapability allowlists runtime.ping with tight limits.
func PingCapability() Capability {
	return Capability{Name: PingName, Timeout: 2 * time.Second, MaxInputBytes: 256}
}
