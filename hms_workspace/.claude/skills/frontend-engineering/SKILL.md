# Frontend Engineering — HMS Workspace

## Use when
Building or modifying React/TypeScript web features, client architecture, routing, state, API integration or UI behavior.

## Workflow
1. Inspect existing repository and preserve its stack/conventions.
2. Identify domain owner and API contract.
3. Separate server state, local UI state and workflow-instance state.
4. Use strict types and schema validation at API boundaries.
5. Implement loading, empty, error, stale, unauthorized and success states.
6. Add tests for behavior, permissions and edge cases.

## Rules
- Frontend is a presentation/client orchestration layer, not a business-rule authority.
- Never access MySQL/PostgreSQL directly from the browser.
- Never store secrets in frontend bundles.
- Do not trust client-supplied user, tenant, patient or role IDs.
- Avoid giant components and duplicated domain logic.
- Preserve established UI and component conventions.
