package pyworker

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// process is one running worker: stdin for requests, a reader goroutine turning stdout into bounded lines.
type process struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	lines   chan []byte   // closed when stdout ends; readErr is then set
	readErr error         // written before lines is closed
	quit    chan struct{} // closed by kill
	done    chan struct{} // closed when the process has been reaped
	stderr  *counter
	once    sync.Once
}

func (r *Runtime) spawnProcess(ctx context.Context) (worker, Info, error) {
	ctx, cancel := context.WithTimeout(ctx, r.cfg.StartTimeout)
	defer cancel()
	args := []string{"-I", "-B", r.cfg.Script, "--max-line-bytes", strconv.Itoa(r.cfg.MaxLineBytes)}
	if r.cfg.MaxMemoryMB > 0 {
		args = append(args, "--max-memory-mb", strconv.Itoa(r.cfg.MaxMemoryMB))
	}
	cmd := exec.Command(r.cfg.Python, args...)
	cmd.Dir = filepath.Dir(r.cfg.Script)
	cmd.Env = r.env()
	cmd.WaitDelay = time.Second
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, Info{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	// Our own pipe, not StdoutPipe: Wait must not close stdout before the reader has drained it.
	outR, outW, err := os.Pipe()
	if err != nil {
		return nil, Info{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	cmd.Stdout = outW
	p := &process{cmd: cmd, stdin: stdin, lines: make(chan []byte), quit: make(chan struct{}),
		done: make(chan struct{}), stderr: &counter{}}
	cmd.Stderr = p.stderr
	if err := cmd.Start(); err != nil {
		outR.Close()
		outW.Close()
		return nil, Info{}, fmt.Errorf("%w: start %s: %v", ErrUnavailable, r.cfg.Python, err)
	}
	outW.Close()
	go p.read(outR, r.cfg.MaxLineBytes)
	go func() {
		_ = cmd.Wait()
		close(p.done)
	}()

	line, err := p.next(ctx)
	if err != nil {
		p.kill()
		if ctx.Err() != nil {
			return nil, Info{}, fmt.Errorf("%w: no handshake within %s", ErrUnavailable, r.cfg.StartTimeout)
		}
		return nil, Info{}, err
	}
	info, err := r.checkHello(line)
	if err != nil {
		p.kill()
		return nil, Info{}, err
	}
	return p, info, nil
}

func (p *process) read(r io.ReadCloser, maxLine int) {
	defer r.Close()
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 0, 64<<10), maxLine)
	for s.Scan() {
		select {
		case p.lines <- append([]byte(nil), s.Bytes()...):
		case <-p.quit:
			p.readErr = errors.New("stopped")
			close(p.lines)
			return
		}
	}
	p.readErr = s.Err()
	close(p.lines)
}

// next waits for one line from the worker.
func (p *process) next(ctx context.Context) ([]byte, error) {
	select {
	case b, ok := <-p.lines:
		if ok {
			return b, nil
		}
		if errors.Is(p.readErr, bufio.ErrTooLong) {
			return nil, fmt.Errorf("%w: line longer than the limit", ErrProtocol)
		}
		return nil, fmt.Errorf("%w: worker exited", ErrUnavailable)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// roundTrip writes one request line and waits for one response line. The write runs aside: a worker that stops
// reading must not block the caller past its deadline (kill unblocks it).
func (p *process) roundTrip(ctx context.Context, req []byte) ([]byte, error) {
	werr := make(chan error, 1)
	go func() {
		_, err := p.stdin.Write(append(req, '\n'))
		werr <- err
	}()
	select {
	case err := <-werr:
		if err != nil {
			return nil, fmt.Errorf("%w: write: %v", ErrUnavailable, err)
		}
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return p.next(ctx)
}

func (p *process) kill() {
	p.once.Do(func() {
		close(p.quit)
		_ = p.cmd.Process.Kill()
		_ = p.stdin.Close()
	})
}

// stop asks the worker to exit (stdin closed) and kills it after a grace period.
func (p *process) stop() {
	_ = p.stdin.Close()
	select {
	case <-p.done:
	case <-time.After(3 * time.Second):
	}
	p.kill()
}

func (p *process) exited() <-chan struct{} { return p.done }
func (p *process) outputBytes() int64      { return p.stderr.n.Load() }
func (p *process) logAttrs() []any         { return []any{"engine", EngineProcess, "pid", p.cmd.Process.Pid} }

// counter discards the worker's stderr and keeps only its size.
type counter struct{ n atomic.Int64 }

func (c *counter) Write(b []byte) (int, error) {
	c.n.Add(int64(len(b)))
	return len(b), nil
}
