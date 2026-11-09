---
name: workspace-control-plane-architecture
description: Design and evolve shared HMS platform capabilities across hms_database, hms_services and hms_workspace without blurring ownership.
---
# Workspace Control Plane Architecture

## Use when
A change introduces or modifies shared identity, configuration, security, workflow, eventing, integration, AI, notification, licensing or platform administration capabilities.

## Required method
1. Identify the capability's owning project and runtime owner.
2. Separate persistence, runtime enforcement, API contract and client presentation.
3. Check whether an existing platform capability already solves the need.
4. Define the schema/API/event boundary before implementation.
5. Keep the initial deployment modular; do not create a microservice solely because a schema exists.
6. Define tenant/facility scope, authorization, audit, data classification and failure behavior.
7. Document dependencies, rollout, compatibility and rollback.
8. Update the ownership matrix, project instructions, contracts and skill catalog when boundaries change.

## Hard rules
- Shared PostgreSQL is not unrestricted shared access.
- `hms_workspace` never connects to PostgreSQL.
- Go services enforce authorization and authoritative writes.
- `hms_database` owns schema and migrations, not runtime execution.
- Cross-project changes require coordinated review.
- Do not claim capabilities exist until implemented and tested.
