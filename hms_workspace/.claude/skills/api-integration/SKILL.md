# HMS API Integration

## Use when
Connecting web/mobile clients to `hms_services`.

## Rules
- Use documented, versioned API contracts.
- Generate or validate types from the API schema where practical.
- Centralize transport, auth renewal, error mapping and request correlation.
- Treat all client values and references as untrusted.
- Never embed service credentials or database credentials in clients.
- Do not retry non-idempotent commands without an idempotency strategy.
- Display permission, validation, conflict and stale-data errors distinctly.
- REST for request/response; SSE/WebSocket only for justified live updates.
