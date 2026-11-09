---
name: hms-assistant-api
description: Implement and maintain the Go REST API for the deterministic HMS assistant, including typed contracts, authentication, authorization, validation, errors, and compatibility.
---

# HMS Services — Assistant API

## Current-state warning

No assistant API currently exists. The endpoints and schemas in the shared contract files are proposals. Inspect existing HMS API conventions and agree the contract with `hms_workspace` before implementation.

## Responsibilities

- expose deterministic rule evaluation
- expose approved catalogue lookup
- resolve and authorize explicit resource references
- return structured outcomes and provenance
- expose approved action execution separately
- apply rate limits, payload limits, audit and error normalization

Do not implement a model-provider API or AI agent endpoint.

## API design

Review `contracts/assistant-api-contract-proposal.md`. Adopt existing project conventions for:
- route versioning
- authentication middleware
- request validation
- response envelopes
- correlation IDs
- pagination
- idempotency
- OpenAPI generation
- error mapping

Candidate routes are not live until implemented and documented.

## Request handling

1. Authenticate.
2. Validate request shape and limits.
3. Resolve tenant/facility from trusted identity/session context, not user-supplied claims.
4. Resolve each resource reference.
5. Authorize access and purpose.
6. Resolve rule version and reference-data version.
7. Evaluate deterministic rules.
8. Persist audit metadata if required.
9. Return structured result.

## Separation of endpoints

Rule evaluation should not mutate business state.

Actions must be separate routes/use cases and must recheck authorization, workflow state, idempotency, and confirmation requirements.

## Contract versioning

- Version public API contracts.
- Maintain backward compatibility within a major version.
- Reject unsupported versions clearly.
- Do not silently reinterpret old request fields.
- Coordinate workspace release compatibility.

## Security

- Never trust client-provided user, role, tenant, or facility IDs as authority.
- Never trust a frontend `confirmed: true` without authenticated actor and policy checks.
- Enforce request size and rate limits.
- Avoid PHI in URLs.
- Do not log full request/response bodies by default.
- Use existing CORS, CSRF, and session protections as appropriate.

## Testing

Handler tests, auth tests, schema validation, malformed payloads, rate limits, idempotency, authorization matrix, API contract tests, and compatibility tests are required.
