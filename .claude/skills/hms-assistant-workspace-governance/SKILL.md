---
name: hms-assistant-workspace-governance
description: Governs the deterministic, rule-based HMS assistant across hms_workspace, hms_services, and hms_database. Use when designing, implementing, reviewing, or changing assistant behavior, API boundaries, rule evaluation, catalogue governance, persistence, security, or cross-project integration.
---

# HMS Assistant — Workspace-Level Engineering Governance

## 1. Purpose

This skill is the canonical workspace-level engineering guide for the first-generation Hospital Management System (HMS) assistant.

The current assistant is **deterministic and rule-based**. The existing `hms_workspace` contains a working browser-based assistant. The current `hms_services` project does not yet contain an assistant backend, AI model, or approved assistant API contract.

The objective is to evolve the existing assistant incrementally across:

- `hms_workspace` — user experience and client integration.
- `hms_services` — authoritative deterministic rules, domain validation, authorization, and controlled actions.
- `hms_database` — persistence, catalogue provenance, version metadata, and durable audit records.

This skill replaces the need to maintain separate informal contract documents for these responsibilities. It defines the shared agreements and tells contributors how to implement them in the owning repository.

## 2. Non-negotiable scope

### In scope

- Button-based guided menus and deterministic rule-based conversation flows.
- Guided collection of user-provided information.
- Explicitly selected resource context.
- Deterministic rule evaluation.
- Healthcare catalogue lookup and version governance.
- Claim completeness and consistency checks.
- Read-only explanation and navigation assistance.
- Controlled, separately authorized actions.
- Auditability, testability, and future extensibility.

### Out of scope for the current phase

Do not introduce any of the following unless the project owner explicitly changes the scope:

- LLMs or AI model APIs.
- Autonomous AI agents or agent frameworks.
- Embeddings, vector databases, semantic retrieval, or RAG.
- Probabilistic or generative responses.
- Model-based clinical diagnosis or treatment recommendations.
- Autonomous claim adjudication or claim submission.

Do not describe the current assistant as AI-powered. It is a deterministic guided assistant.

## 3. Repository ownership

Every change must respect these boundaries.

### 3.1 `hms_workspace`

Owns:

- Assistant panel, conversation presentation, guided menus, buttons, and forms.
- Client-side presentation and navigation rules.
- Transient conversation and guided-flow state.
- Explicit user selection of assistant context.
- API client, request lifecycle, loading, empty, error, and unavailable states.
- Display of backend evaluation results and their provenance.
- Accessibility, responsive behavior, and integration with the existing HMS shell.

Must not own:

- Authoritative business validation.
- Authorization decisions.
- Claim eligibility decisions.
- Clinical or financial source-of-truth data.
- Secret material or privileged credentials.
- Direct database access.
- Side-effecting domain operations implemented only in the browser.

The existing RS Banyumanik 2 visual identity, design tokens, navigation, workflow behavior, and working assistant experience are the baseline. Extend them incrementally. Do not replace or redesign working screens without an explicit requirement.

### 3.2 `hms_services`

Owns:

- Go assistant API and runtime orchestration.
- Authentication and authorization.
- Resource resolution and tenant/facility/organization scope checks.
- Deterministic domain and claim rules.
- Authoritative catalogue lookup and matching.
- Validation of submitted user inputs.
- Registered action execution and domain workflow integration.
- Evaluation identifiers, audit records, and operational observability.
- Rule-set publication and runtime version selection.

The service must treat every client-supplied identifier, context reference, rule parameter, and action request as untrusted input.

### 3.3 `hms_database`

Owns:

- Database structures and migrations required by approved assistant capabilities.
- Rule-set metadata and immutable published rule versions, if persistence is required.
- Catalogue identity, source, version, effective date, and provenance metadata.
- Durable evaluation/audit persistence where database storage is appropriate.
- Constraints and indexes that protect data integrity.

Must not own:

- Runtime rule execution.
- API handlers or HTTP routing.
- Assistant conversation presentation.
- Go orchestration or provider integrations.
- Executable rules or arbitrary scripts stored in the database.

Before creating new tables or schemas, inspect existing ownership and reuse appropriate structures. Do not create a new schema merely because the feature is called an assistant.

## 4. Rule categories and execution boundaries

Classify every rule before implementation.

| Rule category | Owner | Examples |
|---|---|---|
| Presentation and navigation | `hms_workspace` | Show a menu, ask the next question, expand a help section |
| Deterministic domain validation | `hms_services` | Required claim fields, consistency checks, eligibility checks |
| Authorization and access policy | `hms_services` | User may view or act on a resource within a facility |
| Data integrity | `hms_database` | Foreign keys, uniqueness, not-null constraints, check constraints |
| Display formatting | `hms_workspace` | Labels, date formatting, status presentation |

A browser rule may guide a user through a workflow, but it must never be presented as an authoritative domain or authorization decision.

If the backend is unavailable:

- Navigation and non-authoritative help may continue.
- The UI must clearly indicate that authoritative validation is unavailable.
- Do not display a previous successful evaluation as if it were current.
- Do not silently convert an unavailable check into a passed check.

## 5. Deterministic rule-engine principles

The rule engine must be predictable, bounded, explainable, and testable.

### 5.1 Evaluation characteristics

A rule evaluation must:

- Be deterministic for the same normalized inputs, context, rule-set version, and evaluation semantics.
- Be side-effect-free.
- Identify the exact rule-set version used.
- Record or return an evaluation timestamp.
- Return structured findings, not only a natural-language paragraph.
- Distinguish errors, warnings, informational findings, and unevaluated checks.
- Explain which input or rule produced each finding.
- Avoid claiming that a check was performed when required data was missing or inaccessible.

Side effects must be handled by a separate, explicitly authorized action use case.

### 5.2 Rule representation

Use typed, allowlisted operators and operands. Examples may include:

- `equals`
- `not_equals`
- `in`
- `not_in`
- `exists`
- `is_empty`
- `greater_than`
- `greater_than_or_equal`
- `less_than`
- `less_than_or_equal`
- `date_before`
- `date_after`
- `all`
- `any`
- `not`

The actual supported operator set must be implemented and versioned in Go. Do not assume that an operator is supported merely because it appears in a rule definition.

Never evaluate arbitrary code from the database or client. Prohibit:

- `eval`, reflection-based arbitrary invocation, or dynamic function names.
- Arbitrary SQL or query fragments.
- Arbitrary Python, JavaScript, shell commands, templates, or expressions.
- Unbounded recursion, loops, or rule graphs.
- Unbounded input sizes, tree depth, execution time, or result size.

Validate rule definitions before publication and again at runtime where appropriate.

### 5.3 Rule lifecycle

Use an explicit lifecycle such as:

`draft -> validated -> approved -> published -> retired`

Requirements:

- Published versions are immutable.
- A change creates a new version.
- The active version is selected by an explicit publication/activation mechanism.
- Rollback means selecting a previously approved immutable version, not mutating historical content.
- Evaluation records identify the exact rule-set version.
- Approval and publication permissions are separate from ordinary rule authoring where the risk warrants it.

## 6. Shared API contract principles

The API is a proposed integration boundary until it is implemented and approved. Do not assume that any endpoint below already exists.

A possible initial REST surface is:

| Method | Proposed endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/assistant/capabilities` | Return supported assistant capabilities |
| GET | `/api/v1/assistant/guided-flows` | Return available guided flows |
| GET | `/api/v1/assistant/rule-sets` | Return available rule-set metadata |
| POST | `/api/v1/assistant/rules/evaluate` | Evaluate a deterministic rule set |
| POST | `/api/v1/assistant/actions/{actionId}/execute` | Execute a registered, authorized action |
| GET | `/api/v1/assistant/evaluations/{evaluationId}` | Retrieve an authorized evaluation result |

Adapt endpoint names and resource shapes to existing service conventions. Do not create duplicate endpoints if equivalent capabilities already exist.

### 6.1 API design requirements

- Use versioned REST routes consistent with the existing Go API.
- Define request and response DTOs explicitly.
- Validate all fields server-side.
- Apply authentication and authorization on every protected request.
- Enforce tenant, hospital, facility, department, and resource scope as applicable.
- Use pagination and bounded result sizes for list operations.
- Apply request size, execution time, and rate limits.
- Return stable machine-readable error codes and safe human-readable messages.
- Do not expose stack traces, SQL details, secrets, or unnecessary PHI.
- Use idempotency controls for side-effecting actions.
- Keep evaluation and action execution as separate operations.

### 6.2 Evaluation response semantics

A structured result should communicate, at minimum:

- `evaluationId`
- `status`
- `evaluatedAt`
- `ruleSetId`
- `ruleSetVersion`
- `findings`
- `summary`
- `dataCompleteness` or equivalent indication of missing inputs

Each finding should have stable identifiers and include:

- Rule identifier.
- Severity: `error`, `warning`, or `info`.
- Result: `passed`, `failed`, `not_applicable`, or `not_evaluated`.
- Safe explanation.
- Relevant field references or evidence references, where permitted.
- Remediation guidance, if defined.

Do not use a single Boolean `valid` field as the only result. A result may contain warnings, missing information, or unevaluated checks even when no hard error is present.

The exact DTO must be documented in the Go service and shared with the workspace through generated or maintained API types according to repository conventions.

## 7. Explicit context and privacy rules

Assistant context must be explicit, narrow, and independently authorized.

### 7.1 Context selection

- The user explicitly selects the patient, encounter, claim, document, or other resource to provide as context.
- Switching workflow tabs must not silently change assistant context.
- Do not infer context from the active tab, route, currently displayed patient, global selection, or previous unrelated conversation.
- A new conversation must not inherit prior context unless the user explicitly confirms it.
- Context references must be stable identifiers, not raw clinical records.
- Include version metadata when needed to detect stale context.

### 7.2 Backend authorization

For every context reference, `hms_services` must independently:

1. Authenticate the requesting user.
2. Resolve the referenced resource.
3. Verify tenant and facility/organization scope.
4. Verify the user's permission and relationship to the resource.
5. Verify the requested purpose and operation.
6. Retrieve only the minimum necessary information.
7. Reject or explicitly exclude unresolved or unauthorized references.

Never silently substitute another patient, encounter, claim, or document when a reference is invalid or unauthorized.

A resource identifier is not proof of permission. The assistant is not an authorization authority and must not bypass normal HMS access controls.

### 7.3 PHI handling

- Do not send full clinical records to the browser when a resource reference is sufficient.
- Do not include PHI in URLs, metric labels, routine logs, or error messages.
- Avoid retaining conversation content longer than the approved operational purpose requires.
- Apply access control and retention policy to persisted evaluation evidence.
- Return only the minimum information required to explain a result.

## 8. Healthcare catalogue governance

The assistant may support catalogues such as:

- ICD-10.
- ICD-9-CM.
- INA-CBG.
- iDRG.

Catalogue content must come from an approved official, licensed, or otherwise authorized source. Do not invent codes, descriptions, grouping logic, tariffs, reimbursement rules, or effective dates.

For each catalogue release, preserve where available:

- Catalogue identifier and name.
- Source organization.
- Source document or dataset reference.
- Version or release identifier.
- Effective-from and effective-to dates.
- Jurisdiction and applicable programme.
- Import timestamp.
- Content checksum or release hash.
- Approval/review status.
- Mapping provenance and known limitations.

Rules that depend on catalogue content must identify the catalogue version used.

Do not treat similar code labels as proof of semantic equivalence. Do not silently map an obsolete or invalid code to a replacement. Present ambiguity for user review.

The assistant may help users search and understand catalogue entries. It must not independently diagnose, prescribe, finalize clinical coding, adjudicate claims, approve reimbursement, or submit claims.

## 9. Controlled actions

A guided assistant may prepare or request an action, but execution must go through a registered backend use case.

Examples include opening an existing workflow, preparing a draft, or requesting a validation. Higher-impact actions require explicit user confirmation and the normal HMS approval process.

Requirements:

- Actions are identified by stable allowlisted IDs.
- The client cannot submit arbitrary function names or code.
- The backend re-authenticates or validates the current session as required.
- The backend authorizes the action against the current user, resource, facility, and workflow state.
- The backend validates all business invariants.
- Side effects use transactions and idempotency controls where appropriate.
- Irreversible or high-impact operations require explicit confirmation and any required approval.
- The assistant must not independently sign, finalize, approve, prescribe, adjudicate, or submit regulated records or claims.

## 10. Persistence and data-model guidance

Database design must follow existing `hms_database` conventions and schema ownership.

Potential persisted concepts include:

- Assistant capability metadata, if it requires administration.
- Guided-flow definitions or versions, if they are centrally managed.
- Rule-set metadata.
- Immutable rule-set versions.
- Rule publication and activation history.
- Catalogue release metadata and provenance.
- Evaluation metadata and selected findings, where durable audit is required.
- Action execution references and outcomes, where they are part of the audit trail.

Do not automatically persist every conversation message or every intermediate UI state.

Do not store executable scripts as rules. Persist declarative, validated data only.

Use:

- Stable primary keys.
- Explicit version fields.
- Foreign keys where ownership and lifecycle justify them.
- Unique constraints for version identity and idempotency.
- Appropriate indexes based on measured query patterns.
- UTC timestamps for persisted instants.
- Explicit retention and access policies.

Avoid storing unnecessary PHI in rule definitions, evaluation metadata, logs, or audit summaries. Large files belong in approved object storage, not ordinary relational columns.

## 11. Error and unavailable-state behavior

The workspace must distinguish:

- User input validation error.
- Authentication failure.
- Authorization denial.
- Resource not found.
- Stale resource/version.
- Unsupported capability.
- Rule-set unavailable.
- Catalogue version unavailable.
- Backend unavailable.
- Evaluation timeout.
- Partial evaluation.
- Action outcome unknown.
- Action rejected or failed.

For an uncertain side-effecting request, do not blindly retry. Query the action/evaluation status or reconcile the outcome using the backend's idempotency and execution records.

Never show a success state until the backend confirms success.

## 12. Security and audit

Security controls are enforced in `hms_services`, not by hiding buttons in React.

Required controls include:

- Authentication and authorization on every protected operation.
- Least-privilege service and database roles.
- Tenant/facility/resource isolation.
- Input validation and bounded evaluation.
- Rate limiting and abuse monitoring.
- Secret management outside source control and ordinary rule records.
- TLS for service communication.
- Safe error handling.
- Audit of rule publication, activation, evaluation, and action execution.
- Separation of author, reviewer, publisher, and executor permissions where appropriate.
- Tamper-resistant evidence for high-impact operations according to the wider HMS security design.

Audit records should identify the actor, operation, resource reference, outcome, timestamp, and relevant rule/catalogue versions. Store only the minimum necessary sensitive data.

## 13. Observability

Instrument the assistant using the existing HMS observability approach.

Useful metrics include:

- Evaluation count and outcome by rule-set/version.
- Evaluation latency and timeout count.
- Rule validation and publication failures.
- Catalogue lookup latency and miss rate.
- Action execution count and outcome.
- Authorization denial count.
- Backend dependency failures.
- Rate-limit events.

Do not use patient IDs, MRNs, claim IDs, names, or other high-cardinality or sensitive identifiers as metric labels.

Logs should use correlation IDs and safe resource references. Traces should not capture request bodies containing PHI.

## 14. Testing requirements

### Workspace tests

- Guided-flow navigation and state transitions.
- Explicit context selection and clearing.
- Context does not change when switching tabs.
- Backend unavailable and stale-result states.
- Rendering of all finding severities and result states.
- Keyboard navigation and accessibility.
- Preservation of existing HMS shell and design tokens.

### Services tests

- Deterministic evaluation for identical inputs and versions.
- Each supported operator and invalid operator.
- Missing, malformed, excessive, and unexpected inputs.
- Rule depth, size, and execution-time limits.
- Authorization and facility isolation.
- Unauthorized and unresolved context references.
- Immutable published versions.
- Idempotency and duplicate action requests.
- Error, timeout, and partial-evaluation semantics.
- Audit creation and sensitive-data redaction.

### Database tests

- Migration up/down or forward-only migration policy as adopted by the project.
- Referential integrity and uniqueness.
- Version immutability enforcement strategy.
- Catalogue provenance and effective-date integrity.
- Least-privilege database role behavior.
- Retention and access constraints.

### Cross-project contract tests

- Workspace DTOs match the implemented service API.
- Service persistence matches approved database migrations.
- Unsupported API or rule versions fail safely.
- Unknown fields and unsupported operators are rejected.
- No client-controlled value can bypass authorization.

## 15. Incremental implementation roadmap

Do not attempt a large rewrite. Work in vertical slices.

### Phase 1 — Baseline and inventory

1. Inspect the existing browser-based assistant in `hms_workspace`.
2. Document current guided flows, local rules, state transitions, and user-visible behavior.
3. Identify which rules are presentation-only and which are authoritative domain decisions.
4. Inspect existing Go API conventions and database schemas before proposing new structures.
5. Record gaps and propose an ADR for any cross-project change.

Deliverable: current-state inventory and an approved responsibility map.

### Phase 2 — Shared types and API design

1. Define versioned request/response DTOs.
2. Define stable error codes and evaluation semantics.
3. Define explicit context-reference format.
4. Define rule-set and catalogue version identifiers.
5. Review the contract across all three repositories before implementation.

Deliverable: reviewed API/type specification. This is an implementation agreement, not a requirement to create a separate `contracts/` directory.

### Phase 3 — First deterministic evaluation

1. Select one low-risk, non-clinical or administrative guided validation.
2. Implement a small allowlisted rule evaluator in Go.
3. Keep evaluation side-effect-free.
4. Add unit, boundary, and security tests.
5. Return structured findings with rule-set version and evaluation ID.

Deliverable: one tested backend evaluation endpoint.

### Phase 4 — Workspace integration

1. Add an API client using existing workspace patterns.
2. Preserve the current assistant interface.
3. Connect one guided flow to the backend evaluation.
4. Display loading, partial, unavailable, error, and success states correctly.
5. Keep presentation-only guidance available where safe.

Deliverable: one end-to-end assistant workflow.

### Phase 5 — Catalogue governance

1. Identify approved catalogue sources and licensing requirements.
2. Define import and validation procedures.
3. Persist release provenance and effective dates.
4. Add catalogue version-aware lookup.
5. Add tests for obsolete, ambiguous, and missing codes.

Deliverable: governed lookup for one approved catalogue release.

### Phase 6 — Controlled actions and expansion

1. Introduce registered action IDs only when a real workflow requires them.
2. Separate evaluation from execution.
3. Add explicit confirmation, authorization, idempotency, and audit.
4. Expand to additional guided flows and catalogues incrementally.
5. Reassess architecture based on measured requirements.

Deliverable: a controlled, auditable assistant capability set.

## 16. Change-management rules for Claude Code

When working on this system:

1. Identify which repository owns the requested change before editing.
2. Read that repository's `CLAUDE.md`, relevant local skills, API conventions, and existing implementation.
3. Inspect existing code and schema before proposing new abstractions.
4. Preserve working behavior and existing Banyumanik 2 UI design.
5. Do not invent endpoints, tables, catalogue records, or business rules.
6. If a shared interface changes, update all affected repositories in the same change plan.
7. Record material architectural decisions as ADRs in the canonical engineering workspace.
8. Do not copy divergent versions of shared API definitions into multiple repositories.
9. Generate or validate API types from the canonical source where the project supports it.
10. Make small, reviewable changes with tests.
11. Report files changed, behavior changed, migrations required, tests run, and known limitations.
12. If a requirement conflicts with this skill, identify the conflict and ask for clarification rather than silently changing the architecture.

## 17. Definition of done

A change is not complete merely because the UI appears to work.

A cross-project assistant feature is complete when:

- Ownership boundaries are respected.
- The browser does not make authoritative security or domain decisions.
- Backend validation is deterministic and bounded.
- Context is explicit and independently authorized.
- Rule and catalogue versions are traceable.
- Side effects are separate, authorized, and idempotent where required.
- PHI exposure is minimized.
- Errors and unavailable states are truthful.
- Tests cover normal, boundary, failure, and security behavior.
- Existing HMS screens and workflows remain intact.
- Documentation and ADRs reflect the implemented behavior.
