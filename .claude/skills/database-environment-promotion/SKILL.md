---
name: database-environment-promotion
description: Prepare and verify safe promotion of PostgreSQL databases from Windows/Linux development to Linux production.
---


# Database Environment Promotion

- Treat production as a separately provisioned environment, not a copy of development credentials.
- Keep SQL migrations, role semantics and schema contracts portable.
- Production OS target is Linux.
- Promote immutable migration artifacts; do not copy a developer's live database as the only deployment method.
- Use a controlled one-shot migration job, never migrations from every service replica.
- Provision secrets through production secret management.
- Validate TLS, `pg_hba.conf`, network policy, backups, restore, monitoring, storage and resource controls.
- Remove routine development-operator access only after verifying object ownership and recovery.
- Retain a secured break-glass path.
- Smoke-test using the canonical application identity.
- Require migration compatibility, data validation, rollback/forward-fix and release evidence.
