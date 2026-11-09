---
name: postgresql-role-and-privilege-engineering
description: Model PostgreSQL roles, schema ownership, grants, default privileges and least-privilege application access.
---


# PostgreSQL Role & Privilege Engineering

- Separate login identities from group/ownership roles.
- Prefer NOLOGIN roles for object ownership and privilege bundles.
- Runtime roles must be NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS.
- Do not grant broad ALL privileges when object-level grants are feasible.
- Account for schema USAGE, table CRUD, sequence USAGE/SELECT/UPDATE and function EXECUTE separately.
- Configure default privileges for objects created by the intended owner; remember defaults are scoped to the creating role.
- Review inherited memberships and `SET ROLE` pathways.
- Treat RLS as defense-in-depth, not a replacement for service authorization.
- Avoid role names and grants that assume one database only unless that is the documented topology.
- Test effective privileges using `has_table_privilege`, `has_schema_privilege`, `pg_has_role` and actual login sessions.
- Do not change ownership or revoke grants without identifying dependent migrations, views, functions and operational jobs.
