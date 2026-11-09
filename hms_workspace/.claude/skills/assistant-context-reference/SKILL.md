# Assistant Context Reference Engineering

## Use when
Building assistant panel, context picker, reference chips, conversation scope or assistant API request construction.

## Non-negotiable rules
- Attach only references explicitly selected or confirmed by the user.
- Never infer context from active tab, active patient, route, global selection or prior unrelated conversation.
- Send resource identifiers and optional version metadata, not raw clinical records.
- Display attached references and scope clearly before submission.
- Allow user to remove references.
- New conversations start without prior references unless explicitly carried forward by user action.
- `hms_services` resolves and authorizes every reference. UI state is never permission.

## UX
Use visible chips with safe labels, resource type and optional version/date. Explain when a reference is stale, unavailable or rejected. Do not silently substitute another resource.

## Tests
Tab switching does not change context; unauthorized reference rejected; cross-tenant ID rejected; conversation isolation; reference removal; stale version handling.
