# HMS Production Readiness and Release Engineering

## Use when
Preparing staging/production deployment, release checklists, CI/CD or operational handover.

## Mandatory gates
- Reproducible immutable image builds.
- SBOM and vulnerability scanning.
- Secret manager integration.
- TLS ingress and private service networks.
- Non-root, least-privilege containers.
- Resource limits, health checks and graceful shutdown.
- Versioned migrations with controlled one-shot execution.
- Backup and tested restore.
- Monitoring, alerting and redacted logs.
- Rollback/forward-fix plan.
- Deployment runbook, release notes and ownership.

## Readiness labels
Use exact labels: development-ready, CI/test-ready, staging-ready, production-ready. Do not call a stack production-ready based solely on a successful Compose startup.

## Database safety
Never run schema migrations against legacy MySQL. Verify the dedicated legacy integration account is SELECT-only.
