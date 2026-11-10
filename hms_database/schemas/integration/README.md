# Schema `integration`

- Migrations: `0004_integration_polling_state.sql`; `0016_integration_interoperability.sql` (ADR-DB-004);
  `0021_layer_separation.sql` (ADR-ROOT-002, ADR-DB-006)
- Writers: the legacy bridge (`hms_legacy_bridge`: polling state, crosswalk, bridge issues); `hms_services` native
  integrations (`hms_integration_rw`: external ids, outbound submissions, validation results, closing bridge issues);
  the owner only (`domain_authority`, via the RUNBOOK cutover procedure)
- Classification: confidential (cursors may hold legacy business keys such as encounter numbers)
- Policy: `standards/security/legacy-read-only-policy.md`. The legacy MySQL source is never written; its polling
  state lives here.

## Tables
- `poll_checkpoints`: durable cursor per stream. `cursor_value` is a JSON array/object (NULL before the first batch).
  Advance with optimistic concurrency: `... WHERE stream_name = $s AND cursor_version = $v`; zero rows = lost race.
  `last_error_code` is an error class, never a message, SQL text or row content.
- `poll_leases`: one active poller per stream. Acquire/take over:
  ```sql
  INSERT INTO integration.poll_leases (stream_name, holder, fence, expires_at)
  VALUES ($s, $holder, 1, now() + $ttl)
  ON CONFLICT (stream_name) DO UPDATE
  SET holder = EXCLUDED.holder, fence = poll_leases.fence + 1, acquired_at = now(), expires_at = EXCLUDED.expires_at
  WHERE poll_leases.expires_at < now() OR poll_leases.holder = EXCLUDED.holder;
  ```
  The fence grows with every acquisition; a holder compares it before writing a checkpoint.
- `sync_runs`: one row per polling run with counts and outcome (`running|succeeded|failed|abandoned`).

Times recorded here are observation times, not business-event times.

## Interoperability (0016)
Tenant row-level security applies to these tables: workers set `hms.organization_id` per batch.
- `external_systems`: the systems HMS exchanges with: `legacy-hms` (SIMRS Khanza, read-only), `satusehat`, `pacs`.
  It holds no endpoints or credentials.
- `legacy_record_links`: crosswalk from a legacy row `(source_system, source_entity, source_key)` to a canonical
  record.
  - One active link per legacy key and resource type.
  - `source_row_sha256` detects source changes.
  - Superseding or rejecting a link needs a reason; links are never deleted.
  - Khanza itself is never written.
- `external_resource_ids`: ids assigned by an external platform (SATUSEHAT resource ids), one active per record and
  per external id.
- `outbound_submissions`: queue and history of resource-version submissions. Each submission has an idempotency key
  (unique per system) and records status, attempts, HTTP status and error class.
  - The payload hash is stored; the payload never is.
  - Accepted submissions record `accepted_at` and the external id.
  - Due work: `WHERE status IN ('pending', 'failed') AND next_attempt_at <= now() ORDER BY next_attempt_at, id FOR
    UPDATE SKIP LOCKED`.
- `validation_results`: append-only FHIR profile validation outcome per resource version. Issues are recorded as
  severity, code and expression only, never values.

## Layer separation (0021)
- `record_domains`, `record_domain_tables`: the 16 record domains (units of cutover) and the domain of each canonical
  record table. A child table is in its parent's domain.
- `domain_authority`: per organization and domain, `legacy` (only the bridge writes), `cutover` (nobody) or `native`
  (only HMS writes). Versioned (`integration.resource_versions`), tenant-isolated, changed by the owner only, moves
  legacy → cutover → native or cutover → legacy, each with `hms.change_reason`. The layer guard on every record table
  refuses other writers with SQLSTATE `HM001`; read the authority in a transaction:
  ```sql
  SELECT authority FROM integration.domain_authority
  WHERE domain = 'patient' AND organization_id = current_setting('hms.organization_id')::uuid;
  ```
- `bridge_issues`: legacy rows the bridge could not map fully (`rejected`, `partial`) and legacy changes after the
  domain's cutover (`not_applied`), by key, legacy column and reason code, never values. One open issue per key,
  reason and column; the bridge counts repeats and resolves issues that disappear:
  ```sql
  INSERT INTO integration.bridge_issues AS i (organization_id, source_system, source_entity, source_key, source_field,
         kind, reason_code, mapping_version, source_row_sha256) VALUES (...)
  ON CONFLICT (organization_id, source_system, source_entity, source_key, reason_code, source_field) WHERE status = 'open'
  DO UPDATE SET last_seen_at = now(), seen_count = i.seen_count + 1;
  ```
  Stewards accept an issue (`status = 'accepted'`, closer and note required) through `hms_services`.
- `legacy_record_links.mapping_version`: the mapping (name/number) that last wrote the record. The active-link rule
  is per organization (keys repeat across organizations).
- Polling state, the crosswalk and bridge issues are written by the bridge login only; the native runtime reads them.

## Not decided yet
Deletion detection for legacy tables without tombstones (periodic key reconciliation), run-history retention, the
stewardship API for bridge issues.
