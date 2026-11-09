---
name: hms-dsl-engineering
description: >
  Designs Python DSL authoring SDK, syntax, compiler, validation, diagnostics and versioned workflow definitions.
---


# HMS Python DSL Engineering
Python is an authoring interface, not production authority. Compile definitions to versioned IR. Keep syntax declarative and capability-oriented. Validate types, references, schemas and permissions. Definitions are immutable after approval. Prefer pure deterministic transforms. No direct production DB, filesystem, network or subprocess access from declarative DSL.

Workflow: define use case/operations -> typed syntax -> parse/validate -> compile canonical IR -> validate schema/policy -> diagnostics/source maps -> golden tests -> publish immutable hash/version -> activate through Go approval. Never serialize Python bytecode or arbitrary executable source.
