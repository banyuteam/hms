# backend-services — Instructions

Domain microservices and the API gateway / BFF for the new platform.
Read the root `CLAUDE.md` and this folder's `PRD.md` first.

## Scope

- One folder per service: `source/backend-services/<service-name>/` (e.g. `patient`, `encounter`,
  `orders`, `results`, `pharmacy`, `billing`, `identity`), plus `gateway/` (BFF for
  `source/web-frontend/`).
- Phase 1 (read side): services build read models by consuming domain events from
  `source/event-streaming/`. Phase 2+ (write side): only for domains whose PRD/ADR moves them off
  Khanza.

## Rules

- Language/framework, broker client and gateway are pending an ADR — ask before choosing,
  and use the same stack across services unless an ADR says otherwise.
- Database-per-service: each service owns its schema in `source/database/<service-name>/`. No
  service reads another service's tables; use its API or its events.
- Services publish their own events with the **transactional outbox** (outbox table written in
  the same transaction as the state change, relayed to the broker). Schemas in `source/shared/events/`.
- APIs: OpenAPI spec in `source/shared/api/<service>.yaml` first, then implementation. Version in
  the path (`/v1`). Consistent error format and pagination across services.
- Security: authentication via the central identity service (OIDC), authorization by role
  and by relationship to the patient where the PRD requires it. Every PHI access is audited.
- Consumers are idempotent, tolerate out-of-order events, and expose lag metrics.
- Each service has: README, `.env.example`, health/readiness endpoints, unit tests for
  domain logic, contract tests against `source/shared/` specs.
