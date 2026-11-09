---
name: hms-architecture-governance
description: >
  Applies HMS architecture boundaries, project ownership, ADR governance and cross-project change protocols. Use for system design, shared contracts or changes affecting both projects.
---


# HMS Architecture Governance

1. Identify owner: database, services or workspace standard.
2. Inspect current implementation and contracts before proposing changes.
3. Identify source of truth and consumers.
4. Check architecture overview and ownership matrix.
5. Create/update an ADR for material decisions.
6. Define compatibility, migration, rollback and verification.
7. Update owner contract first, then consumers.

Rules: `hms_database` owns persistence contracts; `hms_services` owns runtime behavior. Avoid cross-service database writes and unnecessary brokers/microservices. Review security, tenant isolation, clinical safety, failure semantics and observability.

Architecture output must include context, decision, ownership, flow, alternatives, trade-offs, risks, rollout, tests and open questions.
