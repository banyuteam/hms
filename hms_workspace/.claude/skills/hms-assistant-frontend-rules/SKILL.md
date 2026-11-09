---
name: hms-assistant-frontend-rules
description: Implement deterministic client-side guided flows and presentation rules in the HMS workspace without moving authoritative business rules or authorization into the browser.
---

# HMS Assistant Frontend Rules

## Purpose

Build deterministic interaction logic only. The browser may guide the user and validate local input shape, but it is not a trusted business-rule or authorization environment.

## Allowed client-side rules

- menu visibility based on the user's explicit selection
- guided question order
- required UI input presence
- local formatting and simple input validation
- help text and navigation
- rendering of service-provided outcomes
- deciding which approved UI component to display

## Not allowed as authoritative client-side decisions

- access to patient or encounter
- claim eligibility or adjudication
- clinical diagnosis or treatment
- medical necessity
- definitive ICD coding
- INA-CBG/iDRG authoritative grouping or tariff calculation
- approval, signature, payment, or external submission authorization

## Typed rule model

Example:

```ts
type GuidedFlowState =
  | "start"
  | "select_topic"
  | "collect_input"
  | "show_guidance"
  | "complete";

type GuidedFlowAction =
  | { type: "SELECT_TOPIC"; topic: string }
  | { type: "SET_INPUT"; field: string; value: string }
  | { type: "GO_BACK" }
  | { type: "RESET" };

type GuidedFlowResult = {
  state: GuidedFlowState;
  prompt?: string;
  choices?: Array<{ id: string; label: string }>;
  localValidationMessages: string[];
};
```

Use discriminated unions and exhaustive transition handling.

## Finite-state flow requirements

Each flow defines:
- stable flow code and version
- initial state
- allowed states
- allowed transitions
- input schema
- cancellation and back behavior
- terminal states
- unsupported path behavior

Reject invalid transitions. Avoid unbounded recursion, dynamic code evaluation, or user-provided function names.

## Local rule registry

Use a static, allowlisted TypeScript registry or another repository-approved approach. Do not download executable rule code from an API.

If the backend returns an action ID, render it only if it exists in the frontend action presentation registry. Execution still goes to Go.

## Rule provenance

Label outcomes as:
- `workspace_guidance`
- `workspace_input_validation`
- `service_rule_evaluation`

Never label local UI guidance as an authoritative domain decision.

## Accessibility

- keyboard accessible choices
- clear focus order
- screen-reader announcements for state transitions
- visible labels and errors
- no color-only status
- preserve existing HMS design tokens

## Testing

Test valid transitions, invalid transitions, missing inputs, back/reset, ambiguous selections, unsupported flows, and unchanged behavior of existing assistant menus.
