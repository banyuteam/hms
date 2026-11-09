---
name: python-ui-dsl-engineering
description: Design trusted Python authoring APIs for declarative HMS web screens, forms and layouts that compile to typed UI IR.
---
# Python UI DSL Engineering

## Purpose
Provide a Python authoring language for repository-controlled declarative UI definitions. Python is a build/authoring tool, not a browser runtime or unrestricted user scripting environment.

## Required architecture
Python DSL -> compiler -> typed/versioned UI IR -> validation/publication -> Go runtime -> React renderer.

## DSL design
- Prefer declarative constructors such as Screen, Section, Field, DataSource and Action.
- Use stable IDs and explicit versions.
- Keep component properties typed and schema-backed.
- Bind only to approved data-source IDs and typed field paths.
- Reference registered action IDs, never Python callbacks or arbitrary function names.
- Keep layout, data, validation, permissions and action intent separate.
- Avoid arbitrary expressions; if conditional logic is needed, define a restricted, typed expression grammar.

## Safety
- Only trusted source-controlled definitions are compiled.
- Never execute user-supplied Python to render a screen.
- No arbitrary SQL, JavaScript, HTML, CSS, network access or filesystem access in UI definitions.
- Do not put clinical records or secrets into definitions.
- Assistant-generated definitions are untrusted proposals and require normal validation and publication approval.

## Quality
Provide compiler diagnostics with source locations, deterministic output, golden tests, schema validation, version compatibility tests and migration guidance.
