---
name: workspace-security-governance
description: Apply consistent security, privacy, secrets, audit and threat-response rules across the HMS workspace.
---
# Workspace Security Governance

## Required controls
- Threat-model every authentication, authorization, clinical-data, integration, AI-tool and administrative change.
- Enforce least privilege, tenant/facility boundaries and server-side authorization.
- Separate bootstrap configuration, secret material, runtime policy and telemetry.
- Use secret manager or protected secret mounts for passwords, private keys and API credentials.
- Never place secrets in source control, Docker images, frontend bundles, logs, traces or metric labels.
- Keep audit evidence distinct from debug logs.
- Minimize PHI in telemetry and event payloads.
- Make automated containment scoped, auditable, reversible and policy-driven.
- Require incident runbooks, alert testing, key rotation and security regression tests for production.

## Threat detection quality
Use multi-signal correlation and time windows. Avoid treating a single failed login, IP change or high request as proof of compromise. DDoS controls must include upstream/network/WAF capabilities; application detection alone is insufficient.
