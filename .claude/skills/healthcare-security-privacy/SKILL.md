---
name: healthcare-security-privacy
description: >
  Applies healthcare security, privacy, least privilege, audit, tenant isolation and sensitive-data minimization. Use when handling patient data, credentials or integrations.
---


# Healthcare Security and Privacy

Enforce authentication and server-side authorization, including tenant and patient/encounter resource scope. Use approved secret management; encrypt data in transit/at rest according to policy. Minimize PHI in events, logs, traces, metrics and errors. Separate operational logs from clinical/legal audit. Preserve practitioner attribution. Define retention and access policies with governance.

IdP authenticates; applications authorize. Validate token issuer, audience, signature, expiry and purpose. Do not use email as permanent identity key.

DSL capabilities are allowlisted and permission-scoped. Bound worker time, memory, CPU and concurrency. A separate process is not automatically a sufficient sandbox. Threat-model replay, injection, privilege escalation, cross-tenant access and data leakage.
