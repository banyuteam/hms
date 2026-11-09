# HMS Workspace Deployment

This directory coordinates development, CI/test and production deployment for the platform.

## Files
- `compose.yaml`: local development orchestration template.
- `compose.production.yaml`: production topology template using prebuilt immutable images.
- `.env.example`: non-secret configuration names and examples only.
- `docker/`: ingress and runtime configuration examples.
- `scripts/`: validation, migration and release helper placeholders.

## Important
These are templates. Before use, align service build contexts, executable names, health endpoints, API routes, ports and environment variables with the actual repositories. Do not assume a placeholder is production-ready.

## Legacy MySQL
Legacy MySQL is an external protected system. It is not provisioned or migrated by this Compose project. Configure only a dedicated SELECT-only credential in the approved secret manager and allow network access from the legacy polling service only.

## Local use
From the workspace root, after adapting build paths:
```bash
docker compose -f deployment/compose.yaml config
docker compose -f deployment/compose.yaml up --build
docker compose -f deployment/compose.yaml down
```

## Production use
Production should use a controlled CI/CD process to build, scan, sign/attest and publish immutable images. Deploy by digest or immutable version tag. Use a managed PostgreSQL service where possible. If PostgreSQL is self-hosted, its storage, backup, restore and HA design must be reviewed separately.
