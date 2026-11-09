---
name: hms-assistant-workspace
description: Evolve the existing browser-based HMS assistant as a deterministic rule-based user experience in hms_workspace. Use for assistant UI, guided flows, conversation state, context selection, and integration with Go rule APIs.
---

# HMS Assistant Workspace

## Objective

Maintain and incrementally improve the existing browser-based assistant. Initial target is entirely deterministic and rule-based. There is no AI model or chatbot backend today.

## Inspect first

- Locate the current assistant panel/components and existing guided flows.
- Trace current button actions and local rules.
- Identify current state management, persistence, design tokens, and HMS shell integration.
- Add characterization tests before refactoring.
- Do not assume example file paths in this skill exist.

## Ownership

Workspace owns:
- assistant panel and message presentation
- guided menus and interaction state
- local presentation/navigation rules
- form/input collection for guided workflows
- explicit selected context references
- typed API client for Go services
- rendering of authoritative service results

Workspace does not own:
- authoritative authorization
- patient/encounter data resolution
- domain claim validation
- canonical catalogue truth
- durable rule version governance
- business action execution
- database access

## Preserve existing HMS UI

- Preserve RS Banyumanik 2 branding, design tokens, typography, navigation, app shell, workflow dock, and working screens.
- Reuse existing design-system components.
- Do not redesign the assistant or replace its current behavior without a tested migration plan.
- Assistant remains a shell-level feature and must not disrupt current workflow instances.

## Logical boundaries

Adapt to the existing project rather than forcing a directory restructure:

- presentation components
- conversation state
- guided-flow definitions
- local presentation rules
- assistant API client
- context reference selection
- result/provenance rendering

Keep React components free of domain validation logic. Keep network effects outside render paths.

## Local versus server rules

Local workspace rules are suitable for:
- which menu to show
- which question follows a user selection
- local form completeness before submission
- display formatting
- navigation among approved assistant steps

Use Go services for:
- authorization
- patient/encounter/claim resolution
- authoritative catalogue lookup
- domain validation
- eligibility or policy decisions
- any action that changes business state

If Go services are unavailable, the UI may continue to offer local navigation and non-authoritative guidance. It must not present an authoritative check as completed.

## Context handling

- Attach patient/encounter/claim context only after explicit user selection.
- Never infer context from active tab, route, last opened patient, or global selection.
- Send opaque resource references and optional version IDs, not copied clinical records.
- Switching WorkflowDock items must not change assistant context.
- A new conversation must not inherit prior context without explicit user action.
- Display attached references and allow removal.
- Backend authorization remains authoritative.

## Rule outcome presentation

Display structured outcomes with:
- status
- explanation
- warning/error severity
- missing field references
- safe next action
- rule version/provenance where useful

Do not equate `matched` with approval, clinical correctness, insurer acceptance, or successful submission.

## Actions

Render only known action identifiers and supported parameters. Consequential actions must require explicit confirmation and a backend endpoint. The backend must reauthorize every action.

## Error and offline states

Handle:
- backend not configured
- service unavailable
- access denied
- context not found
- stale resource version
- rule version unavailable
- invalid input
- action rejected
- unknown outcome

Do not silently fall back from a failed authoritative server rule to a local rule that appears equivalent.

## Definition of done

- Existing assistant workflows remain functional.
- UI matches existing design system.
- No direct database access.
- No frontend authorization.
- Context remains explicit.
- Local and server rule provenance is distinguishable.
- Loading, error, empty, and unavailable states work.
- Tests and type checks pass.
