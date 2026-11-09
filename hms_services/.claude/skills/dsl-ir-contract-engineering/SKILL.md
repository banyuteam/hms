---
name: dsl-ir-contract-engineering
description: >
  Defines the versioned Intermediate Representation between Python DSL and Go runtime, including schema evolution and validation.
---


# DSL IR Contract Engineering
IR is the stable language-neutral contract. Include explicit IR and definition versions, typed operations, inputs/outputs, declared capabilities, deterministic serialization/hash and diagnostics metadata. Reject unknown operations/versions. Validate in compiler and Go. Never include Python bytecode or arbitrary source.

Define operation semantics -> JSON Schema/protobuf -> compatibility/deprecation -> capability policy -> execution/error semantics -> cross-language golden fixtures -> Go validator tests -> publish versioned contract.
