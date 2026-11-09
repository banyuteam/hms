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

Proposed, not created (need an approved capability with owner, classification and consumers first):
`security`, `workflow`, `ai_platform`, `notification`, `licensing`, `ui_platform`, `readmodel`, `patient`,
`clinical`, `orders`, `pharmacy`, `billing`, `inventory`.

The scaffold folders `schemas/event-streaming` and `schemas/legacy-integration` are superseded by `eventing` and
`integration`; remove them once nobody depends on the names.
