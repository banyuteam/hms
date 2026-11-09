# Workspace Docker Compose Orchestration

## Use when
Coordinating hms_database, hms_services and hms_workspace development or staging containers.

## Ownership
Workspace root owns the Compose topology and shared environment conventions. Each deployable project owns its Dockerfile and service runtime behavior.

## Rules
- Separate local development Compose from production deployment configuration.
- Use named networks and only publish required local ports.
- Use health checks and readiness dependencies.
- Keep optional infrastructure behind explicit profiles.
- Use a managed PostgreSQL database in production where possible.
- Do not put legacy MySQL in the writable new-system database stack.
- Use one-shot migration jobs, not migration-on-every-replica startup.
- Document required env vars and provide a non-secret `.env.example`.
- Never commit populated `.env` files or secret material.
- Validate rendered configuration before starting.
