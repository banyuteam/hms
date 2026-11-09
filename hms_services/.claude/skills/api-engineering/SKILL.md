---
name: api-engineering
description: >
  Designs secure REST APIs and service contracts, including validation, versioning, pagination and error semantics.
---


# API Engineering
Use explicit resource-oriented contracts. Validate at boundaries and authorize server-side. Define stable error codes, safe messages, pagination and idempotency for retryable commands. Do not expose internal schema/legacy IDs without a deliberate compatibility decision. Version breaking contracts.

Workflow: consumer/use case -> request/response -> auth/tenant -> validation/errors/pagination/idempotency -> rate limits/audit -> OpenAPI and contract tests -> deprecation policy.
