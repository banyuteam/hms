# Domain Ownership

Every schema has one owning definition project (`hms_database`), one runtime writer and named consumers. A shared
cluster does not imply shared write access: other projects use APIs, events or approved read models.

| Schema | Status | Purpose | Runtime writer | Readers | Group roles | Classification |
|---|---|---|---|---|---|---|
| `hms_meta` | Active (runner) | Migration ledger, shared trigger utilities | migration runner only | none | none | internal |
| `platform` | Active (0001) | Organizations (tenant boundary), facilities | `hms_services` platform module | `hms_services`, reporting | `hms_platform_rw`, `hms_report_read` | internal |
| `audit` | Active (0002) | Append-only, hash-chained audit trail | `hms_services` audit integration (INSERT only) | audit reviewers | `hms_audit_append`, `hms_audit_read` | restricted |
| `eventing` | Active (0003) | Transactional outbox, consumer receipts | `hms_services` producers, relay, consumers | `hms_services` | `hms_eventing_rw` | confidential |
| `integration` | Active (0004) | Legacy polling checkpoints, leases, run history | `hms_services` legacy polling adapter | `hms_services` | `hms_integration_rw` | confidential |
| `iam` | Active (0005) | Users, external identity links, roles, permissions, scoped grants, sessions, lockout | `hms_services` IAM module | `hms_services`, audit reviewers (not sessions) | `hms_iam_rw`, `hms_audit_read` | confidential |
| `terminology` | Active (0007) | Code systems, releases, concepts, value sets, concept maps, element bindings, identifier systems | `hms_services` terminology governance | clinical modules, reporting | `hms_terminology_rw`, `hms_report_read` | internal |
| `workforce` | Active (0009) | Practitioners, identifiers, roles (FHIR Practitioner/PractitionerRole) | `hms_services` workforce module | `hms_services`, audit reviewers | `hms_workforce_rw`, `hms_audit_read` | confidential |
| `patient` | Active (0010) | Master patient index, identifiers, names, contacts, addresses, links, consent | `hms_services` patient module | `hms_services` | `hms_patient_rw` | restricted |
| `clinical` | Active (0011-0015) | Encounters, conditions, allergies, observations, procedures, reports, medication, documents, signatures, provenance | `hms_services` clinical modules | `hms_services` | `hms_clinical_rw` | restricted |
| `knowledge` | Active (0014) | openEHR archetypes/templates, semantic bindings, FHIR profiles | `hms_services` knowledge governance | clinical/interop modules, reporting | `hms_terminology_rw`, `hms_report_read` | internal |
| `imaging` | Active (0017) | DICOM study/series references (images stay in PACS) | `hms_services` imaging integration | `hms_services` | `hms_clinical_rw` | restricted |
| `readmodel` | Active (0018) | Clinical timeline, patient summaries, projection checkpoints (derived) | `hms_services` projection consumers | `hms_services` | `hms_readmodel_rw` | restricted |
| `privacy` | Active (0019) | Processing register, disclosure accounting, data subject requests | `hms_services` privacy module (register: DPO via reviewed change) | `hms_services`, DPO/audit reviewers | `hms_privacy_rw`, `hms_audit_read` | restricted |
| `analytics` | Active (0020) | Pseudonymized clinical fact views (pseudonym keys owner-only) | owner triggers only | reporting | `hms_report_read` | confidential |

`platform` also holds `locations` (0008). `integration` also holds the interoperability state (0016). `audit` also holds
`chain_anchors` (0019). Every tenant-scoped table in `patient`, `workforce`, `clinical`, `imaging`, `privacy`, `readmodel`
and the 0016 `integration` tables has tenant row-level security; transactions set `hms.organization_id` and an actor
(ADR-DB-005).

Proposed, not created (need an approved capability with owner, classification and consumers first):
`security`, `workflow`, `ai_platform`, `notification`, `licensing`, `ui_platform`, `orders`, `pharmacy`, `billing`,
`inventory`.

The scaffold folders `schemas/event-streaming` and `schemas/legacy-integration` are superseded by `eventing` and
`integration`; remove them once nobody depends on the names.
