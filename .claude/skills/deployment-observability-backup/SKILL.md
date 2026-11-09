# Deployment Observability and Data Protection

## Use when
Designing production operations, monitoring, logging, backups, restore or disaster recovery.

## Requirements
- Health and readiness endpoints are distinct where the runtime needs them.
- Structured logs include correlation IDs but exclude secrets and unnecessary PHI.
- Metrics cover request latency/errors, saturation, queue/polling lag, database health and critical workflow outcomes.
- Alerts have an owner, severity, threshold rationale and runbook.
- PostgreSQL backup strategy includes retention, encryption and restore testing.
- Define RPO/RTO with the system owner; do not invent them.
- Test container restart, graceful shutdown, dependency loss and recovery.
- Keep backup credentials and encryption keys in approved secret storage.
