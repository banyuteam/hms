# HMS Architecture Overview

- **NTL — Native Transaction Layer:** new writes using canonical models and domain rules (`hms_services/native/...`,
  runtime login).
- **LCL — Legacy Compatibility Layer:** anti-corruption boundary translating legacy concepts into canonical concepts.
  Its write side is the **legacy bridge** (`hms_services/legacybridge/...`, own login): SELECT-only legacy reads,
  versioned mappings, canonical writes as service `legacy-bridge` (ADR-ROOT-002).
- **LRA — Legacy Read Adapter:** authorized historical reads; no write path.
- **LSL — Legacy Synchronization Layer:** umbrella capability for observing and reconciling legacy information.
- **LRPA — Legacy Read Polling Adapter:** query-polling implementation under LSL.
- **CDM — Canonical Domain Model:** stable business meaning and canonical data definitions.
- **CRM — Clinical Read Model:** query-optimized projections, not authoritative write model.
- **ESIL — Event Streaming & Integration Layer:** event contracts, outbox publication, broker distribution and consumers.
- **HIL — Healthcare Interoperability Layer:** FHIR, SATUSEHAT, DICOM and external integration boundaries.
- **Enterprise IAM:** central authentication; application services retain resource-level authorization.

Native flow: API -> Go service -> authorization -> domain operation -> PostgreSQL transaction + outbox -> publisher -> broker -> consumers.

Legacy flow: Legacy MySQL (SELECT only) -> LRPA -> checkpoint/snapshot in new PostgreSQL -> change classification -> canonical mapping -> observed/canonical event -> consumers.

Write authority (ADR-ROOT-002): both layers write the same canonical records through `hms_services/canonical/...`, but
never the same domain of the same organization at once. `integration.domain_authority` says per organization and
domain whether the bridge (`legacy`), nobody (`cutover`) or the native layer (`native`) may write, and the database
refuses any other writer. Domains move legacy -> cutover -> native, one at a time; native is final. After cutover,
legacy changes are reported as bridge issues, never applied.

A row change is not automatically a business event. Polling time is not necessarily occurrence time. A broker is not a system of record. A read model is not a write model.
