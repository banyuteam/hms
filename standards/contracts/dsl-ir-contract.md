# DSL Intermediate Representation (IR) Contract

The Python DSL is an authoring interface. Its compiled IR is the stable contract consumed by Go.

Requirements:
- Explicit `ir_version`, definition name/version and compiler metadata.
- Typed inputs/outputs and stable operation identifiers.
- Declared capabilities and permission requirements.
- Explicit trigger, execution mode and error policy.
- Deterministic serialization and content hash.
- Source location for diagnostics.
- No Python bytecode or arbitrary executable source in IR.

Go validates IR schema and policy again before activation. Only registered capabilities may execute. Go enforces tenant scope, authorization, deadlines, resource limits and transaction boundaries. Definitions are immutable after approval; rollback activates a previously approved version.
