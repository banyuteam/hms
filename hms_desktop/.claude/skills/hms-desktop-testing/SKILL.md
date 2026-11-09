---
name: hms-desktop-testing
description: Establish unit, integration, security, hardware-simulation and cross-platform tests for HMS Desktop.
---
# HMS Desktop Testing

## Test layers
- Rust unit tests for domain-neutral native modules and validation.
- Bridge contract tests for DTO schemas, authorization gates and error semantics.
- WebView integration tests for origin policy, navigation and UI/native interaction.
- Device adapter tests using simulators and synthetic fixtures.
- Background-agent tests for retries, idempotency and lifecycle.
- Installer/update tests on each supported OS.
- End-to-end tests for critical workstation workflows.

## Security tests
Test arbitrary command denial, path traversal, origin spoofing, bridge misuse, malformed/oversized payloads, secret/PHI leakage, unauthorized device access, session revocation and update signature verification.

## Reliability tests
Test WebView crash/reload, native process crash, OS restart, network loss, printer disconnect, device reconnect, storage exhaustion, duplicate job delivery and uncertain job outcome.

## Clinical data safety
Use synthetic data. Device-derived clinical data must preserve provenance, units and timestamps. Tests must verify that invalid or incomplete device output cannot silently become a finalized clinical result.

## Release gates
Do not release when a critical platform, authorization, data-leakage, job-duplication or update-integrity test fails. Record unsupported platforms and known hardware limitations.

## Test reporting
Report commands, target OS, runtime versions, test coverage, skipped tests, hardware simulators used and known limitations. Do not claim hardware compatibility based only on compilation.
