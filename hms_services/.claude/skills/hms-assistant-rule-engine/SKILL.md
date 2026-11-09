---
name: hms-assistant-rule-engine
description: Design and implement the authoritative deterministic rule engine in hms_services using typed rules, bounded evaluation, versioning, authorization, provenance, and audit.
---

# HMS Services — Deterministic Assistant Rule Engine

## Objective

Create the first assistant backend in Go as a deterministic rule engine. There is currently no chatbot backend or assistant API. Do not add an AI model, LLM, agent loop, prompt orchestration, embeddings, or vector database.

## Inspect before implementation

Inspect:
- Go service layout and module boundaries
- existing HTTP routing and middleware
- authentication and authorization
- tenant/facility scoping
- database repositories and transaction patterns
- workflow and audit infrastructure
- terminology/catalogue services
- existing rules or validation logic that should be reused

Do not create duplicate infrastructure if a canonical service already exists.

## Core architecture

Separate:
- transport/API handlers
- application use cases
- domain rule definitions and evaluator
- rule registry/version resolver
- context/resource resolver
- catalogue/reference-data services
- action registry/executor
- persistence repositories
- audit and observability

Keep domain logic independent of HTTP and PostgreSQL details.

## Deterministic evaluator

A rule evaluation must be a pure or side-effect-free operation over normalized inputs and a resolved context snapshot. Side effects belong to separately authorized action handlers.

For fixed rule version, normalized input, context/resource version, reference-data version, and explicit evaluation time, results must be deterministic.

Time-dependent rules receive `evaluatedAt` explicitly. Do not call `time.Now()` inside arbitrary rule functions.

## Safe rule representation

Use typed, allowlisted operators and operands. Never execute:
- stored Go/JavaScript/Python code
- SQL expressions from rule data
- shell commands
- arbitrary function names
- dynamic imports
- user-supplied expressions

Bound:
- rules per evaluation
- condition-tree depth
- operands and string sizes
- evaluation duration
- result count and output size

Reject unknown operators and invalid types.

## Rule registry and versioning

- Register known rule-set codes.
- Resolve approved immutable versions.
- Record exact version in every evaluation.
- Support effective dates and facility applicability.
- Separate draft, validated, approved, published, inactive, and retired lifecycle states as appropriate.
- Never mutate published versions.
- Support rollback through activation pointer changes.

## Authorization

Before resolving protected resources:
- authenticate caller
- enforce tenant and facility scope
- authorize requested purpose and action
- verify resource relationship and sensitivity
- apply minimum necessary access

A resource reference is not permission. The assistant cannot grant itself access.

## Evaluation result

Return structured status, outcome codes, severity, safe message keys/text, field references, allowlisted next action IDs, rule version, reference-data provenance, and evaluation timestamp.

Do not return raw rows or unrestricted clinical data.

## Evaluation versus execution

Keep evaluation side-effect-free. Actions such as attaching documents, changing a workflow, approving, signing, or submitting must use separate application use cases with:
- authentication
- authorization
- workflow-state checks
- explicit confirmation where required
- idempotency
- audit
- transaction boundaries

The assistant must not autonomously diagnose, prescribe, approve, sign, adjudicate claims, or submit claims.

## Audit

Persist only necessary metadata:
- evaluation ID
- actor and facility references
- rule-set/version
- outcome codes
- timestamp
- correlation ID
- context resource references as permitted
- reference-data versions

Avoid copying full PHI into audit records. Follow existing audit architecture and retention policy.

## Errors

Use stable error codes for invalid inputs, missing rules, unavailable versions, forbidden context, unavailable reference data, evaluation limits, and action rejection. Do not leak SQL, stack traces, credentials, or provider internals.

## Testing

- deterministic repeatability
- operator/type validation
- boundary conditions
- depth/time limits
- conflicting rule outcomes
- version selection and effective dates
- authorization denial
- facility isolation
- stale resource handling
- audit emission
- idempotent action execution
