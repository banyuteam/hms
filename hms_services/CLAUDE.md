# hms_services — Project Instructions

## Mission
Own runtime behavior and integrations. Go is the core execution authority; Python provides governed DSL authoring and optional isolated extensions.

## Baseline
- Go core runtime and orchestrator.
- PostgreSQL 18 for new application-owned persistence.
- Legacy MySQL connections are SELECT-only.
- Python DSL compiles to versioned IR.
- Optional Python workers run separately for approved complex extensions.
- REST for synchronous commands/queries; event streaming for asynchronous propagation.

## Owns
APIs, service lifecycle, domain orchestration, LRPA polling, change detection, canonical mapping execution, outbox publisher, broker integration, event consumers, DSL compiler integration, IR validation, Python worker orchestration, authorization enforcement and observability.

## Go/Python boundary
Go owns authentication/authorization enforcement, transaction boundaries, authoritative writes, workflow orchestration, capability invocation, event reliability and worker resource limits.
Python owns DSL authoring/compiler, declarative mappings/workflows, approved transformations and specialized computation in isolated workers.
Python must never bypass Go authorization, tenant boundaries, transaction controls or audit.

## Legacy rule
Use dedicated SELECT-only MySQL credentials. No DDL/DML or legacy schema changes. Polling state is stored in new-system PostgreSQL. Respect existing indexes, timeouts, batch limits and source load. Distinguish observation time from business occurrence time.

## Event reliability
Native transactions use transactional outbox. Assume at-least-once delivery; consumers are idempotent. Define ordering scope, retries, dead-letter and reconciliation. Do not publish full patient records.

## Workflow
Inspect patterns/contracts -> define capability and owner -> define API/command/query/event semantics -> define authorization and tenant scope -> define transaction/failure behavior -> implement tests/observability -> document rollout and rollback.


## Containerization and runtime delivery
- Maintain a multi-stage Dockerfile for each deployable Go service/runtime.
- Run as non-root with minimal runtime dependencies.
- Implement health/readiness endpoints and graceful SIGTERM shutdown.
- Read configuration from environment or mounted secret files; never bake secrets into images.
- Keep service/database ports private; only approved ingress is exposed.
- Document migrations as a controlled one-shot release task, not an uncontrolled startup side effect.
- Provide development and production Compose integration through the workspace root.
- Legacy MySQL remains an external read-only dependency; never provision or mutate it through this project.


## Workspace Control Plane
Implement shared runtime capabilities as modular Go packages/services with clear APIs and persistence ownership: configuration, IAM, security/threat detection, workflow, eventing, integration, AI governance and notifications. Do not split into independent microservices without an operational reason and ADR.

## Runtime configuration and security
- Parse bootstrap configuration into typed Go structs and validate at startup.
- Keep secrets in approved secret stores/mounted files; never log or persist plaintext secret material.
- Runtime policies are versioned, scoped and safely reloadable only where explicitly implemented.
- Go is the authority for authentication, authorization, rate limits, session validation and action enforcement.
- Threat rules must be explainable, versioned, testable and auditable; avoid high-impact automated action on a single weak signal.

## Python UI DSL and Go runtime
- Keep UI DSL distinct from existing domain/business DSL.
- Python UI definitions are trusted source-controlled authoring artifacts only.
- Compile definitions into the shared typed UI IR contract.
- Go independently validates IR, resolves approved data sources, enforces resource authorization and executes registered action IDs.
- Never execute arbitrary Python/JavaScript/SQL/HTML/CSS from UI definitions or client payloads.
- Published UI versions are immutable; promotion and rollback are audited.
- Assistant-generated UI must be treated as untrusted until validated and approved.
