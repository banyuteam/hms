---
name: service-security-iam
description: >
  Integrates enterprise IAM with Go services using OIDC/OAuth, workload identity, authorization, tenant isolation and audit.
---


# Service Security and IAM
IdP authenticates; HMS services authorize actions/resources. Validate issuer, audience, signature, expiry, not-before and token purpose. Use stable issuer/subject mapping, not email. Enforce tenant and patient/encounter resource access. Least privilege for service/worker identities. Use secret manager. Audit privileged actions and break-glass. Never pass broad user tokens or DB credentials into DSL.

Resolve actor/workload -> authenticate -> tenant context -> authorize resource/action -> audit -> propagate minimum scoped context -> test cross-tenant and escalation. Go checks capabilities before DSL invocation.
