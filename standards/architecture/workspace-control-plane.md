# HMS Workspace Control Plane

## Purpose
The Workspace Control Plane provides reusable platform capabilities to all HMS projects and runtime services. It is a logical architecture and service boundary, not a requirement to create a separate microservice for every capability.

## Shared capabilities
- Organization, facility and platform tenancy context.
- Identity and access management (IAM), role and permission metadata.
- Runtime configuration and policy distribution.
- Security event collection, threat detection, incident management and response governance.
- Workflow definitions, tasks, approvals and escalation metadata.
- Event registry, transactional outbox conventions, delivery and idempotency metadata.
- Integration registry, connection metadata, polling checkpoints and reconciliation state.
- AI assistant/model/prompt/tool registry, execution metadata and usage governance.
- Notification templates, preferences and delivery state.
- Module registry, feature entitlements and deployment compatibility metadata.
- Audit and operational read models.

## Ownership and enforcement
- `hms_services` implements runtime behavior and is the authority for authentication, authorization, policy enforcement, actions, workflow execution and event publication.
- `hms_database` owns PostgreSQL schema definitions, migrations, constraints, indexes, data dictionary and data governance.
- `hms_workspace` owns presentation and client state only. It consumes APIs and never connects directly to PostgreSQL.
- Root workspace owns cross-project architecture standards, contracts, Compose topology, release coordination and ADR governance.
- Monitoring products collect and visualize telemetry; they do not replace application authorization or audit evidence.

## Deployment model
Start with a modular Go backend and one PostgreSQL cluster/database with multiple schemas, where appropriate. Keep logical ownership explicit. A shared cluster is an infrastructure decision, not permission for every service to query every schema.

Use separate database roles and credentials per runtime/service and schema ownership boundary. Cross-domain access should normally occur through service APIs or explicit read models. Cross-schema foreign keys are permitted only where the architecture deliberately uses one database as a single transactional boundary and the owning teams agree.

## Evolution
Split schemas into separate databases or clusters only when justified by independent scaling, availability, security isolation, regulatory boundary, deployment ownership or operational needs. Document the split with an ADR and define data replication, consistency and failure semantics first.

## Non-goals
- No unrestricted shared database account.
- No frontend database access.
- No assumption that PostgreSQL is a message broker, object store, SIEM or secret manager.
- No premature database-per-microservice mandate.
