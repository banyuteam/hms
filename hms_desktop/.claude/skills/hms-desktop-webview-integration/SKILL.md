---
name: hms-desktop-webview-integration
description: Integrate the existing React HMS workspace into the native desktop WebView safely and consistently.
---
# HMS Desktop WebView Integration

## Ownership
The React application remains in `hms_workspace`. Desktop may own a small desktop bootstrap or adapter, but must not fork the HMS business UI.

## Loading strategy
Inspect existing deployment and authentication patterns. Decide deliberately between:
- loading a trusted hosted HMS origin;
- embedding a packaged web build;
- a controlled hybrid strategy.

Document offline, update, caching, origin and version compatibility implications. Never load arbitrary user-provided URLs into a privileged WebView.

## WebView hardening
- Restrict navigation to approved origins and routes.
- Deny or explicitly handle external navigation.
- Disable unnecessary WebView capabilities.
- Apply a restrictive Content Security Policy where supported.
- Do not expose privileged bridge APIs to untrusted frames or origins.
- Validate message origin, schema, size and command permissions.
- Prevent untrusted content from opening privileged windows.
- Keep development and production origins/configuration separate.

## Authentication
Use the established HMS authentication flow. Do not create a second identity authority or persist access tokens in plaintext. Use secure OS storage only where required by the approved session design. Logout must clear or invalidate relevant local session material and native capability state.

## Version compatibility
Expose desktop runtime and workspace build versions. Define minimum supported bridge protocol version and safe behavior for incompatible versions. Avoid silently running a newer UI against an older privileged runtime.

## Failure states
Provide clear states for loading, offline, backend unavailable, WebView failure, expired session and incompatible versions. Do not claim backend operations succeeded based solely on a UI event.

## Tests
Test navigation allowlists, origin spoofing, bridge exposure, CSP, external links, session cleanup, version mismatch, offline behavior and WebView crash/reload.
