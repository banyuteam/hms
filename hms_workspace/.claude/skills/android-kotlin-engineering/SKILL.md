# Android Kotlin Engineering

## Use when
Building native HMS Android features.

## Rules
- Use Kotlin and native Android UI architecture consistent with the existing app (prefer Jetpack Compose where project standards approve it).
- Respect lifecycle, process death, configuration changes and background execution limits.
- Use Android Keystore-backed protection for sensitive local secrets/keys.
- Use platform biometric APIs only as an authentication convenience bound to a secure server session/policy, not as a substitute for backend authorization.
- Minimize and encrypt cached PHI; define expiry and logout cleanup.
- Offline writes require explicit conflict-resolution and audit design.
- Avoid WebView wrappers as a substitute for native workflow design.
- Do not assume web AppShell or WorkflowDock applies to Android.
