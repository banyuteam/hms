---
name: canonical-domain-model
description: >
  Defines stable canonical HMS entities independent of legacy schemas and external standards.
---


# Canonical Domain Model
Canonical models express stable business meaning, not one-to-one legacy tables. Keep source identifiers in explicit cross-reference structures. Separate person/patient identity, encounter and account. Preserve provenance and terminology versions. Define lifecycle, status semantics and invariants. Distinguish observed legacy states from verified domain facts.

Workflow: identify concept/owner -> compare native/legacy/external forms -> define semantics/lifecycle -> identifiers and cross-references -> persistence/event impact -> document ambiguity and validation owner.
