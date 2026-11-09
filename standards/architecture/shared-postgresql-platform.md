# Shared PostgreSQL Platform Standard

## Baseline
PostgreSQL 18 is the target for new HMS application persistence, subject to validation of driver, extension, backup and hosting compatibility. Start with a shared cluster and, initially, one logical application database with multiple schemas unless a documented requirement dictates otherwise.

## Logical schema domains
Suggested initial schemas:
- `platform`: organizations, facilities, departments, units, rooms, beds and platform reference data.
- `iam`: user identity references, roles, permissions, assignments and authentication metadata.
- `security`: security policies, events, detections, alerts, incidents and response history.
- `audit`: access, authorization, administrative and data-change evidence.
- `workflow`: workflow definitions, versions, instances, tasks, approvals and history.
- `eventing`: event registry, outbox, delivery attempts, consumer checkpoints and idempotency.
- `integration`: external connections metadata, legacy mappings, polling checkpoints, sync runs and reconciliation.
- `ai_platform`: assistant/model/prompt/tool registries, execution metadata, usage and evaluation metadata.
- `notification`: templates, preferences, events and delivery attempts.
- `licensing`: module registry, entitlements and deployment/license metadata, if needed.
- `ui_platform`: UI definitions, immutable IR versions, assignments, publication records and component/action metadata.
- `patient`, `clinical`, `orders`, `pharmacy`, `billing`, `inventory`: operational hospital domains.
- `readmodel`: query projections and reporting read models.

These are proposed logical boundaries, not a requirement to create all schemas and tables on day one. Confirm domain ownership and data classification before creating each schema.

## Database access model
- Application runtime accounts are least-privilege and schema-scoped.
- Migration credentials are separate from runtime credentials.
- Reporting/read-only credentials are separate.
- Legacy MySQL credentials are SELECT-only and separate from PostgreSQL identities.
- No application uses the PostgreSQL superuser.
- No client application connects directly to PostgreSQL.
- Never store database passwords, API tokens, private keys or raw refresh tokens in schema tables.
- Secrets are referenced by secret identifiers, not copied into configuration records.

## Transactions and domain ownership
- Go services own transaction boundaries and authoritative writes.
- Schema ownership must be documented in `DOMAIN-OWNERSHIP.md`.
- A shared cluster does not imply shared write access.
- Prefer APIs/events over cross-domain table writes.
- Cross-schema transactions are allowed only when deliberately designed and tested.
- Use transactional outbox for reliable event publication; consumers must be idempotent.

## Data conventions
- UUID internal identifiers unless a documented domain reason requires otherwise.
- `TIMESTAMPTZ` for instants; `DATE` for calendar dates.
- Explicit currency, unit and timezone semantics.
- Use relational columns for stable domain facts; JSONB only for genuinely variable or versioned structures.
- Avoid generic EAV for core clinical facts.
- Preserve source identifiers and provenance for legacy-imported records.
- Use immutable/versioned records for finalized clinical documents and signatures.
- Define retention, archival, partitioning and deletion rules for sensitive data.

## Operations
- Versioned migrations are executed as controlled release steps, not independently by every replica.
- Production requires tested backup, point-in-time recovery where supported, restore drills, monitoring, capacity planning and migration recovery plans.
- Use connection pooling deliberately; calculate aggregate connections across all replicas and services.
- Keep metrics and high-volume logs in appropriate observability systems, not unlimited relational event tables.
- Large clinical files/images belong in protected object storage; PostgreSQL stores metadata and references.

## Required artifacts for each schema change
1. Owner and purpose.
2. ERD/data dictionary update.
3. DDL migration and rollback/forward-fix plan.
4. Keys, constraints, indexes and retention.
5. Data classification and privacy assessment.
6. Consumer/API/event impact.
7. Migration, integrity and performance tests.
