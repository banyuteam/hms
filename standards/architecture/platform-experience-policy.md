# HMS Platform Experience Policy

## One platform, purpose-built experiences
- Web: comprehensive HMS operating environment.
- Android: native Kotlin client for selected mobile workflows.
- iOS: native Swift client for selected mobile workflows.

## Web
Web owns the full approved module catalog, administration, advanced configuration/reporting, workflow dock, multi-instance workspace and full shell experience.

## Android
Android uses native Kotlin and Android-native interaction patterns. Include only capabilities approved in the Mobile Capability Registry. Use Android secure storage, platform lifecycle, accessibility and device APIs appropriately.

## iOS
iOS uses native Swift/SwiftUI and Apple-native interaction patterns. Include only capabilities approved in the Mobile Capability Registry. Use Keychain, Face ID/Touch ID where approved, platform lifecycle and accessibility appropriately.

## Shared across platforms
- API contracts and versioning.
- Canonical resource identifiers and terminology.
- Backend business rules and authorization.
- Explicit assistant context-reference semantics.
- Digital-signature verification semantics.
- Audit and provenance expectations.
- Shared design principles and brand identity, not pixel-identical layouts.

## Not required to be identical
- Navigation model.
- Screen layouts.
- Workflow coverage.
- Device integrations.
- Offline behavior.
- Interaction patterns.

## Mobile scope governance
Adding a workflow to mobile requires an explicit capability entry, risk review, offline/data-cache decision, authorization mapping, API readiness and test plan. A web module does not automatically become a mobile capability.
