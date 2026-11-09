# HMS Architecture Implementation Roadmap v4

This roadmap sequences the new workspace-level platform and declarative UI engine without destabilizing existing HMS workflows.

## Workstream 0 — Baseline and architecture freeze
- Inventory actual repository structure, build commands, existing UI tokens and backend modules.
- Confirm PostgreSQL 18 compatibility and current migration tooling.
- Create ADRs for shared PostgreSQL topology, Control Plane boundaries and UI IR.
- Acceptance: ownership matrix approved; no existing workflow or legacy database is modified.

## Workstream 1 — Shared PostgreSQL foundation
- Define schema ownership and database roles.
- Implement migration tooling, local dev database and health checks.
- Add migration CI, integrity tests and backup/restore runbook.
- Acceptance: runtime account cannot perform DDL; frontend has no DB credentials; legacy account is SELECT-only.

## Workstream 2 — Go configuration and IAM foundation
- Typed config loader, startup validation and secret references.
- Identity, role, permission and facility scope integration.
- Session lifecycle and audit events.
- Acceptance: authorization tests cover positive, negative and cross-facility cases.

## Workstream 3 — Security telemetry and policy
- Normalize auth, authorization, session and ingress security events.
- Add counters, dashboards and initial detection rules.
- Implement alert/incident lifecycle and reversible response actions.
- Acceptance: test replay demonstrates detection, deduplication, audit and safe rollback.

## Workstream 4 — UI IR contract and compiler vertical slice
- Define JSON Schema/typed model and component registry.
- Build Python DSL with Screen, Section, TextField, NumberField and Button.
- Compile deterministically and run independent Go validation.
- Acceptance: golden tests, malformed IR rejection, deterministic artifact hash and version compatibility.

## Workstream 5 — React renderer vertical slice
- Map five semantic components to existing design-system components.
- Add loading/error/unsupported states and safe action dispatch.
- Preserve existing AppShell and one existing workflow.
- Acceptance: visual/accessibility regression passes; no arbitrary code execution; no direct DB access.

## Workstream 6 — Authorized data and actions
- Register one patient summary data source and one clinical assessment save action.
- Enforce explicit context references and Go authorization.
- Add idempotency, audit and server-side validation.
- Acceptance: unauthorized and stale references fail safely; duplicate submission is handled.

## Workstream 7 — Publication governance
- Draft, compile, validate, review, approve, publish, assign and rollback.
- Persist immutable IR artifacts and publication metadata.
- Acceptance: rollback restores prior active version without mutating history.

## Workstream 8 — Expand carefully
- Add form, table, chart, workflow and dashboard components only as needed.
- Consider mobile-compatible IR subset only after web contract stabilizes.
- Consider separate services/databases only after measured operational need.

## Non-negotiable release gates
- No arbitrary code execution from DSL/IR.
- No client-side authorization authority.
- No direct frontend database connection.
- No PHI in metric labels or unnecessary logs.
- Existing UI and clinical workflow regression tests pass.
- Migrations, observability, secrets, backup/restore and rollback are verified.
