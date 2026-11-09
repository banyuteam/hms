# HMS Architecture Overview

- **NTL — Native Transaction Layer:** new writes using canonical models and domain rules.
- **LCL — Legacy Compatibility Layer:** anti-corruption boundary translating legacy concepts into canonical concepts.
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

A row change is not automatically a business event. Polling time is not necessarily occurrence time. A broker is not a system of record. A read model is not a write model.
