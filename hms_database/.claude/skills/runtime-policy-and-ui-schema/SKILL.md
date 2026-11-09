---
name: runtime-policy-and-ui-schema
description: Model versioned runtime policies and declarative UI publication metadata in PostgreSQL safely.
---
# Runtime Policy and UI Schema Engineering

## Scope
Own persistence structures for runtime configuration policies and `ui_platform` definitions, versions, assignments and publication metadata.

## Rules
- Persist policy definitions and version history, not secret material.
- Use typed values or validated JSON documents with explicit schema versions.
- Record scope (environment, service, organization, facility, role) and precedence.
- Immutable published versions; active pointers may change through controlled promotion/rollback.
- UI IR is data, not executable code.
- Store source DSL in controlled source/version control; persist compiled IR with hash, compiler version and contract version.
- Store only secret references, never secret values.
- Include author, reviewer, approval, publication and rollback metadata.
- Add constraints and indexes for lookup and scope resolution.
- Test concurrent publication, stale versions, rollback and invalid policy rejection.
