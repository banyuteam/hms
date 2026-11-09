# Docker Containerization Engineering

## Use when
Creating Dockerfiles, Compose environments, local development stacks or container runtime configuration.

## Required approach
1. Inspect actual build system, package manager, commands and runtime ports.
2. Use multi-stage builds and minimal runtime layers.
3. Run as non-root.
4. Add health/readiness checks and graceful shutdown.
5. Use explicit configuration and secret mounts.
6. Separate development, CI/test and production behavior.
7. Keep state in managed services or durable volumes, not container layers.
8. Validate with `docker compose config` and clean builds where available.

## Rules
- Never bake secrets or production data into images.
- Do not expose database ports publicly in production.
- Do not use `latest` for production deployments.
- Do not assume Compose startup order means service readiness; use health checks and dependency conditions where supported.
- Keep legacy MySQL external and read-only.
- Do not containerize Android/iOS as if they were web runtime services.
- Label examples/templates honestly; inspect actual repository before claiming they work.
