# ADR-DB-005: Clinical record integrity: transaction context, version history, corrections and tenant isolation

- Status: Proposed (2026-11-09)
- Date: 2026-11-09
- Owners: hms_database (mechanism, tests); hms_services (sets the context, enforces authorization)
- Affected projects: hms_database; hms_services (every write and read of `patient`, `workforce`, `clinical`,
  `imaging`, `privacy`, `readmodel` and the new `integration` tables)
- Related: ADR-DB-002 (deferred row-level security until tenant-scoped clinical tables exist), ADR-DB-003 (IAM),
  ADR-DB-004; root `CLAUDE.md` §6, §8; Permenkes 24/2022 Pasal 16(2), 29, 30

## Context
- **Attribution:** Permenkes 24/2022 requires every entry to carry the provider's name, time and signature
  (Pasal 16(2)).
- **Integrity:** it requires records to keep confidentiality, integrity and availability (Pasal 29).
- **Corrections:** it allows a correction only by authorised persons, within 2x24 hours or later with approval
  (Pasal 30).
- **Workspace rules:** the root rules require that signed records are never silently overwritten and that tenant
  boundaries are kept.
- **Gap:** the IAM foundation decides *who may* act; the database must record *who did* act. It must also make
  history impossible to rewrite from the application role.

## Decision
1. **Transaction context.** hms_services sets these per write transaction with `set_config(name, value, true)`:
   - `hms.organization_id`: the tenant.
   - Exactly one of `hms.actor_user_id` (an `iam.users.id`) or `hms.actor_service` (a service name for unattended
     jobs, e.g. `legacy-import`).
   - Optionally `hms.request_id`.
   - `hms.change_reason` when correcting a finalized record or marking one entered-in-error.

   The values are recorded, not trusted for authorization, which hms_services has already decided. A user actor must
   be an *active* user of the record's organization, or the write fails.
2. **Versioned records.**
   - **Required columns:** every record table has `version`, `created_at`, `updated_at` and `last_xact_id`.
   - **Triggers:** `hms_meta.enable_versioned_record` installs four triggers.
     - `version_row`:
       - version 1 on insert, +1 per transaction that changes the row;
       - fixed columns (`id`, `organization_id`, `patient_id`, parent ids, identifier values) cannot change;
       - entered-in-error is terminal;
       - a reason is required to enter entered-in-error or to change a finalized status.
     - `capture_version`: copies the row as it now is, with actor, request and reason, into
       `<schema>.resource_versions` (SECURITY DEFINER, so writers cannot write history themselves).
     - `refuse_change`: refuses DELETE and TRUNCATE for everyone, including the owner.
     - `touch_parent`: child rows (names, components, sections) bump their parent's version, so finalized-record
       rules cover the parts too.
   - **One version per transaction:** a second change inside the same transaction replaces that version's snapshot.
     A transaction is recognised by id *and* start time, which stays safe after a logical restore where ids repeat.
   - **Sealed history:** history rows are sealed at commit.
3. **Finalized states requiring a reason:**
   - Observation `final/amended/corrected`
   - DiagnosticReport `final/amended/corrected/appended`
   - Composition `final/amended`
   - Procedure `completed/not-done`
   - Medication request `completed/cancelled/stopped`
   - Dispense `completed/declined`
   - Administration `completed/not-done`
   - Encounter `finished/cancelled`
   - Consent `active/rejected/inactive`
   - Data subject request decided states

   Conditions and allergies follow normal clinical lifecycle updates without a reason; every change is still in
   history.
4. **Append-only records:**
   - provenance (with agents and entities), composition attestations, disclosures, validation results and audit
     anchors;
   - signatures, where only verification fields may be updated.
5. **Tenant row-level security.** `hms_meta.enable_tenant_rls` adds policy `tenant_isolation` on every
   tenant-scoped table:
   - `organization_id = hms.organization_id`, for both reading and writing;
   - without the setting no row is visible (fail closed);
   - the owner (migrations, trigger functions, analytics views) is exempt;
   - workers that process several tenants set the context per batch.
6. **Integrity by keys.** Composite foreign keys tie every reference to the same organization and, for clinical
   references, to the same patient (`(encounter_id, patient_id)`). Polymorphic document entries are checked by
   trigger (`clinical.check_entry_patient`).
7. **Attestation binds to a version.**
   - An attestation names the composition version it attests, which must be final or amended in history.
   - A signature must cover exactly that resource version and be made by the practitioner's own linked user.
   - Private keys and signing credentials never enter the database.

## Alternatives considered
1. **Application-only history** (hms_services writes audit copies): a bug or a direct SQL session could skip it, and
   the history table would need to be writable by the runtime.
2. **System-versioned temporal tables:** PostgreSQL 18 has no built-in system versioning. An extension adds an
   operational dependency, and does not record the actor or the reason.
3. **Event sourcing:** forbidden as a default by root `CLAUDE.md` §8. History snapshots give `_history`/`vread`
   without making events the source of truth.
4. **One version per statement:** registration (patient + names + identifiers) would produce many versions for one
   clinical act.
5. **Tenant isolation in hms_services only:** a missing WHERE clause would leak another tenant's records.
   Row-level security is defence in depth at small cost.

## Consequences
- **Positive:**
  - Every clinical change is attributable and reproducible, a correction never destroys the prior content, and
    history cannot be edited by the application role.
  - Cross-tenant and cross-patient mistakes fail at the database.
- **Negative:**
  - Every write path must set the context; forgotten context fails loudly (P0001), which is intended.
  - Write amplification: one history row per changed row per transaction.
  - Direct SQL maintenance must set the context too.
- **Operational:**
  - **Manual and reporting queries:** run as the owner, or set `hms.organization_id` (RUNBOOK).
  - **Logical restore:** keeps history and versions; the time-qualified transaction check prevents version merging
    when transaction ids repeat (tested).
  - **Sizing:** `resource_versions` growth needs monitoring, and partitioning before volume requires it.
- **Compatibility:** new tables only. Existing `platform`, `iam`, `audit`, `eventing` and `integration` tables keep
  their behaviour. ADR-DB-002's deferred row-level security is now in place for clinical tables.
- **Security/privacy:**
  - History snapshots contain PHI and are protected like the records themselves (tenant RLS, runtime read only,
    no reporting access).
  - The owner role and superusers can still disable triggers. External anchoring of the audit chain and
    restricted owner access are the compensating controls.
- **Patient safety:**
  - Finalized results and documents cannot change unnoticed.
  - entered-in-error keeps the wrong record visible as wrong, rather than deleting it.

## Ownership impact
- **hms_database** owns the functions, triggers, policies and tests.
- **hms_services** must:
  - set the context in one helper used by every repository;
  - pass `hms.change_reason` from the user's correction dialog;
  - apply the Permenkes 24/2022 Pasal 30 rule (author corrections within 2x24 hours, later corrections need PMIK or
    facility-head approval, recorded via an approved workflow);
  - map `resource_versions` to FHIR `meta.versionId` and `_history`.

## Migration and rollout
- New migrations 0006-0020; nothing to backfill.
- hms_services adds the context helper before its first clinical write.
- Rollback is fix-forward; a development database can be recreated.

## Acceptance criteria
- [x] Writes without actor, with an inactive actor, with a user of another organization, or with both actor kinds
  are refused.
- [x] Insert or update of another tenant's rows is refused; without context nothing is visible.
- [x] Registration in one transaction gives version 1; a later change gives version 2; corrected content stays in
  history with actor and reason.
- [x] Finalized changes without a reason are refused, including through child rows; entered-in-error is terminal;
  fixed columns cannot change.
- [x] DELETE and history edits are refused for the runtime, and DELETE for the owner.
- [x] A transaction id repeated after a restore does not merge versions.
- [ ] hms_services context helper and correction workflow implemented and tested end to end.
