# hms_workspace — Project Instructions

## 1. Role
This project owns the user experience for web, Android and iOS. It consumes `hms_services` APIs and shared contracts. It does not own backend business rules, resource authorization or database access.

## 2. Platform scope
- `web/` is the complete HMS operating environment.
- `android/` is a native Kotlin application with approved mobile workflows only.
- `ios/` is a native Swift application with approved mobile workflows only.
- Mobile apps are not reduced copies of the web UI and are not required to reproduce the web workflow dock.
- Platform coverage must be declared in the Mobile Capability Registry.

## 3. Web design baseline
Preserve the existing Banyumanik 2 HMS web design and current implementation wherever possible:
- Inspect actual source and tokens before editing.
- Keep established branding, blue/white visual language, components and module screens.
- Add the AppShell as an integration layer, not a replacement visual system.
- Reuse existing screens through workflow adapters.
- Migrate incrementally and test each workflow.
- Do not invent a new color system if the repository already has a maintained token source.

Known prototype token references (verify against current code before using):
`#0878F9`, `#075EC4`, `#102344`, `#647A9D`, `#DCE6F5`, `#F3F8FF`, `#FFFFFF`.

## 4. Web AppShell
The web shell contains:
- `TopNavigation`: brand, global search, notifications, profile and global actions.
- `AppLauncher`: opens modules.
- `WorkspaceCanvas`: active workflow content.
- `WorkflowDock`: bottom dock for opened workflow instances.
- `AssistantPanel`: persistent assistant capability.
- `AssistantContextManager`: user-selected references for assistant requests.

The bottom dock is a workflow/window switcher, not static module navigation. It displays workflow instances, e.g. Patient Directory, Patient PT-000184, Encounter ENC-00182, Lab Result LAB-0032.

Each workflow instance has independent UI state and lifecycle. A module may open multiple instances. Switching tabs must not silently alter assistant context.

## 5. Assistant context
- Assistant context must be explicit and visible.
- Only user-selected references are attached to a request.
- Do not infer references from active tabs, selected patient, current route or global application state.
- The client sends identifiers and optional version references, not raw clinical records.
- `hms_services` authenticates, resolves and authorizes every reference.
- Client-side chips and selection state are not authorization.
- Starting a new conversation must not inherit unrelated references without explicit user confirmation.

## 6. Web engineering
- Inspect existing stack and patterns before proposing dependencies.
- Use strict TypeScript and existing lint/test conventions.
- Prefer reusable components but avoid abstraction for its own sake.
- Use API clients generated from or checked against versioned contracts.
- Model loading, empty, error, permission-denied, stale and success states.
- Keep PHI out of browser storage, analytics and logs unless specifically approved.
- Do not put secrets in frontend bundles.
- Do not use frontend checks as a substitute for backend authorization.

## 7. Android engineering
- Native Kotlin. Follow current repository Android baseline and architecture.
- Use platform-native navigation and UI patterns.
- Use Android secure storage and approved biometric/device APIs.
- Offline data must be explicitly scoped, minimized, encrypted and expiry-controlled.
- Define conflict resolution for offline writes before enabling them.
- Do not assume every web feature belongs on Android.

## 8. iOS engineering
- Native Swift/SwiftUI. Follow current repository iOS baseline and architecture.
- Use platform-native navigation and UI patterns.
- Use Keychain and approved biometric/device APIs.
- Offline data must be explicitly scoped, minimized, encrypted and expiry-controlled.
- Define conflict resolution for offline writes before enabling them.
- Do not assume every web feature belongs on iOS.

## 9. Digital signatures
The client captures user intent and presents signing evidence. Backend services own signer authentication, authorization, signing policy, document version binding, cryptographic evidence, timestamps and verification status. Do not implement a visual "signed" badge as a signature.

## 10. Testing and completion
Test:
- Workflow open/switch/close/reorder and dirty-state behavior.
- Multiple instances of the same workflow.
- Assistant references remain independent of dock selection.
- Unauthorized references are rejected by backend contract tests.
- Mobile capability gates and platform-specific flows.
- Accessibility, responsive behavior and platform lifecycle.
Report only tests actually run.


## Containerized web delivery
- The web application must have reproducible development and production container builds.
- Use a multi-stage frontend build and a minimal static web runtime/reverse-proxy image.
- Never put API secrets, signing keys or privileged service credentials into browser bundles or build arguments.
- Configure API base paths/origins at deployment time using public, non-secret configuration only.
- Keep TLS termination and security headers in the approved ingress/reverse-proxy layer.
- Android and iOS are native artifacts; do not force them into the web Docker runtime.
- Coordinate web image tags and API compatibility with `hms_services` release contracts.


## Declarative UI IR renderer
- Web may render approved UI IR returned by `hms_services`; it never executes Python or arbitrary code.
- Implement a typed allowlist registry mapping semantic IR component types to existing Banyumanik 2 React components.
- Reuse current design tokens and components. Do not create a parallel visual system or rewrite existing screens to force DSL adoption.
- Validate IR version and component props; bound tree depth/size; fail safely for unsupported nodes.
- Bind data only through approved API resources. Dispatch only registered action IDs through typed API clients.
- Client validation improves usability but Go remains authoritative for validation and authorization.
- Keep workflow-instance state independent and do not infer assistant context from active tabs.
- Android/iOS are not automatically required to render the full web IR.
