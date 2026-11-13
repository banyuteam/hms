package pyworker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	gopy "github.com/goccy/go-python"
	pyfs "github.com/goccy/go-python/fs"
)

const (
	// The worker's sources are copied under /hms in the interpreter's in-memory filesystem, the script as
	// /hms/hms_worker.py.
	embeddedDir    = "hms"
	embeddedModule = "hms_worker"
	// Bounds on the worker's sources, so a misplaced Script cannot pull a large tree into every interpreter.
	maxSourceFiles = 512
	maxSourceBytes = 8 << 20
	// go-python ignores a memory cap below the interpreter's initial WebAssembly memory; refuse one that low.
	minEmbeddedMemoryMB = 64
	// A discarded interpreter stuck in a call that ignores cancellation (one long C-level operation) keeps its memory
	// and a goroutine until the call returns. Past this many, no new interpreter starts.
	maxLingering = 2
)

// embedded is one go-python interpreter running the worker script as a module. Go calls hms_worker.call_line with
// one request line and gets one response line back: the same pyworker/1 envelope as the process engine, checked by
// the same code. The interpreter is confined by construction: an in-memory filesystem with only the standard library
// and the worker's sources (workerSources), an environment of Config.Env alone, and no name resolution, network or
// subprocess (go-python's Resolve, Dial and Exec stay nil, which denies them all).
type embedded struct {
	r       *Runtime
	py      *gopy.Python
	call    gopy.FunctionValue // hms_worker.call_line(line, max_line) -> line
	maxLine int
	output  *counter
	once    sync.Once
	closed  chan struct{} // closed when the interpreter has been finalised
}

type embeddedResult struct {
	line []byte
	err  error
}

func (r *Runtime) spawnEmbedded(ctx context.Context) (worker, Info, error) {
	if n := r.lingering.Load(); n >= maxLingering {
		return nil, Info{}, fmt.Errorf("%w: %d stopped interpreters are still running", ErrUnavailable, n)
	}
	ctx, cancel := context.WithTimeout(ctx, r.cfg.StartTimeout)
	defer cancel()
	files, err := workerSources(r.cfg.Script)
	if err != nil {
		return nil, Info{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	output := &counter{}
	// The protocol is not on stdout here; print() is counted and dropped like stderr.
	py, err := newInterpreter(files, r.cfg.Env, r.cfg.MaxMemoryMB, output)
	if err != nil {
		return nil, Info{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	e := &embedded{r: r, py: py, maxLine: r.cfg.MaxLineBytes, output: output, closed: make(chan struct{})}
	info, err := e.start(ctx)
	if err != nil {
		e.kill()
		if ctx.Err() != nil {
			return nil, Info{}, fmt.Errorf("%w: no handshake within %s", ErrUnavailable, r.cfg.StartTimeout)
		}
		return nil, Info{}, err
	}
	return e, info, nil
}

// workerSources reads what the embedded interpreter imports: every .py file under the script's directory (the adapter
// package hms_runtime and the capability modules), keyed by slash path, with the script itself as hms_worker.py. Test
// files (test_*.py), caches, hidden and testdata directories are left out.
func workerSources(script string) (map[string][]byte, error) {
	root := filepath.Dir(script)
	files := map[string][]byte{}
	total := 0
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if p != root && (name == "__pycache__" || name == "testdata" || strings.HasPrefix(name, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(name) != ".py" || strings.HasPrefix(name, "test_") || !d.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		src, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		total += len(src)
		if len(files) >= maxSourceFiles || total > maxSourceBytes {
			return fmt.Errorf("more than %d files or %d bytes of Python under %s", maxSourceFiles, maxSourceBytes, root)
		}
		files[filepath.ToSlash(rel)] = src
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("read worker sources: %v", err)
	}
	src, err := os.ReadFile(script)
	if err != nil {
		return nil, fmt.Errorf("read worker script: %v", err)
	}
	files[embeddedModule+".py"] = src
	return files, nil
}

// newInterpreter starts a confined go-python instance: an in-memory filesystem holding the standard library and files
// (name -> source) under /hms, the environment env alone, guest stdout and stderr into output, and memoryMB as the
// WebAssembly memory cap (0 = none). Resolve, Dial and Exec stay nil: no name resolution, network or subprocess.
func newInterpreter(files map[string][]byte, env []string, memoryMB int, output io.Writer) (*gopy.Python, error) {
	fsys, err := pyfs.NewStdlibMemFS()
	if err != nil {
		return nil, fmt.Errorf("standard library: %v", err)
	}
	for name, src := range files {
		if err := fsys.WriteFile(embeddedDir+"/"+name, src, 0o444); err != nil {
			return nil, fmt.Errorf("load %s: %v", name, err)
		}
	}
	py, err := gopy.New(gopy.Config{
		FS:             fsys,
		Env:            append([]string(nil), env...),
		Stdout:         output,
		Stderr:         output,
		MaxMemoryBytes: memoryMB << 20,
	})
	if err != nil {
		return nil, fmt.Errorf("start interpreter: %v", err)
	}
	return py, nil
}

// start imports the worker module, binds call_line and checks the handshake from hello_line.
func (e *embedded) start(ctx context.Context) (Info, error) {
	if err := e.py.AddPath(ctx, "/"+embeddedDir); err != nil {
		return Info{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	mod, err := e.py.Import(ctx, embeddedModule)
	if err != nil {
		return Info{}, fmt.Errorf("%w: import worker: %s", ErrUnavailable, pythonErr(err))
	}
	hello, err := function(ctx, mod, "hello_line")
	if err != nil {
		return Info{}, err
	}
	if e.call, err = function(ctx, mod, "call_line"); err != nil {
		return Info{}, err
	}
	memory := "none"
	if e.r.cfg.MaxMemoryMB > 0 {
		memory = "applied" // enforced by the host on the interpreter's linear memory, not by the worker
	}
	v, err := hello.Call(ctx, gopy.ValueOf(memory))
	if err != nil {
		return Info{}, fmt.Errorf("%w: handshake: %s", ErrProtocol, pythonErr(err))
	}
	line, err := e.line(v)
	if err != nil {
		return Info{}, err
	}
	return e.r.checkHello(line)
}

func function(ctx context.Context, mod gopy.ModuleValue, name string) (gopy.FunctionValue, error) {
	v, err := mod.Attr(ctx, name)
	if err != nil {
		return gopy.FunctionValue{}, fmt.Errorf("%w: worker has no %s", ErrProtocol, name)
	}
	fn, err := gopy.As[gopy.FunctionValue](v)
	if err != nil {
		return gopy.FunctionValue{}, fmt.Errorf("%w: worker %s is not a function", ErrProtocol, name)
	}
	return fn, nil
}

// roundTrip runs call_line aside: go-python stops Python code at the next bytecode boundary when ctx ends, but one
// long C-level operation runs on, and the caller must not wait for it past its deadline.
func (e *embedded) roundTrip(ctx context.Context, req []byte) ([]byte, error) {
	done := make(chan embeddedResult, 1)
	go func() {
		var res embeddedResult
		defer func() {
			if v := recover(); v != nil {
				res = embeddedResult{err: fmt.Errorf("%w: interpreter panicked", ErrUnavailable)}
			}
			done <- res
		}()
		v, err := e.call.Call(ctx, gopy.ValueOf(string(req)), gopy.ValueOf(e.maxLine))
		if err != nil {
			res.err = fmt.Errorf("%w: call_line: %s", ErrProtocol, pythonErr(err))
			return
		}
		res.line, res.err = e.line(v)
	}()
	select {
	case res := <-done:
		return res.line, res.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// line checks that a worker function returned one protocol line within the limit.
func (e *embedded) line(v gopy.Value) ([]byte, error) {
	s, err := gopy.As[gopy.StrValue](v)
	if err != nil {
		return nil, fmt.Errorf("%w: worker returned %s, not a line", ErrProtocol, v.Kind())
	}
	if len(s.String())+1 > e.maxLine {
		return nil, fmt.Errorf("%w: line longer than the limit", ErrProtocol)
	}
	return []byte(s.String()), nil
}

// kill finalises the interpreter aside: Close waits for a call still running, which may take until that call
// returns. Until then the interpreter counts as lingering.
func (e *embedded) kill() {
	e.once.Do(func() {
		e.r.lingering.Add(1)
		go func() {
			_ = e.py.Close()
			e.r.lingering.Add(-1)
			close(e.closed)
		}()
	})
}

func (e *embedded) stop() {
	e.kill()
	select {
	case <-e.closed:
	case <-time.After(3 * time.Second):
	}
}

func (e *embedded) exited() <-chan struct{} { return nil } // it cannot end on its own; failures surface in a call
func (e *embedded) outputBytes() int64      { return e.output.n.Load() }
func (e *embedded) logAttrs() []any         { return []any{"engine", EngineEmbedded} }

// pythonErr names a failure without its message: a Python exception's text or traceback may quote patient data.
func pythonErr(err error) string {
	if pe := (*gopy.PythonError)(nil); errors.As(err, &pe) {
		return "raised " + pe.Type
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err.Error()
	}
	if _, ok := gopy.ExitCode(err); ok {
		return "worker exited"
	}
	return "host error"
}
