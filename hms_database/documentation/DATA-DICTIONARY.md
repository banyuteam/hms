# Data Dictionary

Index of tables. Column-level meaning is in the migrations (`COMMENT ON`) and in each schema README. Check the live
definitions with `\d+ schema.table` in psql.

| Table | Migration | Grain | Key | Notes |
|---|---|---|---|---|
| `hms_meta.schema_migrations` | runner | one applied migration | `version` | checksum = SHA-256 of the file without CR bytes |
| `platform.organizations` | 0001 | one tenant | `id` (UUIDv7), `code` unique | deactivate, never delete |
| `platform.facilities` | 0001 | one care site | `id` (UUIDv7), (`organization_id`, `code`) unique | IANA `timezone` for local clinical time |
| `audit.audit_events` | 0002 | one audited action | `seq` (chain position), `event_id` unique | append-only; hash chain; no record contents |
| `eventing.outbox_events` | 0003 | one domain event | `id`, `event_id` unique | envelope per `standards/contracts/event-envelope.md`; payload <= 64 KiB |
| `eventing.consumer_receipts` | 0003 | one processed event per consumer | (`consumer_name`, `event_id`) | deduplication for at-least-once delivery |
| `integration.poll_checkpoints` | 0004 | one polled stream | `stream_name` | optimistic `cursor_version` |
| `integration.poll_leases` | 0004 | one stream lease | `stream_name` | fencing token `fence` |
| `integration.sync_runs` | 0004 | one polling run | `id`, `run_id` unique | counts and outcome only |
| `iam.users` | 0005 | one staff person in an organization | `id` (UUIDv7) | `id` is the audit `actor_id`; never deleted |
| `iam.external_identities` | 0005 | one identity link | `id`; active (`issuer`, `subject`) unique | legacy HMS staff record or OIDC subject |
| `iam.roles` | 0005 | one role | `id`, `code` unique | global catalog |
| `iam.permissions` | 0005 | one enforced capability | `code` (`resource.action`) | registered by hms_services |
| `iam.role_permissions` | 0005 | permission in a role | (`role_id`, `permission_code`) | |
| `iam.role_assignments` | 0005 | one grant | `id` | organization- or facility-scoped; revoke, never edit |
| `iam.sessions` | 0005 | one session | `id_hash` (SHA-256 of token) | no token stored |
| `iam.signin_attempts` | 0005 | lockout counter | `account_key_hash` | no identifier stored |
| `iam.effective_permissions` (view) | 0005 | permission in force | - | single definition of "granted now" |

Details: [platform](../schemas/platform/README.md), [audit](../schemas/audit/README.md),
[eventing](../schemas/eventing/README.md), [integration](../schemas/integration/README.md), [iam](../schemas/iam/README.md).
