---
name: ui-publication-and-action-runtime
description: Implement Go-side UI definition delivery, data resolution, registered actions, approval, activation and rollback.
---
# UI Publication and Action Runtime

## Responsibilities
- Load published immutable IR.
- Check renderer/IR compatibility.
- Resolve approved data sources through registered Go handlers.
- Authorize every resource reference using tenant, facility, resource and purpose policy.
- Execute registered actions with typed inputs, domain validation, transactions, audit and idempotency.
- Manage draft, validated, approved, published and active states.
- Support controlled promotion and rollback.

## Security rules
- UI visibility is not authorization.
- The client cannot submit SQL, arbitrary URLs, function names, code or permission assertions.
- Revalidate all inputs server-side.
- Never infer patient context from active tab or global client state.
- Assistant-proposed screens require the same validation and approval as human-authored screens.
- Do not expose raw clinical data in definition endpoints.

## Operational rules
Use immutable artifacts, content hashes, audit publication actions, compatibility gates, cache invalidation/versioning, preview environments and rollback tests.
