# HMS Database Administration, Identity and Resource Governance

**Status:** Workspace baseline; implementation must be validated against the actual PostgreSQL deployment.
**Applies to:** `hms_database` development, CI/test, staging and production environments.
**Role model:** ADR-DB-002 (with its amendments) and `bootstrap/bootstrap.psql`. Where this policy and the ADR differ, the ADR wins.
**Production OS:** Linux only.
**Development OS:** Windows or Linux.

## 1. Purpose and non-negotiable principles

This policy makes database administration predictable and prevents development shortcuts from becoming production dependencies.

1. One named and documented database operator is assigned to routine administration of each environment.
2. Other superuser accounts are not used for routine access to that environment.
3. PostgreSQL superuser privileges are never used by application services.
4. The canonical application runtime identity is a non-superuser LOGIN role shared consistently by all native application runtime connections. The legacy bridge worker is the only approved exception and has its own login (ADR-ROOT-002).
5. Object ownership, schema migration and runtime access are separate responsibilities.
6. Resource percentages describe infrastructure budgets, not role-level CPU/RAM reservations.
7. Windows and Linux development share the same schema, migrations, role semantics and security controls.
8. Production runs on Linux and has a controlled emergency recovery path.

This policy does not authorize disabling or altering the built-in `postgres` account blindly. Account status, ownership and recovery must be assessed before any change.

## 2. Identity model

| Identity | Login | Superuser | Development | Production |
|---|---:|---:|---|---|
| `postgres` bootstrap/recovery | Controlled | Yes, by PostgreSQL default | Not the routine operator once another operator is assigned | Secured emergency/bootstrap access only |
| Assigned operator (e.g. `hms_db_operator`) | Controlled | Yes only if the chosen administration model requires it | Routine administrative operator | No routine login; break-glass only if explicitly approved |
| `<p>_owner` | No | No | Owns the database, schemas and objects | Owns the database, schemas and objects |
| `<p>_migrator` | Controlled | No | Runs migrations through `SET ROLE <p>_owner`; no inherited rights | Controlled deployment-only identity |
| `<p>_runtime` | Yes | No | Canonical application runtime identity (hms_services native transaction layer) | Canonical application runtime identity |
| `<p>_legacy_bridge` | Yes | No | hms_services legacy bridge worker only | hms_services legacy bridge worker only |
| `<p>_auditor` | Controlled | No | Read-only audit review | Approved audit reviewers only |
| `<p>_reporting` | Controlled | No | Read-only reporting/testing | Approved reporting identity |

`<p>` is the per-database role prefix, `hms_meta` by default (`hms_meta_owner`, `hms_meta_runtime`, ...). Every HMS database on a cluster uses its own prefix, so one database's logins cannot reach another's objects. The assigned operator is a cluster-level identity chosen per environment; the bootstrap does not create it.

Fixed cluster-wide names such as `hms_app` were rejected (ADR-DB-002, alternative 2). A shared development cluster may still hold `hms_app`, `hms_audit_app`, `hms_audit_reader` or `hms_bff_app` from the previous implementation. These roles are not managed by `hms_database` and must not be used, granted to or adopted. The bootstrap refuses to take over any role that lacks its `hms_database:...` comment.

### 2.1 Capability group roles

Login roles receive data privileges only through NOLOGIN capability group roles, which are shared by the HMS databases on a cluster. Migrations grant only to these groups, never to `PUBLIC` or a login role.

| Login role | Member of |
|---|---|
| `<p>_runtime` | `hms_platform_rw`, `hms_iam_rw`, `hms_eventing_rw`, `hms_integration_rw`, `hms_audit_append`, `hms_terminology_rw`, `hms_workforce_rw`, `hms_patient_rw`, `hms_clinical_rw`, `hms_readmodel_rw`, `hms_privacy_rw` |
| `<p>_legacy_bridge` | `hms_legacy_bridge` (marker), `hms_workforce_rw`, `hms_patient_rw`, `hms_clinical_rw`, `hms_eventing_rw` |
| `<p>_auditor` | `hms_audit_read` |
| `<p>_reporting` | `hms_report_read` |
| `<p>_migrator` | `<p>_owner` with SET only, no inheritance |

`<p>_runtime` is never a member of `hms_legacy_bridge`. Members of that marker can write only the domains whose authority is legacy; everyone else can write only the domains whose authority is native (ADR-DB-006). A new group role is added to the bootstrap and the bootstrap is re-run before any migration grants to it.

### 2.2 Assigned operator selection

- Record the selected operator in environment-specific operations documentation.
- Do not assume that a role named `postgres` is the assigned operator.
- Do not use shared human credentials. Prefer individually attributable administrator identities where operationally feasible.
- If the platform supports only one administrative login for the intended development setup, record the limitation and secure credential custody.
- Prevent other superusers from routine access through credential custody, network rules, host access and documented operational controls. A database policy document alone cannot technically prevent a superuser who still possesses credentials and host access.
- Never remove the only viable recovery route. Keep a separately secured, monitored, offline or vault-controlled break-glass mechanism.

### 2.3 Superuser use

A PostgreSQL superuser bypasses normal database permission checks. Therefore:
- Use superuser only for bootstrap, cluster-level administration and exceptional recovery.
- Do not put superuser credentials in Go service configuration, `.env` files used by applications, Docker images, CI variables available to application builds, or desktop/mobile clients.
- Do not use superuser as the schema owner for ordinary application schemas.
- Do not use superuser for routine application CRUD, API requests, background jobs or reporting.
- Audit every administrative session and privileged change to the extent supported by the deployment.

## 3. Canonical application identity

`<p>_runtime` is the canonical application runtime identity. All hms_services native runtime components connect using this identity (or a centrally managed credential rotation mechanism that resolves to this database role).

The legacy bridge worker is the one approved exception. It connects as `<p>_legacy_bridge` (ADR-ROOT-002, ADR-DB-006), which holds only the canonical record groups and the `hms_legacy_bridge` marker. It has no iam, platform, privacy, read-model, native integration or audit access. The same rules below apply to it.

The identity:
- MUST be `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS` (re-applied on every bootstrap run).
- MUST NOT own databases, schemas or tables.
- MUST receive only the minimum schema/table/sequence/function privileges required by runtime operations, through capability group roles (§2.1).
- MUST have a documented connection budget and credential rotation procedure. The bootstrap sets the connection limit to 50 for `<p>_runtime` and 5 for `<p>_legacy_bridge`, and sets `statement_timeout 30s`, `lock_timeout 5s` and `idle_in_transaction_session_timeout 60s` for both.
- MUST not be used by developers for interactive schema changes.
- MUST not be exposed to React, Android or iOS clients. Clients call backend APIs; they never connect directly to PostgreSQL.

A single canonical role does not mean one shared password embedded in every service. Use a secret manager or protected runtime secret distribution, rotate credentials, and consider separate database credentials only if a documented security boundary requires them. If further service roles are introduced, they must remain non-superuser and must not contradict the canonical runtime access standard without an ADR.

## 4. Object ownership and migrations

The NOLOGIN role `<p>_owner` owns the database and every schema and object in it. This avoids granting the runtime role ownership powers.

Migrations run through the controlled deployment identity `<p>_migrator`:
- It is the only migration login. `scripts/migrate.*` connects as it and wraps each migration file in a transaction after `SET ROLE <p>_owner`.
- It is not a superuser, and the bootstrap re-applies that on every run.
- It inherits no rights. Without `SET ROLE` it cannot read or change data (tested), and after it it can act only on objects owned by `<p>_owner`.
- Its connection limit is 3, with `lock_timeout 10s` and `idle_in_transaction_session_timeout 5min`.
- Migration execution is one-shot and coordinated by the release process, not launched concurrently by every service replica.
- The migration artifact is versioned, reviewed, tested and has a rollback/forward-fix plan.
- If an operation genuinely requires superuser-only privileges (for example, certain extension or cluster operations), it is a separately approved administrative task, not a reason to make the normal migrator or application role a superuser.

## 5. Development lifecycle

### Phase A — bootstrap and assignment
1. Identify PostgreSQL version and installation/container topology.
2. Inspect existing roles, memberships, databases, extensions, object owners and authentication configuration.
3. Assign one administrative operator for the development environment.
4. Record operator identity, assignment date, credential custody, permitted host/network and recovery procedure.
5. Confirm backup or disposable-environment recovery before changing privileges.

### Phase B — provision canonical roles
1. Assigned operator runs `bootstrap/bootstrap.psql` as a superuser through `scripts/bootstrap.ps1` or `scripts/bootstrap.sh`. It creates or verifies the database, the six `<p>_*` roles and the capability group roles. It is idempotent and never adopts a role without its `hms_database:...` comment. Use another prefix when `hms_meta` is taken on the cluster.
2. Set the `<p>_migrator` and `<p>_runtime` passwords at the bootstrap's `\password` prompt. `<p>_legacy_bridge`, `<p>_auditor` and `<p>_reporting` cannot sign in until a password is set for the ones the environment needs. CI may pass `HMS_*_PASSWORD` instead (not on servers that log DDL).
3. Run migrations as `<p>_migrator` (`scripts/migrate.*`). Every schema and object is owned by `<p>_owner`.
4. Grant privileges only to capability group roles, in migrations.
5. Run `scripts/test.*`. `tests/sql/010_roles_and_database.sql` checks role attributes, exact memberships, `PUBLIC` revocation and runtime DDL denial.
6. Verify the runtime role cannot create roles/databases, alter protected schema objects, bypass row-level security or access unrelated schemas.

### Phase C — application development
1. Go services connect using `<p>_runtime` for ordinary runtime operations, and the legacy bridge worker uses `<p>_legacy_bridge`.
2. Migrations use the controlled migration path.
3. Developers do not use superuser credentials in application settings.
4. Run authorization, privilege, migration, connection-budget and backup tests.
5. Track resource use and tune based on measured workload.

### Phase D — release candidate
1. Validate clean database initialization from migrations.
2. Validate upgrade from the previous supported schema version.
3. Validate rollback or documented forward-fix.
4. Validate backup and restore.
5. Validate application behavior using only `<p>_runtime` (and `<p>_legacy_bridge` for the bridge worker).
6. Confirm no dependency on development-only roles, credentials, paths or host settings.

## 6. Production transition

Production is Linux-only.

Before production activation:
1. Provision a clean production cluster/database using the approved Linux deployment baseline.
2. Create the `<p>_*` and capability group roles by running `bootstrap/bootstrap.psql` under the controlled bootstrap process.
3. Apply reviewed, versioned migrations as `<p>_migrator`.
4. Provision the `<p>_runtime` and `<p>_legacy_bridge` credentials, and any `<p>_auditor`/`<p>_reporting` credentials in use, through the production secret-management path.
5. Verify all native services use `<p>_runtime` for ordinary database connections and only the legacy bridge worker uses `<p>_legacy_bridge`.
6. Remove routine access for development operator credentials; disable login where appropriate after verifying ownership and recovery requirements.
7. Exclude other superusers from routine access and secure the break-glass path separately.
8. Verify `pg_hba.conf`, network security, TLS, host access, audit configuration, backups and restore.
9. Run privilege and operational acceptance tests before traffic is enabled.

### 6.1 Production privilege transition

The development operator's administrative role must not become the application's production runtime role. Production runtime uses `<p>_runtime`, the legacy bridge uses `<p>_legacy_bridge`, migrations use `<p>_migrator`, and emergency administration uses the secured recovery process.

Do not simply transfer the development superuser's 75% resource budget to `<p>_runtime`. PostgreSQL does not offer a native per-role CPU/RAM reservation model. Instead, production infrastructure limits and PostgreSQL settings are sized for the production workload.

## 7. Resource allocation policy: 75/25

The intended 75/25 allocation is interpreted as:

- 75%: planned resource envelope for the PostgreSQL service/workload.
- 25%: reserved capacity for operating system, monitoring, backup agents, security services, deployment utilities and other supporting processes.

This is a planning target, not a hard guarantee and not a per-role quota. It must be validated against actual hardware, co-located workloads, memory pressure, I/O and peak concurrency.

### 7.1 What PostgreSQL can and cannot enforce

PostgreSQL has connection limits and configurable memory/worker settings, but it does not natively reserve exactly 75% of CPU/RAM for a superuser and 25% for an application role. `work_mem` may be consumed by multiple operations per query and by concurrent sessions. `shared_buffers` is only one part of total memory use.

Do not translate 75/25 into:
- `shared_buffers = 75% of RAM`;
- a superuser-specific 75% CPU quota;
- an application-role 25% memory quota;
- a guarantee that the application cannot exceed 25% of server resources.

### 7.2 Enforcement by platform

**Windows development**
- Use Windows service/process resource monitoring and supported OS/container controls.
- If PostgreSQL runs in Docker Desktop/WSL2, document both Docker/WSL resource limits and PostgreSQL settings.
- Do not assume Windows host limits and container limits are equivalent.

**Linux development and production**
- Prefer systemd resource controls or cgroup/container limits for service-level CPU and memory boundaries.
- Set PostgreSQL service/container limits based on the planned envelope.
- Reserve host capacity for OS and supporting services.
- Monitor OOM kills, memory pressure, CPU throttling, disk latency, connection saturation and query latency.

### 7.3 PostgreSQL tuning guardrails
- Set `max_connections` from a connection budget, not arbitrarily high. The bootstrap's per-role limits add up to 73 (runtime 50, reporting 10, legacy bridge 5, auditor 5, migrator 3), plus the superuser reserve.
- Calculate aggregate application connections as replicas × per-replica pool maximum, plus migration, monitoring and reserved administration connections.
- Configure `shared_buffers`, `work_mem`, `maintenance_work_mem`, `effective_cache_size`, worker settings and autovacuum based on host size and workload tests.
- `effective_cache_size` is a planner estimate, not allocated memory.
- `work_mem` is not a per-session total cap.
- Use connection pooling where appropriate; avoid multiplying large pools across many services.
- Establish alert thresholds and load-test before changing production settings.

## 8. Windows/Linux portability

Keep these artifacts platform-independent:
- SQL schema and migration files;
- role and grant specifications;
- naming conventions;
- data types and constraints;
- backup/restore acceptance criteria;
- connection security requirements;
- application connection contract.

Keep these platform-specific:
- service installation and lifecycle;
- filesystem paths and permissions;
- resource enforcement;
- secret mounting/injection;
- logging integration;
- firewall and host-hardening procedures.

Production deployment is Linux only. CI should test migration and application compatibility on at least one supported Linux PostgreSQL environment; Windows development compatibility should be verified when the team supports it.

## 9. Audit and evidence

Record, without exposing secrets:
- assigned operator and environment;
- administrative access grant/revocation events;
- role creation and privilege changes;
- schema ownership changes;
- migration version, actor, timestamp and result;
- production promotion approval;
- resource budget and configuration revision;
- backup/restore test evidence;
- emergency access and incident reference.

Avoid logging passwords, connection strings containing credentials, tokens, PHI or full sensitive query parameters.

## 10. Required acceptance tests

A release is not database-governance-ready until tests demonstrate:
- No `<p>_*` role is a superuser or can create roles or databases.
- `<p>_runtime` and `<p>_legacy_bridge` do not own protected schemas/tables and cannot run DDL.
- Login roles have only access granted through their capability group roles, and are members of exactly the groups in §2.1.
- `<p>_runtime` is not a member of `hms_legacy_bridge`.
- `<p>_migrator` has no data access without `SET ROLE <p>_owner`.
- Other administrative accounts are excluded from routine access according to the environment policy.
- A secured recovery administrator remains available.
- Migrations run through the approved identity and not every application replica.
- Windows/Linux development use equivalent schema and role semantics.
- Production deployment configuration targets Linux.
- Connection pools fit within the database connection budget.
- Resource monitoring detects saturation and memory pressure.
- Backup restore and migration recovery are tested.

## 11. Change control

An ADR and policy update are required when changing:
- assigned operator model;
- canonical application identity semantics;
- role topology or schema ownership;
- production administrator access;
- 75/25 resource-budget interpretation;
- production OS support;
- migration authority or credential distribution.

## 12. Implementation warning

This policy is a design baseline, not a ready-to-run command sequence. Before executing SQL, inspect the actual cluster and adapt role names, ownership, grants, authentication, extensions and deployment tooling. Never revoke privileges, alter `postgres`, or disable an administrator until dependencies and emergency recovery have been verified.
