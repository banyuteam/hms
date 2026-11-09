# hms

`hms` is the top-level HMS engineering workspace. This bundle contains the workspace-level architecture, project scaffolds, Claude Code instructions and skills for the HMS platform.

## Projects
- `hms_database/` — data architecture and persistence.
- `hms_services/` — backend runtime and integration services.
- `hms_workspace/` — web and native mobile experiences.
- `standards/` — cross-project governance and contracts.
- `deployment/` — workspace-level Docker Compose templates, environment guidance and release readiness.

## Core architecture decisions
1. Web is the complete HMS operating environment.
2. Android (Kotlin) and iOS (Swift) are purpose-built native clients for approved mobile workflows, not full replicas of web.
3. The existing Banyumanik 2 HMS web UI is the design baseline. Preserve its established branding, colors, components and working screens; evolve its shell incrementally.
4. Web uses a persistent application shell, top global navigation, application launcher, workspace canvas, bottom workflow dock and persistent assistant panel.
5. Bottom dock items represent opened workflow instances, not static module categories.
6. Assistant requests carry explicit user-selected resource references. Active workflow state never implicitly grants assistant context.
7. `hms_services` independently resolves and authorizes every resource reference.
8. `hms_database` owns canonical persistence and data integrity; no frontend directly accesses databases.
9. Existing legacy MySQL remains read-only and unchanged.
10. Docker containerization and release readiness are mandatory workspace-level delivery gates.
11. Cross-project consistency is maintained by root instructions, project instructions, versioned contracts and ADRs.

## How to use
1. Place this folder in the parent engineering workspace or adapt the project folders into their own repositories.
2. Keep root `CLAUDE.md` at the common workspace root.
3. Keep each project's `CLAUDE.md` at that project's root.
4. Read `SKILLS-CATALOG.md` and invoke the relevant skill for the task.
5. Treat scaffolds as recommended organization, not a mandate to move existing working code. Inspect the actual repository first.
6. Update contracts and ADRs when changing shared behavior.

## Important
The structure is a target architecture. It is not a claim that all listed modules, integrations, mobile capabilities or production controls already exist.


## Workspace-level platform capabilities (v4)
The workspace now defines a shared Control Plane architecture covering IAM, runtime configuration, security/threat detection, workflow, eventing, integration, AI governance, notifications and module/entitlement metadata. PostgreSQL is treated as shared persistence infrastructure with schema ownership and least-privilege access—not a universal shared connection.

## Declarative UI Engine (v4)
A governed Python UI DSL can author source-controlled declarative screens and compile them to a typed, versioned UI IR. Go validates and authorizes data/actions; React renders allowlisted components through the existing Banyumanik 2 design system. Python does not run in the browser. Existing React screens remain intact and are migrated incrementally.

Read:
- `standards/architecture/workspace-control-plane.md`
- `standards/architecture/shared-postgresql-platform.md`
- `standards/architecture/runtime-configuration-and-security.md`
- `standards/architecture/declarative-ui-engine.md`
- `standards/contracts/ui-ir-contract.md`
- `standards/architecture/project-ownership-matrix.md`

The new standards are architectural guidance and skill instructions, not claims that the engines or monitoring stack are already implemented. Implement them in vertical slices and verify the actual repository and deployment before claiming readiness.
