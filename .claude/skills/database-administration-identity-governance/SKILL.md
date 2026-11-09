---
name: database-administration-identity-governance
description: Design and operate PostgreSQL administrator assignment, canonical application identity, object ownership, migration identities and safe environment transitions.
---


# Database Administration & Identity Governance

## Mandatory reading
Read `hms_database/governance/DATABASE-ADMINISTRATION-AND-IDENTITY-POLICY.md`.

## Rules
- Inspect the actual cluster before proposing or executing role changes.
- Identify the assigned operator for the target environment; never infer it.
- Keep superuser use to bootstrap, cluster administration and approved recovery.
- Never use a superuser for application runtime.
- `hms_app` is the canonical non-superuser runtime identity; it does not own schemas or tables.
- Use a NOLOGIN object-owner role and controlled migration identity.
- Keep a secured break-glass recovery path. Never lock out all administrative recovery.
- Exclude other superusers from routine access through credential, host and network controls; do not claim a policy file alone enforces this.
- Never put secrets in SQL, source control, Docker images or frontend/mobile bundles.
- Do not execute destructive role changes without dependency inventory, backup/recovery verification and explicit approval.

## Resource policy
Interpret 75/25 as an infrastructure budget, not per-role CPU/RAM quota. Explain PostgreSQL's actual limits. Use OS/container controls for resource envelopes and tune PostgreSQL memory/connection settings from measured load.

## Practical workflow
1. Inventory version, roles, memberships, owners, grants, extensions and auth config.
2. Record environment, operator and recovery path.
3. Plan additive role provisioning.
4. Create non-login owner and least-privilege runtime roles.
5. Grant explicit object privileges.
6. Test runtime permissions with the actual application role.
7. Document rollback, credential rotation and production transition.
8. Report unverified assumptions and exact commands not run.

## Acceptance
Demonstrate runtime role cannot create roles/databases, alter protected schema, bypass RLS or access unrelated schemas. Verify migration identity, connection budget, backup restore and break-glass recovery.
