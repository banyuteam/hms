---
name: plugin-capability-governance
description: >
  Defines registered capabilities, plugin lifecycle, permissions, versioning and policy controls for extensible workflows.
---


# Plugin and Capability Governance
A plugin is a registered capability, not unrestricted code access. Each capability has owner, version, purpose, risk class, input/output schema, permission scope and resource limits. Go validates actor, tenant, authorization and execution policy. Allowlist per workflow/environment. Deprecation/revocation are controlled and audited. Secrets are scoped.

Lifecycle: propose -> threat model -> contract -> implement -> test -> approve -> register -> activate -> monitor -> deprecate/revoke.
