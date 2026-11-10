# Standards Traceability (clinical record)

This file maps each requirement to the database control that meets it and the test that proves it.
- **Interpretations and sources:** `standards/healthcare/clinical-data-standards.md`.
- **Design:** ADR-DB-004, ADR-DB-005 and, for the native/legacy layers, ADR-ROOT-002 and ADR-DB-006.
- **Status:** "Runtime" means hms_services must enforce it, and "Ops" means it is a deployment or operations control.

| Requirement | Control | Where | Test / status |
|---|---|---|---|
| Permenkes 24/2022 Pasal 14(2): MRN, name, NIK | Identifier systems with format, placeholder exclusion and uniqueness | `terminology.identifier_systems`, `patient.identifiers`, `patient.names` | `090` NIK format, placeholder, uniqueness |
| Pasal 14(4): religion, occupation, education, marital status | Coded columns bound to governed value sets | `patient.patients`, `terminology.value_sets`, `element_bindings` | Value sets to be loaded from Kepmenkes 1423 (owner) |
| Pasal 16(2): name, time, signature per entry | Practitioner columns; actor and time in history; signature metadata | `resource_versions`, `clinical.signatures` | `090`/`100` attribution, signer = practitioner's user |
| Pasal 29-30: only authorised changes; corrections traceable | Actor required; fixed columns; reasons for finalized records; no deletes | `hms_meta.version_row`, `capture_version`, `refuse_change` | `090`, `100`, `020` governance |
| Pasal 30(5)-(7): 2x24h window, later approval | Correction workflow | Runtime | Open (hms_services) |
| Pasal 20(4)-(5): backup off-site, periodic | PITR plus off-site copy, restore drills | Ops (RUNBOOK) | Open (production target) |
| Pasal 22(1): in-country storage if outsourced | Hosting decision | Ops | Open (owner) |
| Pasal 21: interoperability with the Kemenkes platform | Submission queue, external ids, profiles, validation results | `integration.*`, `knowledge.fhir_profiles` | `110` idempotency, external id uniqueness |
| Pasal 35(2): disclosure without consent is de-identified | Pseudonymized analytics; disclosure accounting with `de_identified` | `analytics.*`, `privacy.disclosures` | `020` no identifying columns, `110` |
| Pasal 39: retention ≥ 25 years | No DELETE/TRUNCATE on records and history | record tables, `resource_versions` | `020`, `090`; retention execution open |
| Kepmenkes 1423: NIK 16 digits, 9999… = none | `value_pattern`, `excluded_values` | `terminology.identifier_systems` | `080`, `090` |
| Kepmenkes 1423: newborn by mother's NIK | `nik-ibu`, not unique | seed in 0007 | `090` siblings share |
| Kepmenkes 1423: Kemendagri address codes, RT/RW | Address code columns | `patient.addresses` | `090` |
| Kepmenkes 1423: general consent | Consent per encounter | `patient.consents.encounter_id` | `090` consent rules |
| UU 27/2022 Pasal 4: health = specific data | Restricted classification, RLS, reader isolation | all record schemas | `020` |
| UU 27/2022 Pasal 14, 41, 43-44: recorded requests, deadlines, deletion per law | Versioned requests with due date and decision | `privacy.data_subject_requests` | `110` |
| UU 27/2022 Pasal 34: DPIA | DPIA reference required for active specific-data processing | `privacy.processing_activities` | `110` |
| UU 27/2022 Pasal 46: breach notice 3x24h | Incident process, scoping from audit/disclosures | Workstream 3 | Open |
| Tenant isolation (root §6) | Row-level security `tenant_isolation`, fail closed | every tenant table | `020`, `090` |
| Legacy read-only, separate identities (root §7, §14) | Legacy bridge login and marker role; bridge-only state; layer guard and domain authority (one writer per domain); per-organization crosswalk | `integration.domain_authority`, `hms_meta.guard_record_layer`, `integration.legacy_record_links`, `bridge_issues` | `010`, `020`, `060`, `110`, `120` |
| Pasal 29-30 across systems: no silent overwrite | Legacy changes after cutover reported, not applied; mapped rows keep key and mapping version | `integration.bridge_issues` (`not_applied`), `legacy_record_links.mapping_version` | `120`; Go `TestPGBridgeMapsLegacyPatientsUntilCutover` |
| Patient safety: no cross-patient references | Composite `(id, patient_id)` keys; entry trigger | `clinical.*`, `imaging.*` | `100` |
| FHIR R4 invariants (con-3/4/5, ait-1/2, obs-6) | CHECK constraints | `clinical.conditions`, `allergy_intolerances`, `observations` | `100` |
| Terminology provenance | Releases with checksum, licence, approval, immutable | `terminology.*` | `080` |
| openEHR template conformance | Content only with an active template; bindings fixed when active | `clinical.compositions`, `knowledge.*` | `080`, `100` |
| DICOM references | UID format, same-patient report/study | `imaging.*` | `100` |
| Audit tamper evidence | Hash chain + external anchors verified on insert | `audit.chain_anchors` | `110` |
| Longitudinal record / CRM | Rebuildable projections, newer-version-wins | `readmodel.*` | `110` |
