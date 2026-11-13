# ADR-SVC-011: Python worker runtime supervised by Go

- Status: Proposed (2026-11-11); amended 2026-11-12 with a second engine, CPython embedded through go-python
  (see Amendment 1)
- Date: 2026-11-11
- Owners: hms_services
- Affected projects: hms_services only (no API, event or schema change); deployment (future packaging, step 3)
- Related: `go-python-dsl-architecture.md` (worker boundary), skills `python-extension-runtime` and
  `plugin-capability-governance`; ADR-SVC-009 (reverted 2026-11-09: an HTTP AI bridge, not this runtime)

## Context
`CLAUDE.md` gives Go the worker lifecycle and resource limits, and lets Python run approved transformations and
specialised computation "in isolated workers". The empty folders `runtimes/python-workers/{claim-processing,
clinical-rules,data-transformation}` are waiting for such workers, but there was no way for Go to run one. Root
`CLAUDE.md` §12 asks for a vertical slice before broad abstractions.

## Decision
1. **Separate process, not an embedded interpreter.** Package `runtimes/go-runtime/pyworker` starts
   `python -I -B runtimes/python-workers/hms_worker.py` as a child process. The `hms-services` binary stays static
   and CGO-free on distroless. A worker crash cannot take the Go process with it.
2. **Protocol pyworker/1:** one JSON object per line on stdin/stdout. The worker first sends a handshake (protocol
   version, worker version, capability list, memory-limit status), then answers one request at a time:
   `{"v":1,"id","capability","input"}` → `{"v":1,"id","ok":true,"output"}` or
   `{"ok":false,"error":{"code","message"}}`. The worker's docstring is the reference.
3. **Capabilities are allowlisted on both sides.** In Python, a capability is a function listed in `CAPABILITIES`.
   There is no dynamic import, so a request cannot reach code that is not listed. In Go, `Config.Capabilities` names
   the capabilities a caller may use, and the handshake must list every one of them or start-up fails. The only
   capability in v1 is `runtime.ping` (liveness).
4. **Go bounds and distrusts every call:**
   - a per-capability wall-clock timeout (default 5 s), which includes waiting for the process;
   - an input limit (default 64 KiB) and a line limit in both directions (default 1 MiB);
   - strict decoding, where unknown fields and trailing data are errors, plus an optional `Validate` hook;
   - error codes must match `^[a-z][a-z0-9_]{0,39}$`, and messages are cut to 200 bytes.
5. **Failure handling:**
   - A timeout, crash, oversized line, wrong id or malformed envelope kills the process. The next call starts a new
     one, but no sooner than `RestartDelay` (1 s), so a crash loop cannot become a spawn storm.
   - A capability refusal (`WorkerError`) or invalid output keeps the process running.
   - A caller's own cancellation is reported as the context error. The capability's timeout is reported as
     `ErrTimeout`.
6. **Isolation the runtime itself provides:**
   - Python runs in isolated mode (`-I`: no `PYTHON*` variables, no user site, no script directory on `sys.path`).
   - The worker inherits no environment from the parent, apart from `SYSTEMROOT` on Windows, which CPython needs.
     So no database URL, key or secret can leak in by accident.
   - The worker never gets database credentials.
   - stderr is discarded; only its size is logged, because a traceback may quote patient data. The worker sends
     `print()` to stderr, and its errors never echo the input.
   - `MaxMemoryMB` is applied by the worker as `RLIMIT_AS` on POSIX. With `RequireLimits`, a worker that could not
     apply it (Windows, or a failed call) is refused.
7. **Not wired into `serve`.** No extension capability is approved yet. `hms-services check-python-worker` starts the
   worker, prints the handshake and one ping, then stops it. It needs no database or configuration. No environment
   variable is added.

## Alternatives considered
1. **Embedded CPython via cgo** (not to be confused with go-python, which has no cgo; see Amendment 1): this breaks
   the static distroless build, shares one address space (a worker fault
   kills the server) and gives no wall-clock control over a stuck interpreter.
2. **A pure-Go Python dialect (Starlark, gpython):** it is not Python, so the DSL SDK and libraries would not run. It
   stays an option for small declarative expressions, but that is a separate decision.
3. **A long-running HTTP or gRPC worker service:** it adds a network listener, authentication between services and
   a deployment unit for each worker, which is more than v1 needs. Stdio keeps the worker off the network by
   construction. A socket transport can be added behind the same `Call` API if workers ever move to their own
   container.

## Consequences and limits (not a sandbox)
- A process is not a sandbox. Filesystem and network confinement, CPU quota and seccomp are the deployment's job
  (container, cgroups, no egress). Until step 3 lands, this runtime is **development-ready only**.
- The production image (`Dockerfile`, distroless static) has no Python, so the runtime cannot be used in a container
  yet.
- One process serves one call at a time. More throughput means a pool, added only when a real capability needs it
  and with measurements.
- Capability code is trusted, reviewed source. Its outputs are still validated as untrusted.

## Rollout
1. This change: runtime, `runtime.ping`, check command, tests. No behaviour change in `serve`.
2. First real capability, with its own ADR or amendment: justification, input/output schema, threat model, owner,
   risk class, limits and the Go caller with its authorization and audit.
3. Packaging: a worker-capable image (pinned Python base, non-root, read-only root filesystem, no egress) and
   `RequireLimits` in production, coordinated with `deployment/`.

Rollback: delete the package and the command. Nothing depends on them yet.

## Acceptance criteria
- [x] Go tests (`runtimes/go-runtime/pyworker`): handshake, ping, refusal keeps the process, every failure kills and
  restarts, restart delay, strict output, environment not inherited, caller cancellation, serialised concurrency,
  close, config validation, memory limit (applied on Linux, refused on Windows with `RequireLimits`).
- [x] Python unit tests (`runtimes/python-workers/test_hms_worker.py`): allowlist, malformed requests, no input
  echo, no exception detail, line bound.
- [ ] CI run on Linux, where `RLIMIT_AS` is applied.
- [ ] Owner approval of this ADR, then step 2.

## Amendment 1 (2026-11-12): embedded engine on go-python

### Context
The owner asked for a Python runtime built on [goccy/go-python](https://github.com/goccy/go-python). It is not the
cgo embedding rejected in Alternative 1. It runs CPython 3.14.6 compiled to WebAssembly, then transpiled to plain Go
by `goccy/pythonwasm2go`. There is no cgo, no system Python and no wasm runtime at execution time. Each instance owns
its memory, filesystem and environment. Module `github.com/goccy/go-python` v0.4.0 (published 2026-09-10, MIT; its
`fs/stdlib.zip` is a trimmed CPython standard library under the PSF licence) and `github.com/goccy/pythonwasm2go`
v0.4.0.

### Decision
1. **Two engines, one supervisor.** `Config.Engine` is `process` (the default, unchanged) or `embedded`
   (`runtimes/go-runtime/pyworker/embedded.go`). Both carry protocol pyworker/1 and go through the same Go checks
   from Decisions 3 to 5: allowlist and handshake, input and line limits, strict decoding, error-code format,
   discard and restart with `RestartDelay`. Only the transport differs.
2. **Same worker code.** The embedded engine copies `Script` into the interpreter and imports it as the module
   `hms_worker`. It calls `hello_line(memory)` once and `call_line(line, max_line)` per request, and each returns one
   protocol line. Both functions are in `hms_worker.py` and reuse `handle` and `encode`. A capability is written once
   and runs in either engine.
3. **Confinement by construction.** This is stronger than the process engine (Decision 6):
   - The filesystem is in memory and holds only the standard library and the script. No host path is visible.
   - The environment is `Config.Env` alone.
   - go-python's `Resolve`, `Dial` and `Exec` stay nil, which denies all name resolution, network connections and
     subprocesses (fail-closed).
   - `print()` and stderr go to a byte counter. Only the size is logged.
   - Errors name the Python exception type, never its message or traceback (`pythonErr`).
   - Tests show that reading a host file, connecting to a listening local port and starting a subprocess all fail.
4. **Memory.** `MaxMemoryMB` caps the interpreter's WebAssembly memory on every OS, so a Python allocation past the
   cap raises `MemoryError`. The handshake reports `applied`, so `RequireLimits` is satisfied on Windows too. A cap
   below 64 MiB is refused, because go-python silently ignores a cap below the initial memory. Tested at 64 and
   128 MiB.
5. **Timeouts.** A deadline stops Python code at the next bytecode boundary. The call returns at the deadline in any
   case, because it runs on its own goroutine, and the interpreter is discarded as in Decision 5. One long C-level
   operation cannot be pre-empted, so the discarded interpreter is closed in the background once that operation
   returns. While two of them are still running (`maxLingering`), no new interpreter starts (`ErrUnavailable`).
   Panics in a call are recovered and reported as `ErrUnavailable`.
6. **No engine choice yet.** The engine for each real capability is decided in Rollout step 2. Neither engine runs
   in `serve`. `hms-services check-python-worker -engine embedded` runs the handshake and a ping, with no Python
   installed.

### Consequences
- **Packaging.** The binary still builds with `CGO_ENABLED=0 GOOS=linux`, as the `Dockerfile` does (checked
  2026-11-12). The embedded engine can therefore run in the existing distroless image with no Python layer. For this
  engine, Rollout step 3 shrinks to limits, the SBOM and the licence notice.
- **Cost.**
  - The binary grows by about 20 MiB (56 MiB in total).
  - The transpiled source takes 229 MiB in the module cache.
  - A cold compile takes about 1 minute per target platform. After that it comes from the Go build cache, which CI
    should keep.
  - An interpreter starts in about 0.15 s (measured in the tests on Windows).
  - Each live instance uses about 52 MiB of Go heap (upstream figure).
- **Shared process.** Guest memory faults are wasm traps, which go-python recovers as errors. A fatal Go runtime
  failure, such as the host itself running out of memory, still takes hms-services down. Keep `MaxMemoryMB` set, and
  use the process engine plus a container for heavy or less trusted computation.
- **Dependency risk.**
  - Pre-1.0, a small project (v0.4.0, one maintainer) and a large amount of generated code.
  - Pin the version through `go.mod` and `go.sum`.
  - Review every upgrade.
  - List the PSF-licensed standard library in the SBOM.
  - The standard library is trimmed, so each capability must be tested on the embedded engine before that engine is
    approved for it.
- Readiness is unchanged: **development-ready only** until a real capability passes Rollout step 2.

### Acceptance criteria (amendment)
- [x] Go tests (`embedded_test.go`), with no Python installed:
  - handshake, ping and a refusal that keeps the interpreter;
  - each failure discards the interpreter and the next call restarts it: endless loop, garbage, wrong id, oversized
    line, a raise whose text is kept out of errors and logs, and `sys.exit`;
  - strict output, print dropped, environment not inherited;
  - escapes through the filesystem, network and subprocess are blocked;
  - memory cap: no `MemoryError` without a cap, `MemoryError` at 64 and 128 MiB;
  - caller cancellation, the lingering limit, close and config validation.
- [x] Python unit tests for `hello_line` and `call_line`.
- [x] The Python suite (`runtimes/python-workers/test_*.py`) also runs inside the embedded interpreter
  (`embedded_unittest_test.go`, through the same confined set-up as the engine), so a capability that depends on a
  standard-library module missing from the embedded build fails in `go test`. Two negative cases show that a failing
  test and a module that cannot be imported are both reported.
- [x] `CGO_ENABLED=0 GOOS=linux` build of `cmd/hms-services`.
- [ ] Linux CI run of the embedded tests, with the build cache configured.
- [ ] Owner approval of this amendment.

Rollback: set `Engine` back to `process` (the default), then delete `embedded.go`, its tests, `hello_line` and
`call_line`, and run `go mod tidy`.

### Addendum (2026-11-12): adapter package `hms_runtime`
Capability code is written against an adapter package instead of the raw protocol, so the same code runs in both
engines. This refines Decision 3. Allowlisting is unchanged: Python only knows the modules that `hms_worker.py`
imports, and Go allowlists the names again.

- `hms_runtime.capability(name, version, input, output)` registers a function. The name must be dotted lower-case,
  the version must look like `1`, `1.2` or `1.2.3`, and a name may be registered once only.
- `hms_runtime.schema` (`Str`, `Int`, `Float`, `Bool`, `List`, `Object`) checks the input before the function runs and
  the output after it returns.
  - Unknown fields are refused, and only their count is reported.
  - Errors give the field path, never the value.
  - A bad input is refused as `invalid_input`. An output outside the function's own schema is refused as
    `invalid_output`.
- `hms_runtime.protocol` and `hms_runtime.process` hold the protocol code that used to be in `hms_worker.py`.
  `hms_worker.py` is now only the entry point and the list of approved capability modules (`capabilities/`).
  - The process engine puts the script's directory on `sys.path`, because `-I` leaves it out.
  - The embedded engine loads every `.py` file under the script's directory (`workerSources`). It leaves out
    `test_*.py`, caches, hidden and `testdata` directories, and stops at 512 files or 8 MiB.
- The handshake format is unchanged. Capability versions are not reported to Go yet; that comes with the first real
  capability (Rollout step 2), together with audit of the worker version.
- Tests:
  - Python: the adapter tests (`test_hms_runtime.py`) and the worker tests run on the host Python and inside the
    embedded interpreter.
  - Go: `TestWorkerSources` checks which files are loaded. `TestEnginesAgree` checks that both engines give the same
    output, refusal code and message for the same requests.
- Authoring guide: `runtimes/python-workers/README.md`.
