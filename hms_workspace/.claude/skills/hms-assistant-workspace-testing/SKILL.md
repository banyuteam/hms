---
name: hms-assistant-workspace-testing
description: Test the existing HMS assistant UI, local guided rules, API integration states, context handling, accessibility, and regression behavior.
---

# HMS Assistant Workspace Testing

## Baseline first

Before refactoring, capture existing assistant behavior using tests or an acceptance checklist. Preserve existing flows.

## Unit tests

- guided-flow state transitions
- local input validation
- action presentation registry
- message rendering models
- API response parsing
- error normalization
- capability handling
- context reference shape

## Component tests

- open/close assistant
- menu choice
- message submission
- result rendering
- missing-input display
- loading and error states
- context add/remove
- backend unavailable state
- confirmation UI for consequential actions

## Integration tests

- local guided flow completes without backend
- server rule request uses the typed API client
- service unavailable does not falsely report a server rule success
- access denied is displayed safely
- switching WorkflowDock tabs does not mutate assistant context
- new conversation does not inherit context
- unknown action IDs are not executable

## Security/privacy tests

- no direct PostgreSQL connection
- no secrets in browser bundle
- no PHI in URLs or routine console logs
- context reference is not treated as authorization
- no arbitrary execution from API response
- logout/session expiry follows HMS state-clearing policy

## E2E acceptance paths

1. Open assistant from existing HMS shell.
2. Complete a current button-based flow.
3. Complete a current local deterministic flow.
4. Start a new conversation.
5. Explicitly attach a test resource reference.
6. Switch workflow tabs; verify context unchanged.
7. Remove context; verify it is absent from subsequent request.
8. Simulate Go service unavailable; local guidance still works.
9. Simulate server validation failure; show exact safe outcome.
10. Simulate access denied; do not expose resource details.

## Accessibility and regression

Run keyboard-only, screen-reader, focus, contrast, responsive, typecheck, lint, and existing E2E suites. Do not update snapshots blindly.
