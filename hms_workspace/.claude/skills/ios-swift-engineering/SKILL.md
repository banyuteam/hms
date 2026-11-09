# iOS Swift Engineering

## Use when
Building native HMS iOS features.

## Rules
- Use Swift and SwiftUI/native UIKit patterns consistent with the repository.
- Respect app lifecycle, scene state, background execution and privacy protections.
- Use Keychain for approved secrets and device-bound credentials.
- Use Face ID/Touch ID only under approved authentication policy; biometrics do not replace server authorization.
- Minimize and protect cached PHI; define expiry and logout cleanup.
- Offline writes require explicit conflict-resolution and audit design.
- Avoid wrapping the complete web application in WKWebView.
- Do not assume web AppShell or WorkflowDock applies to iOS.
