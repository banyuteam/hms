---
name: hms-desktop-cross-platform
description: Keep the Rust HMS desktop runtime portable across Windows, macOS and Linux while documenting platform-specific behavior.
---
# HMS Desktop Cross-Platform Engineering

## Targets
Windows, macOS and Linux are first-class targets, subject to documented minimum OS and WebView runtime versions.

## Architecture
Keep shared domain logic and bridge DTOs platform-neutral. Isolate OS-specific code behind explicit adapters. Avoid scattering `cfg` checks through business logic.

## Platform matrix
For each feature, document:
- supported OS/version;
- required runtime/framework;
- permissions and entitlements;
- packaging dependencies;
- device-driver dependencies;
- known limitations;
- test coverage.

## Native differences
Account for Windows WebView runtime and installer behavior, macOS signing/notarization/entitlements, and Linux distribution/runtime/package differences. Do not claim feature parity until tested on each supported platform.

## Paths and permissions
Use platform-specific application data/cache/config directories. Do not hardcode path separators, device names, service paths or permission assumptions. Use OS APIs and approved libraries.

## Testing
Run unit tests on all supported targets where possible. Maintain platform integration tests for printing, notifications, file dialogs, secure storage, startup and updates. Clearly mark untested platforms and features.
