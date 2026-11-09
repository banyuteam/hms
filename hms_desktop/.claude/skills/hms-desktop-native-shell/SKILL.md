---
name: hms-desktop-native-shell
description: Implement the Rust native application shell, lifecycle, windows, menus, tray and OS integration for HMS Desktop.
---
# HMS Desktop Native Shell

## Responsibilities
Own application startup/shutdown, window lifecycle, native menus, tray integration, OS notifications, keyboard shortcuts, deep links where approved, application focus and platform-specific shell behavior.

## Design rules
- Keep shell code separate from domain/business logic.
- Use explicit modules and typed command handlers.
- Keep long-running tasks off the UI thread.
- Handle graceful shutdown and child-process lifecycle.
- Recover safely from WebView reload/crash without duplicating side effects.
- Use structured errors and correlation IDs.
- Avoid global mutable state; define ownership and synchronization explicitly.

## Window behavior
Support configured window sizes, multi-window policy, focus, minimize/restore, display changes and high-DPI scaling. Do not assume identical behavior across operating systems. Preserve web workflow state through the existing workspace mechanisms rather than treating OS windows as business workflow identity.

## Tray and notifications
Tray actions and notifications must not expose PHI on lock screens or shared workstations. Deep links must be validated and backend authorization rechecked after navigation.

## Runtime lifecycle
Define startup readiness, backend connectivity, WebView readiness, shutdown hooks, crash recovery and update/restart behavior. A shell restart must not silently replay a side-effecting action.

## Tests
Test startup failures, duplicate launch, window lifecycle, display changes, tray behavior, notification privacy, shutdown and platform-specific behavior.
