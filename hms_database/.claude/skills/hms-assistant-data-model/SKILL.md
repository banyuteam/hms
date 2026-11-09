---
name: hms-assistant-data-model
description: Design PostgreSQL persistence, schema ownership, migrations, constraints, versioning, and audit metadata for the deterministic HMS assistant.
---

# HMS Database — Assistant Data Model

## Objective

Provide the persistence foundation required by a deterministic assistant without duplicating canonical HMS domain data.

## Inspect first

Inspect:
- existing schemas and ownership documentation
- workflow, platform, terminology, audit, integration, clinical, billing, and finance schemas
- migration conventions
- roles and grants
- existing catalogue structures
- current audit and retention strategy

Do not automatically create an `assistant` schema. Propose the best ownership location based on existing architecture and record the decision in an ADR.

## Ownership boundaries

Database owns:
- schema and migration definitions
- integrity constraints
- indexes
- versioned persisted rule configuration if required
- catalogue source/release metadata
- durable evaluation/action audit metadata
- data dictionary and ERDs

Database does not own:
- Go evaluation runtime
- HTTP APIs
- frontend state
- authorization decisions
- rule execution orchestration

## Data model

Use `contracts/rule-data-model-proposal.md` as a starting point only.

Potential logical entities:
- rule sets
- immutable rule versions
- rule definitions
- activation scopes
- workflow definitions/versions where centrally configured
- catalogue source and release
- evaluation audit
- action audit

Before adding tables, check whether an existing canonical table or schema already covers the need.

## Rule configuration

Persist declarative data only. No executable code, SQL fragments, scripts, arbitrary function names, or dynamic expressions.

Use typed fields and constrained operators. Validate semantic correctness in Go before publication.

## Versioning and lifecycle

- Published versions immutable.
- Separate activation from version content.
- Preserve author, reviewer, approver, timestamps, and reason where required.
- Support effective dates and facility scope.
- Evaluation audit references exact rule version.
- Rollback changes active pointer, not historical content.

## Catalogue governance

Record source authority, catalogue identifier, release/version, effective dates, import timestamp, licence/usage metadata, artifact checksum, and validation status where applicable.

Do not mix ICD code sets, grouper releases, tariff tables, and provider-specific policies as if they were one catalogue.

## Integrity and operations

- Use appropriate PK/FK/unique/check constraints.
- Use NUMERIC for financial values where relevant.
- Add indexes based on actual query plans.
- Use transactions for publication/activation.
- Apply least-privilege roles.
- Avoid PHI in generic rule configuration and audit payloads.
- Define retention and archival.
- Provide reversible migrations where practical and tested rollback procedures.

## Deliverables

- reviewed ERD
- ownership ADR
- migration files
- constraints/index rationale
- data dictionary
- seed/import strategy
- retention and access policy
- migration and rollback tests
