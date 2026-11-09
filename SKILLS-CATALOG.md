# Skills Catalog — hms

**Total: 55 focused Claude Skills** (11 shared, 9 database, 20 services, 15 workspace).

## Shared workspace skills
- `deployment-observability-backup`
- `docker-compose-workspace-orchestration`
- `docker-containerization`
- `engineering-quality-assurance`
- `healthcare-domain-engineering`
- `healthcare-interoperability`
- `healthcare-security-privacy`
- `hms-architecture-governance`
- `production-readiness-and-release`
- `workspace-control-plane-architecture`
- `workspace-security-governance`

## hms_database skills
- `canonical-domain-model`
- `clinical-data-modeling`
- `database-engineering`
- `database-migration-governance`
- `event-contract-engineering`
- `legacy-database-analysis`
- `postgresql-performance`
- `runtime-policy-and-ui-schema`
- `shared-postgresql-platform`

## hms_services skills
- `api-engineering`
- `backend-service-engineering`
- `canonical-mapping-engine`
- `dsl-ir-contract-engineering`
- `event-consumer-reliability`
- `event-streaming-engineering`
- `go-core-engineering`
- `hms-dsl-engineering`
- `integration-testing`
- `legacy-read-polling`
- `plugin-capability-governance`
- `python-extension-runtime`
- `python-ui-dsl-engineering`
- `runtime-config-control-plane`
- `security-threat-detection-engine`
- `service-observability`
- `service-security-iam`
- `ui-ir-contract-and-compiler`
- `ui-publication-and-action-runtime`
- `workflow-runtime-engineering`

## hms_workspace skills
- `accessibility-and-testing`
- `android-kotlin-engineering`
- `api-integration`
- `application-shell-workflow-dock`
- `assistant-context-reference`
- `existing-ui-preservation`
- `frontend-engineering`
- `frontend-security`
- `healthcare-ui-ux`
- `ios-swift-engineering`
- `mobile-capability-governance`
- `react-ui-ir-renderer`
- `signature-experience`
- `ui-dsl-design-system-integration`
- `workflow-instance-engineering`

## How to use
- Keep root `CLAUDE.md` as the workspace-wide source of truth.
- Read the relevant project `CLAUDE.md` before making project-local changes.
- Use focused skills for the specific task; do not load every skill for every change.
- When a cross-project contract changes, update the contract, ownership matrix, relevant project instructions and tests.
- Skills are guidance. Verify repository reality and run tests; never claim unimplemented functionality exists.
