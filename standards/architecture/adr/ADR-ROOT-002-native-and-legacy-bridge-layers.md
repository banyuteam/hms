# ADR-ROOT-002: Two write layers on one canonical record — native transactions and the legacy bridge

- Status: Proposed (owner choices 2026-11-10: per-domain cutover; database layer and one services slice now)
- Date: 2026-11-10
- Owners: Root workspace (architecture); hms_database (authority, guard, bridge persistence); hms_services (both
  layers' runtime)
- Affected projects: hms_database (migration 0021, bootstrap role); hms_services (canonical store, native patient
  API, legacy bridge worker); deployment (bridge worker, its database login); hms_workspace (later consumer of
  patient-records-v1; nothing changes now); hms_desktop (none)
- Related: ADR-DB-004/005 (clinical foundation), ADR-DB-006 (persistence of this decision), ADR-SVC-003 (legacy
  read-through), ADR-SVC-010 (first slice); `standards/architecture/architecture-overview.md` (NTL, LCL, LRA, LSL);
  `standards/security/legacy-read-only-policy.md`; contract `hms_services/contracts/api/patient-records-v1.openapi.yaml`

## Context
HMS replaces the legacy HMS (SIMRS Khanza, MySQL) gradually. For years both will run: new transactions are written
by HMS into the canonical PostgreSQL model (ADR-DB-004), while departments not yet moved keep working in Khanza.
Khanza is read-only to HMS (root `CLAUDE.md` §7), so nothing written in HMS can flow back to it.

The architecture overview already names a Native Transaction Layer (NTL) and a Legacy Compatibility Layer (LCL), but
nothing made them real: today `hms_services` reads Khanza on every request (ADR-SVC-003), and the canonical tables
from ADR-DB-004 have no writer. Without an explicit rule, the two kinds of writer would meet on the same records:
the same patient registered twice, a Khanza edit silently overwriting a correction made in HMS, or an HMS write to a
domain whose users still work in Khanza and will never see it.

## Decision
1. **One canonical record, two write layers.** Every clinical record lives once, in the canonical model. It is
   written by exactly one of:
   - the **native transaction layer** (`hms_services/native/...`): HMS commands from signed-in users, with IAM
     authorization, business rules, audit and the transaction context of ADR-DB-005; it never touches Khanza;
   - the **legacy bridge** (`hms_services/legacybridge/...`): reads Khanza SELECT-only, maps each row with a
     versioned, deterministic mapping, and writes the canonical record as service `legacy-bridge`; it never serves
     users.

   Both write through one shared canonical store (`hms_services/canonical/...`), so a mapped Khanza patient and a
   patient registered in HMS are the same shape, read by the same queries. The record's `record_origin` (native |
   legacy) and its version history (actor `legacy-bridge` or a user) tell them apart.
2. **Authority per organization and domain, enforced by the database.** `integration.domain_authority` says, for
   each organization and record domain (patient, encounter, observation, medication-request, ...; 16 domains), who
   may write: `legacy` (the bridge only), `cutover` (nobody), or `native` (the native layer only). A trigger on every
   canonical record table refuses any other writer (SQLSTATE HM001). Authority moves only `legacy → cutover →
   native` (or `cutover → legacy` to abort), with a reason, by the owner through the cutover procedure; `native` is
   final, because records created in HMS do not exist in Khanza.
3. **The bridge is a separate identity.** It runs as its own process (`hms-services legacy-bridge`) with its own
   database login, a member of the `hms_legacy_bridge` marker role. The runtime login is never a member. Only
   members may declare `hms.actor_service = legacy-bridge`, and members must. Each process refuses to start with the
   other's credentials. The bridge owns its state (crosswalk, cursors, leases, runs, issues): the runtime only reads it.
4. **Mapping is explicit and never invents.** A mapping has a version (`legacy-hms.pasien/1`). A row hash covers the
   mapped columns and the version, so unchanged rows are not rewritten and a new mapping version re-maps every row.
   What a row cannot give is recorded in `integration.bridge_issues` by key and reason code, never by value: the row
   is `rejected` (not written) or `partial` (written without the field). Data stewards close issues in HMS.
5. **After cutover, Khanza changes are reported, not applied.** When a domain becomes `native`, the native layer owns
   its records, including the history the bridge migrated (they can be corrected in HMS). A later change to the same
   Khanza row, or a new Khanza row, becomes a `not_applied` issue for review, so a department still writing in Khanza
   after its cutover is visible instead of silently diverging.
6. **Reads are layer-agnostic.** Queries and read models read the canonical record whatever its origin. The legacy
   read-through of ADR-SVC-003 (the Legacy Read Adapter) stays until a domain is fully bridged, then is retired per
   domain.

```text
                 users (web / mobile / desktop)
                              |
                       hms_services serve                       hms_services legacy-bridge
             +------------------------------------+       +-----------------------------------+
             |  native/<domain>  (NTL)            |       |  legacybridge/<entity>  (LCL)     |
             |  IAM authz, rules, audit           |       |  scan -> map (versioned) -> hash  |
             |  actor = user                      |       |  actor = service legacy-bridge    |
             +-----------------+------------------+       +----------+-----------+------------+
                               |                                     |           ^
                               v                                     v           | SELECT-only
                     canonical/<resource> (shared store)            ...          |
                               |                                                 |
   PostgreSQL  login hms_meta_runtime                login hms_meta_legacy_bridge  Khanza MySQL
               +-------------------------------------------------------------+   (unchanged)
               | canonical records  <- guard: writer must hold the domain's   |
               |                       authority (legacy | cutover | native)  |
               | integration.domain_authority, record_domain_tables           |
               | legacy_record_links (crosswalk), bridge_issues, poll_*       |
               +-------------------------------------------------------------+
```

### Per-domain cutover (procedure in `hms_database/documentation/operations/RUNBOOK.md`)
1. **Mirror:** the domain is `legacy`; the bridge maps history and follows Khanza. Stewards work the open issues.
2. **Readiness:** the bridge has completed a full pass, open `rejected` issues are accepted or fixed, counts reconcile
   with Khanza, the native slice for the domain is released, and users are trained.
3. **Cutover window:** the owner sets `cutover` (reason, approval reference). Nobody writes; the bridge runs a final
   pass in report mode; Khanza screens for the domain are closed for data entry (an operational step: HMS cannot
   change Khanza).
4. **Native:** the owner sets `native`. HMS writes; Khanza changes to the domain appear as `not_applied` issues.
5. **Abort:** from `cutover` only, back to `legacy`. After `native` there is no rollback of authority; problems are
   fixed forward in HMS.

## Alternatives considered
1. **Dual write (HMS also writes Khanza):** forbidden by the read-only rule, and two-phase consistency with a
   database HMS does not own is unsafe.
2. **One-time migration, then switch everything:** one large, high-risk cutover for the whole hospital; departments
   move at different speeds.
3. **Bridge writes to a separate staging copy instead of the canonical tables:** two shapes of the same patient,
   every reader must merge them, and the copy is never the record. Rejected in favour of one canonical record with
   origin and provenance.
4. **Last-writer-wins between layers:** silently loses either a Khanza edit or an HMS correction; unacceptable for
   clinical records.
5. **Authority enforced only in Go:** any other writer (a script, a future service) could bypass it. The database is
   the last line, as for tenancy and history (ADR-DB-005).

## Consequences
- Positive: no record has two writers at a time; cutover is per domain and reversible until committed; every bridged
  value is traceable to its Khanza key, mapping version and run; the native layer cannot reach Khanza and the bridge
  cannot reach users (tested on the import graph and in the database).
- Negative: a domain cannot be partly native and partly legacy within one organization; cross-domain references
  (a native observation on a bridged encounter) are allowed and expected; per-facility cutover inside one
  organization is not possible in this version.
- Operational: a second deployable worker with its own credentials and a SELECT-only Khanza account; batch size,
  pause and pass interval bound the load on Khanza; stewards need a place to work bridge issues (API later).
- Compatibility: additive. Every canonical write now needs a `domain_authority` row; none existed before (no
  environment holds clinical records yet). clinical-read-v1 is unchanged.
- Security/privacy: the bridge login has only the canonical record groups and its own state; no IAM, privacy,
  outbound or read-model rights. Bridge issues and logs carry keys and reason codes, never values. A second copy of
  Khanza patient data now exists in PostgreSQL, under the same RLS, history and audit controls as native data.
- Patient-safety: no silent overwrite in either direction; NIK duplicates in Khanza are dropped with an issue rather
  than merging patients; nothing is inferred from empty or placeholder legacy values.

## Ownership impact
- hms_database: `integration.record_domains`, `record_domain_tables`, `domain_authority`, `bridge_issues`, the layer
  guard, `record_origin`, the bridge login and grants (ADR-DB-006).
- hms_services: `canonical/` (store and transaction context), `native/` (commands and APIs), `legacybridge/` (scan,
  mapping, sync) and `integrations/legacyhms` (SELECT-only statements). ADR-SVC-010 records the first slice.
- Root/deployment: the bridge worker service and its secret.

## Migration and rollout
1. Merge with ADR-DB-004/005. Re-run the bootstrap (new role and login), then migrate to 0021.
2. Per organization, the owner inserts the initial authority (normally `legacy` for every domain of a hospital that
   runs Khanza) through the RUNBOOK procedure. Without a row, no layer can write that domain.
3. Start the bridge for patients in `legacy` mode against a development Khanza copy; review issue counts.
4. Next slices: encounters (`reg_periksa`), then vital signs and diagnoses, each with its mapping, tests and owner
   review of the legacy field semantics. Retire the read-through per domain when its bridge has completed a pass.

## Acceptance criteria
- [x] Database refuses a writer without the domain's authority, in every state (tests 120, mutation-checked).
- [x] Authority moves only legacy → cutover → native, with a reason, by the owner (tests 120).
- [x] The runtime cannot act as the bridge and the bridge cannot write native-only tables (tests 010, 020, 120).
- [x] Native layer and bridge cannot import each other; neither reaches the other's dependencies (Go `archtest`).
- [x] Patient slice end to end against PostgreSQL: bridge creates, updates, rejects, resolves and reports after
      cutover; native registration refused before cutover and accepted after (Go integration tests).
- [ ] Owner review of the `pasien` mapping rules with the medical-records unit.
- [ ] Bridge run against a development copy of Khanza (counts only reported).
- [ ] Production deployment review of the bridge worker (secrets, TLS, monitoring of `sync_runs` and issues).

## Open decisions (owner)
1. **Native MRN allocation:** format and sequence of MRNs HMS issues after the patient cutover, so they never collide
   with Khanza's. Until decided, native registration takes no MRN.
2. **Per-facility cutover** for encounter-scoped domains in multi-facility organizations.
3. **Deletions in Khanza:** `pasien` has no tombstones; whether a periodic key reconciliation should report rows that
   disappeared.
4. **Stewardship:** who works bridge issues, and the API/screen for it.
5. **Events:** whether bridged changes publish `legacy.*.observed` outbox events for read models in this phase.
