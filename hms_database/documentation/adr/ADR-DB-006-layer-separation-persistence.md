# ADR-DB-006: Persistence of the layer separation — domain authority, layer guard, bridge identity and state

- Status: Proposed (2026-11-10)
- Date: 2026-11-10
- Owners: hms_database
- Affected projects: hms_database (migration 0021, bootstrap); hms_services (every canonical write, legacy bridge)
- Related: ADR-ROOT-002 (the decision this persists), ADR-DB-002 (roles), ADR-DB-004/005 (clinical foundation)

## Context
ADR-ROOT-002 lets two layers write the canonical record: the native transaction layer and the legacy bridge, never
both for the same organization and domain at once. Root `CLAUDE.md` §14 asks for separate runtime and legacy
identities. The rule must hold for any writer, not only for the Go code that knows it.

## Decision
Migration `0021_layer_separation.sql` and the bootstrap add:
1. **Domains:** `integration.record_domains` (16 domains) and `integration.record_domain_tables` (each of the 37
   versioned tables in `patient`, `workforce`, `clinical`, `imaging` belongs to exactly one domain; a child table to
   its parent's). `privacy` and `integration` tables are native-only and are not in a domain.
2. **Authority:** `integration.domain_authority` (organization, domain, `legacy | cutover | native`, effective time,
   decision reference), versioned in `integration.resource_versions`, tenant-isolated. Moves: legacy → cutover →
   native, cutover → legacy; each needs `hms.change_reason`; native is final. Only the owner writes it (RUNBOOK).
3. **Guard:** `hms_meta.guard_record_layer()` BEFORE INSERT OR UPDATE on every domain table (installed by
   `hms_meta.enable_record_domain`). The writer is the bridge when the current role is a member of
   `hms_legacy_bridge`, otherwise native. It refuses `hms.actor_service = legacy-bridge` from a non-member and its
   absence from a member (42501), and a writer without the domain's authority (HM001). It stamps `record_origin` on
   insert and keeps it fixed. Rows written by another record trigger (a child touching its parent) were checked at
   their own table; a row of another tenant is left to row-level security.
4. **Identity:** group `hms_legacy_bridge` (marker) and login `<prefix>_legacy_bridge` with `hms_workforce_rw`,
   `hms_patient_rw`, `hms_clinical_rw`, `hms_eventing_rw` and the marker, nothing else; password from
   `HMS_LEGACY_BRIDGE_PASSWORD` (optional: without it the login cannot sign in). The runtime is never a member.
5. **Bridge state:** `integration.poll_checkpoints`, `poll_leases`, `sync_runs`, `legacy_record_links` and the new
   `integration.bridge_issues` are written by the bridge only; the runtime keeps SELECT, and may close bridge issues
   (status, closer, note). `legacy_record_links` gains `mapping_version`, and its active-link rule becomes per
   organization (fix to 0016: legacy keys repeat across organizations, and a global rule leaked their existence
   across tenants through a unique violation).
6. **Identifier system** `urn:hms:id:mrn` (medical record number, unique per organization, format as stored by the
   legacy HMS).

## Alternatives considered
1. A `record_origin` check only, without authority: a native correction to migrated history and a later Khanza edit
   would still both write the same row.
2. Authority on each row instead of per domain: cutover would mean rewriting every row; one decision per domain is
   what the hospital actually makes.
3. Identifying the bridge by `hms.actor_service` alone: any runtime transaction could claim it. Role membership
   cannot be claimed.

## Consequences
- Every canonical write performs one indexed lookup (registry + authority) in the writer's transaction.
- Tests that write canonical records first give their organization an authority (`pg_temp.set_authority`).
- New record tables must call `hms_meta.enable_record_domain` (governance test 020 fails otherwise, as it does for a
  child table in a different domain than its parent).
- Superusers count as the bridge only when they declare `legacy-bridge`, and bypass row-level security as before;
  they are not application identities.

## Migration and rollout
Re-run the bootstrap (adds the role and login; idempotent), then migrate. Insert each organization's initial
authority with the RUNBOOK procedure before any writer runs. Rollback: fix forward (no environment holds clinical
records yet).

## Acceptance criteria
- [x] Tests 010 (roles), 020 (governance: domains, guard, origin, child domains, bridge-only state, owner-only
      authority), 060 (polling state is bridge-only), 110 (crosswalk is bridge-only), 120 (behaviour).
- [x] Mutation checks: guard disabled, guard allowing everything, runtime made a bridge member, table unregistered,
      child moved to another domain, runtime granted crosswalk INSERT — each fails a test.
