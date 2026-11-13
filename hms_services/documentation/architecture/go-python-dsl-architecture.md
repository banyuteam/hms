# Go Core + Python DSL Architecture

Go is the execution authority. Python is an authoring/compiler language and optional isolated extension runtime.

## Go owns
- Authentication and authorization enforcement.
- Transaction boundaries and authoritative writes.
- API and workflow orchestration.
- Capability registry and invocation.
- Event publishing/consumer reliability.
- Worker lifecycle, resource limits and audit.

## Python owns
- DSL authoring and compiler.
- Declarative mapping and workflow definitions.
- Approved rule/transform extensions.
- Specialized computation in isolated workers where justified.

## IR boundary
IR is language-neutral, typed, versioned, deterministic, capability-declared and independently validated by Go. Do not place Python bytecode or arbitrary source code in IR.

## Worker boundary
Use typed RPC, deadlines, scoped inputs, bounded resources and output validation. Do not provide unrestricted database credentials or general network access. Treat worker output as untrusted.
Implemented by `runtimes/go-runtime/pyworker` (ADR-SVC-011): one supervisor with two engines, an external Python child
process or CPython embedded through go-python (pure Go, no cgo), both behind the same protocol and checks.
