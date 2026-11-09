---
name: ui-ir-contract-and-compiler
description: Define, compile, validate and version the HMS declarative UI intermediate representation shared by Go and React.
---
# UI IR Contract and Compiler

## Contract requirements
- Explicit `ir_version`, definition ID/version, metadata, component tree, data sources, actions and validation.
- Stable node IDs and allowlisted component types.
- Component-specific typed props.
- Typed bindings and registered action IDs.
- Bounded depth, node count, string sizes and collection sizes.
- Deterministic serialization and content hash.
- Compatibility negotiation between server and renderer.

## Compiler pipeline
Parse trusted DSL -> build typed AST -> semantic checks -> registry validation -> IR generation -> JSON Schema validation -> deterministic canonicalization -> hash -> publish candidate.

## Runtime validation
Go must validate the IR independently; never trust Python compiler output alone. Reject unknown components, props, data sources, actions, unsupported IR versions and unsafe expressions.

## Versioning
Published versions are immutable. Use explicit major/minor/patch compatibility rules. Keep source DSL, compiler version, IR schema version, artifact hash and publication metadata traceable.

## Tests
Golden compiler tests, malformed payload tests, unknown-node tests, compatibility tests, deterministic hash tests, boundary-size tests and fuzz tests.
