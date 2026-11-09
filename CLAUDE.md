# hms — Root Instructions

## 1. Mission and architecture
This workspace contains four independently owned engineering projects:
- `hms_database`: persistence, canonical data model, schemas, migrations, data integrity and database-level governance.
- `hms_services`: backend execution, APIs, business workflows, authorization enforcement, integrations, event processing and AI orchestration.
- `hms_workspace`: user-facing experiences: web, native Android and native iOS.
- `hms_desktop`: native workstation runtime (Rust) that hosts the `hms_workspace` web app in a WebView and adds native capabilities through a typed bridge (ADR-ROOT-001).

The projects form one healthcare platform. They MUST remain consistent through versioned contracts, shared terminology, architecture decisions and this root instruction set. They are not one codebase and must not acquire overlapping ownership.

The governing principle is: **one healthcare platform, multiple purpose-built experiences, explicit domain and platform boundaries.**

## 2. Instruction precedence
When instructions conflict, apply this order:
1. Applicable law, patient safety, privacy and security requirements.
2. Approved Architecture Decision Records (ADRs) and versioned contracts.
3. This root `CLAUDE.md`.
4. Project-level `CLAUDE.md`.
5. Relevant `.claude/skills/**/SKILL.md`.
6. Local implementation conventions.

Do not silently override a higher-level rule. Identify the conflict and propose an ADR or contract change.

## 3. Mandatory work protocol
Before changing code:
1. Inspect the actual repository structure, package manifests, existing code, tests and current conventions.
2. Read root and project `CLAUDE.md` files and applicable skills.
3. Identify the owning project and domain.
4. Identify upstream/downstream contracts and consumers.
5. Preserve working behavior unless a change is explicitly required.
6. For cross-project changes, list every affected project and contract before implementation.

Before completion:
1. Run relevant formatting, linting, type checks, tests and build commands available in the repository.
2. Report commands actually run and their results. Never claim tests passed if not run.
3. Update documentation, contracts, changelogs and ADRs when behavior or boundaries change.
4. Identify migration, rollout, compatibility, security and operational implications.
5. Never invent APIs, schema fields, environment variables, credentials, test results or production readiness.

## 4. Project ownership boundaries
### `hms_database`
Owns:
- PostgreSQL 18 schema design, constraints, indexes, migrations and database integrity.
- Canonical Domain Model (CDM), stable resource identifiers and persistence contracts.
- Clinical Read Model (CRM) and other governed query projections.
- Audit, provenance, retention, backup and database performance design.
- Legacy schema inventory, read-only query catalog, mappings and persistence for checkpoints/reconciliation.
- Persistence structures for outbox, assistant conversation metadata and context-reference audit where approved.

Does NOT own:
- HTTP APIs, workflow orchestration, broker clients, runtime polling schedulers, AI prompts or UI state.
- Runtime authorization decisions made by application services.
- Direct application workflow implementation.

### `hms_services`
Owns:
- Go backend runtime, APIs, application orchestration and business rules.
- Authentication integration and authoritative authorization enforcement.
- Commands, queries, transaction boundaries and controlled resource resolution.
- Legacy Read Polling Adapter execution and reconciliation workflows.
- Outbox publishing, event broker integration and idempotent consumers.
- Digital-signature workflow, verification endpoints, assistant orchestration, retrieval/tool governance and audit integration.
- Versioned API, event and cross-platform context contracts.

Does NOT own:
- Frontend navigation, visual design, client-side workflow tab state or native UI components.
- Direct UI access to database tables.
- Unrestricted execution of user-supplied code or AI-generated SQL.

### `hms_workspace`
Owns:
- Web, Android and iOS user experiences.
- Presentation, navigation, workflow-instance lifecycle and client-side state.
- Design tokens and platform-specific UI components.
- Explicit assistant-context selection and presentation of resource references.
- API client integration and client-side error/loading/empty states.

Does NOT own:
- Authoritative business rules, patient access authorization, financial posting rules, clinical signing authority or direct database access.
- A second implementation of backend domain logic.
- The complete web interface replicated wholesale into native mobile clients.

### `hms_desktop`
Owns:
- Rust desktop runtime: windows, WebView hosting, lifecycle and OS integration.
- WebView navigation policy and the typed, allowlisted native bridge and its versioned contract.
- Local device access, background-agent lifecycle and workstation configuration.
- Desktop packaging, signing, distribution and updates (ADR-DSK-003).

Does NOT own:
- HMS screens, the design system or design tokens (owned by `hms_workspace`; reused, not forked).
- Authentication, authorization, business rules or authoritative workflow state (owned by `hms_services`).
- Any database connection, to PostgreSQL or the legacy MySQL.
- Unrestricted shell, filesystem, SQL or dynamic native invocation from WebView content.

## 5. Cross-project contracts
All cross-project communication MUST use documented, versioned contracts:
- API contracts: `hms_services/contracts/api/`.
- Event contracts: `hms_services/contracts/events/`.
- Database migration and schema contracts: `hms_database/`.
- Shared platform and domain contracts: `hms_workspace/contracts/` or the agreed central contract location.
- Assistant context-reference contract: shared contract, enforced by `hms_services`.
- Mobile capability registry: authored/maintained by `hms_workspace`, validated by backend policy.
- Desktop bridge contract: `hms_desktop/contracts/bridge/`, authored by `hms_desktop`, consumed by `hms_workspace`. The bridge grants native capabilities only, never business authorization.

A consumer MUST NOT infer undocumented database structure or depend on another project's internal implementation.

## 6. Healthcare safety and privacy
- Treat patient, clinical, identity, financial and audit data as sensitive.
- Apply least privilege, tenant and organization boundaries, purpose limitation and resource-level authorization.
- Frontend visibility is not authorization.
- Every backend request must authenticate and authorize independently.
- Never place secrets, private keys, passwords, access tokens or refresh tokens in source control or browser/mobile bundles.
- Minimize PHI in logs, telemetry, events, prompts and error messages.
- Do not fabricate clinical facts, diagnoses, results, signatures, provenance or external verification outcomes.
- Clearly distinguish recorded facts, derived values, external knowledge and AI-generated explanations.
- Human approval is required for consequential clinical actions unless a separately approved clinical governance policy explicitly defines otherwise.

## 7. Legacy system rules
The legacy HMS MySQL database is treated as a protected external source:
- Read-only credentials and SELECT-only access.
- No schema changes, triggers, indexes, stored procedures, writes or changes to its application connection.
- Polling and reconciliation runtime belongs to `hms_services`.
- Legacy schema inventory, query catalog and mapping documentation belong to `hms_database`.
- Polling observation time is not the original business-event time.
- Distinguish observed legacy changes from verified canonical domain events.

## 8. Events and transactions
- PostgreSQL is the authoritative persistence platform for new native transactions.
- Use a transactional outbox where reliable event publication is required.
- Assume at-least-once event delivery; consumers must be idempotent.
- Do not introduce full Event Sourcing or a broker merely because events are used.
- REST is appropriate for synchronous commands/queries; events support asynchronous propagation.
- Do not put unnecessary PHI in event payloads.

## 9. AI and assistant governance
- The assistant is not an authorization authority or source of truth.
- Every assistant request involving resources MUST carry explicit resource references selected by the user in the client.
- Never infer assistant context from the active tab, currently selected patient, global workspace state or prior unrelated conversation.
- `hms_services` resolves and authorizes every reference, then retrieves only permitted data.
- Client-provided IDs are untrusted input.
- Assistant outputs must distinguish source-backed facts from general explanations and disclose when context is unavailable.
- AI tools must be allowlisted, typed, scoped and audited. No unrestricted SQL, shell, filesystem or arbitrary code execution.

## 10. Security-sensitive first-time enrollment
Where first-time enrollment uses an employee/user identifier as a temporary bootstrap password, this is a narrowly scoped enrollment mechanism only:
- The identifier is not a permanent password and must never be accepted as a normal reusable credential after enrollment.
- Enforce one-time enrollment state, expiry, rate limiting, lockout/abuse controls and secure transport.
- Require identity proofing or a separately approved activation control appropriate to the organization's risk.
- Require the user to set a new secret/PIN and complete required MFA/device binding before normal access.
- Never log or store the bootstrap password in plaintext.
- Do not implement this rule unless the identity/security owner has approved the complete flow.

## 11. Architecture change discipline
Create an ADR for material changes to:
- Project ownership or deployment boundaries.
- Canonical identifiers or domain semantics.
- Database engines/schema ownership.
- Authentication, authorization, signature or audit behavior.
- Event delivery semantics.
- Assistant context isolation or retrieval.
- Platform capability scope.
- Cross-platform contracts.

An ADR must include context, decision, alternatives, consequences, security/privacy impact, migration plan and status.

## 12. Output expectations
Prefer concrete implementation plans, file paths, interfaces, data-flow diagrams, acceptance criteria and test cases. Separate confirmed repository facts from recommendations and assumptions. Keep the architecture incremental: implement a vertical slice before broad abstractions.

## 13. Containerization and delivery is mandatory
Every deployable web/backend component MUST have a documented, reproducible container build and deployment path before a release is considered complete.

### Workspace-level delivery ownership
- Root workspace owns the coordinated Docker Compose topology, environment conventions, shared networks, local development orchestration and release documentation.
- `hms_services` owns service Dockerfiles, runtime entrypoints, service health endpoints, graceful shutdown and service-specific runtime configuration.
- `hms_workspace/web` owns its web build/runtime Dockerfile and static-serving configuration.
- `hms_database` owns database schema/migration artifacts and database operational guidance; it does not own application container orchestration.
- Android/iOS remain native deliverables. Docker may provide reproducible CI build tooling where supported, but Apple signing, provisioning, Android signing and store release remain platform-specific workflows.
- `hms_desktop` is a native deliverable, not a container. Its installer, code signing, distribution and updates follow ADR-DSK-003; signing keys never enter the repository.

### Required environments
Maintain separate, explicit configurations for:
1. Local development: source mounts or fast rebuilds, development diagnostics, local PostgreSQL 18 where appropriate, seeded non-production data, and optional integration profiles.
2. CI/test: reproducible builds, isolated ephemeral dependencies, migrations, contract/integration/security tests.
3. Production: immutable versioned images, non-root processes, minimal runtime layers, health/readiness checks, controlled secrets, private networks, persistent storage, TLS ingress, backups, observability and rollback strategy.

Do not use a development Dockerfile/Compose configuration as a production deployment without a documented production hardening review.

### Docker security baseline
- Pin base images to approved versions; use digest pinning for production where operationally practical.
- Use multi-stage builds and minimal runtime images.
- Run as non-root; drop Linux capabilities; enable `no-new-privileges` where supported.
- Never bake secrets, credentials, certificates or production data into images or build arguments.
- Use runtime secret mounts or an approved secret manager. Do not commit populated `.env` files.
- Use read-only root filesystems where compatible; define explicit writable volumes/tmpfs.
- Expose only required ports. Keep database and internal service ports off public ingress.
- Add health checks and graceful shutdown.
- Scan images/dependencies and produce an SBOM for release artifacts.
- Set CPU/memory limits appropriate to the deployment platform.
- Use named volumes or managed persistent storage for stateful services; never rely on container filesystem persistence.

### Database and legacy constraints
- PostgreSQL 18 is the new-system database target, subject to validated compatibility and operational support.
- Database migrations must be versioned, reviewed, repeatable where possible and executed as a controlled one-shot release step.
- Backups, restore drills, migration rollback/forward-fix strategy and retention are required for production.
- The existing legacy MySQL remains external and read-only. Never add it as a writable managed dependency in the new Compose stack or run migrations against it.
- Local development may use synthetic or de-identified data only unless a separately approved data handling process exists.

### Release gate
A release is not "production-ready" merely because `docker compose up` succeeds. Require:
- Successful clean build from declared source.
- Configuration and secret validation.
- Database migration plan and tested execution.
- Health/readiness checks.
- Unit, integration, contract and security tests appropriate to change.
- Image vulnerability scan and SBOM.
- TLS and ingress review.
- Backup/restore and rollback plan.
- Monitoring, logs, metrics and alerting.
- Resource sizing and capacity review.
- Deployment runbook and release/version metadata.
- Explicit verification of legacy read-only credentials and network scope.

### No false readiness claims
Claude MUST distinguish:
- development-ready,
- CI/test-ready,
- staging-ready,
- production-ready.

Do not claim production readiness without inspecting the actual deployment target, secrets management, TLS, storage, backup/restore, monitoring, security scan and operational runbooks.


## 14. Workspace Control Plane and shared platform
- Treat shared IAM, runtime configuration, security/threat detection, workflow, eventing, integration, AI governance, notifications and licensing as reusable platform capabilities.
- `hms_services` owns runtime behavior and enforcement; `hms_database` owns persistence definitions; `hms_workspace` owns presentation only.
- A shared PostgreSQL cluster is an infrastructure capability, not unrestricted shared table access.
- Start with a modular Go backend and one PostgreSQL cluster/database with multiple schemas where practical. Split databases/services only with an ADR and operational justification.
- Maintain least-privilege schema-scoped credentials. Separate runtime, migration, reporting and legacy identities.
- Never let web, Android, iOS or desktop connect directly to PostgreSQL.

## 15. Runtime configuration and secrets
- Separate deployment bootstrap settings, secret material, runtime policies and observability settings.
- Environment variables/mounted files provide deployment bootstrap configuration; secret managers provide private keys and credentials; versioned database policies provide only explicitly reloadable operational policy.
- Never store secret values in PostgreSQL policy tables or commit populated environment files.
- Never expose secrets in browser bundles, Docker images, logs, traces, errors or metrics.
- Database pool sizing, ports, TLS termination and process resource limits are deployment configuration unless a tested reload lifecycle explicitly supports otherwise.
- Runtime policy cannot disable mandatory authentication, authorization, audit, tenant isolation or transport security.

## 16. Security monitoring and threat detection
- Collect normalized signals from ingress, authentication, authorization, sessions, device events, clinical resource access, integrations and infrastructure.
- Separate high-volume metrics/logs from durable security incidents and audit evidence.
- Use multi-signal detection, documented thresholds, false-positive handling and versioned rules.
- Automated responses must be scoped, auditable, reversible and policy-controlled.
- DDoS mitigation requires upstream/CDN/WAF/network controls; application telemetry alone is insufficient.
- Minimize PHI in telemetry and never use patient identifiers or tokens as metric labels.

## 17. Python Declarative UI Engine
- The Python UI DSL is a trusted authoring/build-time language for source-controlled definitions; it is not executed in the browser and is not an unrestricted user scripting environment.
- Python compiles to typed, versioned, JSON-compatible UI IR.
- Go validates IR, resolves and authorizes data sources, publishes definitions and executes registered actions.
- React renders allowlisted IR components using the existing Banyumanik 2 design system.
- Never allow arbitrary Python, JavaScript, HTML, CSS, SQL, network calls, dynamic imports or arbitrary function names from UI definitions.
- Data bindings must reference approved backend data sources; actions must use registered action IDs.
- UI visibility is not authorization. Go reauthorizes every resource and action.
- Published definitions are immutable and versioned; promotion and rollback are audited.
- Preserve existing hand-built React screens and migrate only selected workflows incrementally.
- Assistant-generated UI is an untrusted proposal and must pass the same compiler, security, approval and publication process.

## 18. Cross-project consistency gate
Before completing a cross-project feature, verify:
1. Project ownership and data owner are explicit.
2. API/event/IR contract is versioned and documented.
3. Database migrations and runtime access roles are coordinated.
4. Authorization, tenant/facility scope, audit and privacy are defined.
5. Failure, retry, idempotency and rollback behavior are defined.
6. Web/mobile/desktop compatibility is explicit; no automatic mobile parity assumption; desktop bridge capabilities are versioned and feature-detected.
7. Tests cover contract, security, migration and end-to-end behavior.
8. Root and project instructions, architecture docs and Skills Catalog are updated where needed.
