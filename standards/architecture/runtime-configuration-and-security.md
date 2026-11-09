# Runtime Configuration, Security and Threat Detection Standard

## Configuration classes
1. Deployment bootstrap: ports, bind addresses, TLS termination, process limits, database pool sizing, worker sizing and infrastructure resource limits.
2. Secret material: database credentials, JWT private keys, TLS private keys, encryption keys and external API credentials.
3. Runtime policy: rate limits, session policy, password/MFA policy, feature flags, workflow policy and approved detection thresholds.
4. Telemetry and alert routing: metric exporters, log destinations, tracing, alert routes and retention.

## Source of truth
- Environment variables and deployment manifests provide environment-specific bootstrap configuration.
- Secret manager or protected runtime secret mounts provide secret material.
- Database-backed versioned policies provide only settings that the application explicitly supports for safe runtime reload.
- Monitoring configuration belongs to deployment/observability configuration.
- Runtime policy must never override hard-coded safety boundaries or disable mandatory authorization, audit, TLS validation or tenant isolation.

## Security boundaries
- Go services enforce authentication, authorization, tenant/facility scope, rate limits, session validity and action policies.
- React clients can display controls and status but cannot enforce security.
- JWT signing keys, TLS private keys and data-encryption keys are distinct assets with independent rotation and access control.
- Never store private keys or plaintext credentials in PostgreSQL.
- Refresh tokens should be stored as hashes or protected token references, not plaintext.
- Use short-lived access tokens, refresh rotation, revocation and issuer/audience/algorithm validation.
- Rate limiting must consider distributed replicas and use shared enforcement state where required.
- Do not bind sessions rigidly to IP addresses; use device and risk context appropriately.
- Do not expose secrets through logs, metrics, browser bundles, error messages or traces.

## Threat detection
Collect security-relevant signals from ingress, Go middleware, authentication, authorization, sessions, sensitive resource access, integration activity and host infrastructure.
Examples: brute-force patterns, credential stuffing indicators, JWT validation abuse, suspicious session changes, privilege changes, patient-record enumeration, unusual bulk exports, cross-facility access attempts, API abuse, DDoS indicators and service saturation.

Detection should combine multiple signals, thresholds, time windows and context. A single failed login or IP change is not sufficient proof of compromise.
DDoS mitigation must include upstream/CDN/WAF/network controls; application counters alone cannot protect a saturated network.

## Telemetry separation
- Prometheus or equivalent: numeric time-series metrics.
- Grafana or equivalent: dashboards.
- Loki or equivalent: application/security logs.
- Alertmanager or equivalent: alert routing and deduplication.
- OpenTelemetry: traces and instrumentation.
- Optional SIEM/host-security platform: host and cross-system correlation.
- PostgreSQL: selected durable security events, incidents, policy versions and audit evidence, not every raw request forever.

Never place patient names, MRNs, clinical details, tokens or unbounded user identifiers in metric labels. Apply PHI-aware logging and retention.

## Automated response
Responses such as throttling, step-up authentication, session revocation, temporary account protection or network blocking must be policy-driven, scoped, time-bounded where possible, auditable and reversible. High-impact actions require approval or a well-defined emergency policy. Preserve evidence and record the rule/version that triggered the response.

## Production gates
Require threat model, key rotation procedure, least-privilege roles, TLS review, rate-limit tests, audit verification, incident runbooks, backup/restore, alert testing and security regression tests.
