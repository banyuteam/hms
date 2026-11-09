---
name: runtime-config-control-plane
description: Build typed bootstrap configuration and versioned runtime policy distribution for Go services.
---
# Runtime Configuration Control Plane

## Design
Separate:
1. Bootstrap configuration: ports, bind address, TLS termination, DB pool sizing, worker limits and process resources.
2. Secret material: credentials, signing keys, certificates and encryption keys.
3. Runtime policies: rate limits, session policy, feature flags and approved thresholds.
4. Observability configuration: exporters, log sinks and alert routing.

## Implementation
- Parse environment/mounted files into typed Go structs.
- Validate required values, ranges, cross-field constraints and environment-specific rules at startup.
- Fail closed for missing security-critical configuration.
- Support versioned runtime policy snapshots and atomic reload only for explicitly reloadable fields.
- Use safe defaults and prevent policy from disabling hard security controls.
- Record configuration version, source and reload outcome without logging secret values.
- Use separate database roles for runtime and migration.
- Calculate aggregate PostgreSQL connections across replicas.
- Expose sanitized configuration status, not secret values.

## Do not
- Put secrets in DB-backed policy records.
- Hot-reload ports, DB pool sizes, TLS private keys or process resource limits unless the implementation has a tested lifecycle for it.
- Treat frontend configuration as trusted.
