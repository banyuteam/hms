# Mobile Capability Governance

## Use when
Selecting or implementing Android/iOS capabilities or deciding whether a web module belongs on mobile.

## Rule
A web module does not automatically become a mobile feature. Require a capability registry entry and approval.

## Evaluate
- User/task benefit on mobile.
- Clinical and operational risk.
- Required OS/device APIs.
- Network/offline requirements.
- Local PHI caching and encryption.
- Conflict resolution.
- Authentication/step-up.
- Authorization and audit.
- API readiness and support ownership.
- Platform-specific acceptance tests.

## Output
Document supported platforms, OS floor, permissions, offline behavior, data retention, API dependencies, roles and test cases. Backend authorization remains authoritative.
