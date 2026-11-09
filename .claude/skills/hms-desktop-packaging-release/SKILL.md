---
name: hms-desktop-packaging-release
description: Build secure, signed, reproducible installers and update processes for HMS Desktop on Windows, macOS and Linux.
---
# HMS Desktop Packaging & Release

## Release artifacts
Define supported installer/package formats per OS, application identity, versioning, upgrade path, uninstall behavior, data migration and rollback strategy.

## Supply-chain security
- Pin and audit dependencies.
- Build from reviewed source and reproducible CI where feasible.
- Sign release artifacts.
- Protect signing keys in a dedicated secret/signing service.
- Never place signing credentials in the repository or desktop package.
- Generate checksums and release provenance.
- Publish update metadata through trusted channels.

## Updates
Use signed update metadata and artifact verification. Define staged rollout, compatibility checks, interruption recovery, rollback and minimum supported version. Do not update while critical local jobs are in an unsafe state. Do not allow arbitrary update URLs from the WebView.

## Platform requirements
- Windows: code signing, installer upgrade/uninstall and WebView runtime handling.
- macOS: Developer ID signing, notarization, entitlements and hardened runtime as applicable.
- Linux: define supported distributions, package formats, runtime dependencies and signing/repository trust.

## Data preservation
Application upgrades must not silently delete local queues, configuration or approved cache. Migrate local data with versioned, tested procedures. Uninstall and device de-registration behavior must be explicit.

## Tests
Test clean install, upgrade, downgrade policy, failed update, signature rejection, offline update state, uninstall, data migration and each supported OS.
