# ADR-DB-004: Native clinical data foundation, separate from the legacy Khanza database

- Status: Proposed (requested by the owner 2026-11-09; clinical content and code lists need clinical-governance
  review before production, see Open questions)
- Date: 2026-11-09
- Owners: hms_database (schemas, migrations, tests); hms_services (runtime writes, authorization, exchange)
- Affected projects: hms_database (owner), hms_services (all clinical writes and reads, SATUSEHAT exchange, legacy
  import, projections), hms_workspace (consumes hms_services APIs only; no change now)
- Related: root `CLAUDE.md` §5-9, §14-16; ADR-DB-002 (roles), ADR-DB-003 (IAM); ADR-DB-005 (record integrity and
  transaction context); ADR-SVC-003 (Khanza read-through, unchanged until a cutover ADR);
  `standards/healthcare/clinical-data-standards.md`; `documentation/standards-traceability.md`

## Context
HMS reads patients and encounters through from the legacy Khanza MySQL on every request (ADR-SVC-003). It does not
store any clinical data of its own. The owner asked for a native foundation that:

- follows Permenkes 24/2022 (Rekam Medis), Kepmenkes HK.01.07/MENKES/1423/2022 (RME variables and metadata), UU 27/2022
  (Pelindungan Data Pribadi), and patient identity, audit and security requirements;
- models Patient, Encounter, Condition, Observation, Medication, Procedure, Composition and clinical history;
- supports HL7 FHIR R4, SATUSEHAT profiles, terminology mapping and API conformance;
- supports openEHR archetypes, longitudinal records, clinical read models and semantic interoperability;
- supports PACS/DICOM, clinical analytics, disaster recovery, security governance and advanced audit;
- stays separate from Khanza and reuses the IAM foundation (ADR-DB-003) for authentication and authorization.

The regulatory facts used here were checked against the primary texts. They are recorded with article numbers in
`standards/healthcare/clinical-data-standards.md`.

## Decision
1. **Separate native record.** New schemas in the existing HMS PostgreSQL 18 database hold the canonical clinical
   record:
   - The schemas are `terminology`, `workforce`, `patient`, `clinical`, `knowledge`, `imaging`, `readmodel`, `privacy`
     and `analytics`.
   - `platform.locations` is added to the platform schema.
   - `integration` and `audit` are extended.
   - No table mirrors a Khanza table, and no foreign key or column depends on Khanza structure.
   - Khanza rows are linked only through `integration.legacy_record_links`, which maps (source system, entity, key) to
     a canonical record.
   - Khanza remains read-only. The legacy import that fills the native record is an hms_services adapter decision
     (future ADR).
2. **FHIR R4 as the canonical shape, not a FHIR server.**
   - Tables are relational, one per FHIR resource or backbone element.
   - Status columns use the FHIR R4 required value sets as CHECK constraints, and FHIR invariants are enforced where
     they are row-local (con-3/4/5, ait-1/2, obs-6).
   - Coded values are `(system, code, display)` triplets. Their system must be registered in
     `terminology.code_systems`, even when the system's content (e.g. SNOMED CT) is not loaded.
   - Resources: Patient, Practitioner, PractitionerRole, Location, Encounter, Condition, AllergyIntolerance,
     Observation, Procedure, DiagnosticReport, Medication, MedicationRequest, MedicationDispense,
     MedicationAdministration, MedicationStatement, Composition, Consent, Provenance and ImagingStudy.
3. **Identity.**
   - **Patients:** one `patient.patients` row per person per organization (the master patient index).
   - **Patient identifiers:** NIK, NIK ibu, passport, KK, IHS number, MRN, BPJS number and legacy keys. Each is
     validated against `terminology.identifier_systems`, which holds the format, the excluded placeholder values
     (NIK `9999999999999999`, Kepmenkes 1423) and a uniqueness rule.
   - **Duplicates** are resolved by `patient.links` (replaced-by), never by moving or deleting rows.
   - **Practitioners** (`workforce`) are the clinical identity. They are linked to `iam.users`, the sign-in identity,
     but are never inferred from the session.
4. **Terminology and knowledge are governed artifacts.**
   - Code system releases, value sets, concept maps, openEHR archetypes/templates and FHIR profiles carry source,
     checksum, licence and approval.
   - They become immutable once approved or active; a correction is a new version.
   - National code lists (Kepmenkes 1423 religion, education, occupation, marital status, sex) are loaded as
     releases from the official text with checksum. Migrations do not hard-code them.
5. **openEHR alongside FHIR (two-level modelling).**
   - A composition may carry structured content conforming to an *active* `knowledge.templates` version.
   - `knowledge.template_bindings` maps template paths to canonical columns, FHIR elements and terminology concepts.
     This is the semantic-interoperability map used to project structured documents into the clinical tables and
     into FHIR.
   - HMS does not run an openEHR server. AQL and EHR-level versioning are not provided.
6. **Interoperability state** (`integration`):
   - external systems registry: `legacy-hms` (Khanza), `satusehat`, `pacs`;
   - SATUSEHAT resource ids;
   - an outbound submission queue with idempotency keys. It stores the payload hash only, because the payload is
     regenerated from the exact resource version;
   - FHIR profile validation results per resource version.
   - Endpoints and credentials stay in deployment configuration and the secret manager.
7. **Imaging.**
   - `imaging.studies` and `imaging.series` hold DICOM Study/Series Instance UIDs, the accession number, modalities
     and counts.
   - Pixel data and instances stay in PACS and are retrieved through hms_services (DICOMweb).
   - Radiology reports are `clinical.diagnostic_reports` linked to the same patient's study.
8. **Longitudinal record and read models.**
   - The longitudinal record is the patient's versioned resources across encounters and facilities of the
     organization.
   - `readmodel.clinical_timeline` and `readmodel.patient_summaries` are rebuildable projections fed from the outbox
     by idempotent consumers. A consumer applies a version only if it is newer.
9. **Privacy and advanced audit.**
   - `privacy.processing_activities` is the processing register. A DPIA reference is required for active
     specific-data processing.
   - `privacy.disclosures` is append-only disclosure accounting.
   - `privacy.data_subject_requests` is versioned and records deadlines and decisions.
   - `audit.chain_anchors` holds external anchors of the audit hash chain, checked on insert and by
     `audit.verify_anchors()`.
   - Read access stays in `audit.audit_events` (written by hms_services).
10. **Analytics.**
    - `analytics` views expose random pseudonyms per patient and encounter, age in years, gender, coded facts and
      local dates. They never expose names, identifiers, contact data, addresses, free text or internal ids.
    - They run with owner rights, so reporting needs no access to identifiable tables. Pseudonym keys are readable
      by the owner only.
11. **Roles** (bootstrap, ADR-DB-002 pattern):
    - New group roles: `hms_terminology_rw`, `hms_workforce_rw`, `hms_patient_rw`, `hms_clinical_rw`,
      `hms_readmodel_rw` and `hms_privacy_rw`. All are granted to `<p>_runtime`.
    - Reporting reads terminology, knowledge and analytics only.
    - Auditors read workforce, privacy, disclosure and anchor data, never clinical content.
12. **Record integrity** (versioning, history, actor attribution, correction rules, no deletes, tenant row-level
    security) is specified in ADR-DB-005.

## Alternatives considered
1. **Mirror Khanza tables in PostgreSQL** (copy then clean up): rejected. It imports Khanza's semantics and keys into
   the canonical model and contradicts the canonical-model governance.
2. **A FHIR server (e.g. HAPI) as the clinical store:**
   - Pros: full FHIR API and search, `_history` for free.
   - Cons: a second runtime and database to operate, JSON-blob storage that relational constraints cannot protect,
     and authorization/audit outside hms_services.
   - Can still be added later as an exchange façade fed from this store.
3. **An openEHR CDR (e.g. EHRbase) as the store:**
   - Pros: native archetype persistence and AQL.
   - Cons: a new runtime, a skills gap, and SATUSEHAT still needs FHIR.
   - Kept possible by `knowledge` bindings.
4. **One generic `resources(jsonb)` table:** rejected. It provides no relational integrity, units or terminology
   binding, and it violates the "no generic EAV for core clinical facts" rule.
5. **One schema per FHIR module or per resource:** more boundaries than owners. `clinical` stays one schema with one
   writer, and is split later only with an ADR.

## Consequences
- **Positive:**
  - A native, attributable, versioned record that does not depend on Khanza.
  - Cross-patient and cross-tenant references are impossible by composite foreign keys and row-level security.
  - FHIR and SATUSEHAT mapping is mostly mechanical.
  - Terminology and template provenance support audit and semantic interoperability.
  - Analytics without identifiable data.
- **Negative:**
  - Many tables (about 60 relations). Every hms_services write must set the transaction context (ADR-DB-005).
  - Two clinical sources exist until cutover: the ADR-SVC-003 Khanza read-through and the native record. The UI must
    not mix them silently.
  - Narrative text is plain text/Markdown, not FHIR XHTML.
- **Operational:**
  - Re-run the bootstrap before migrations 0006-0020.
  - History roughly doubles write volume for record tables.
  - 25-year retention means partitioning and archive of `resource_versions` will be needed. This is not built yet.
- **Compatibility:**
  - Additive; existing schemas unchanged except new constraints/columns on `platform`, `integration` and `audit`
    objects added by these migrations.
  - The reverted 0006/0007 (assistant) numbers are reused: databases that ran them must be recreated, as the revert
    commit states.
- **Security/privacy:**
  - Patient and clinical tables are restricted, with tenant row-level security failing closed.
  - Identifiers and contact data are stored in clear text, protected by access control only. Column encryption is
    an open question.
  - Analytics is pseudonymized, not anonymized.
- **Patient safety:**
  - The schema refuses known-invalid states but does not validate clinical correctness.
  - Value sets, templates, role catalogs and the legacy-to-canonical mapping need clinical sign-off.
  - No clinical fact is inferred by the database.

## Ownership impact
- **hms_database** owns all DDL, tests and the data dictionary.
- **hms_services** owns:
  - the transaction context;
  - authorization (`iam.effective_permissions`), and permissions such as `clinical.observation.write`, which are
    registered by hms_services;
  - validation against value sets and templates;
  - FHIR and SATUSEHAT mapping and exchange;
  - the legacy import;
  - projections and pseudonymized exports;
  - audit events for reads.
- **hms_workspace** consumes versioned hms_services APIs and never connects to PostgreSQL.

## Migration and rollout
- Migrations 0006-0020 are additive and online-safe on empty schemas. Rollback is fix-forward. On a development
  database: drop and recreate (RUNBOOK).
- Sequence:
  1. Bootstrap re-run.
  2. Migrate.
  3. hms_services adds the transaction context and the first vertical slice (patient registration + encounter +
     vital signs, write and read, audited) behind a feature flag.
  4. Legacy import ADR (Khanza → native, with `legacy_record_links`, provenance `source` entities and reconciliation
     counts).
  5. SATUSEHAT submission ADR.
  6. Cutover ADR replacing the ADR-SVC-003 read-through per resource.
- Monitoring:
  - submission backlog (`outbound_submissions` due);
  - projection lag (`projection_checkpoints`);
  - history growth;
  - `audit.verify_anchors()`.

## Acceptance criteria
- [x] Migrations 0006-0020 apply on a fresh PostgreSQL 18.6 cluster after the bootstrap; all 12 test files pass.
- [x] Governance tests:
  - tenant RLS on every tenant table;
  - no runtime DELETE on record tables;
  - every versioned table has its triggers;
  - history is not writable by the runtime;
  - reporting and auditor cannot read identifiable or clinical tables;
  - analytics views have no identifying columns.
  - The rules were mutation-checked.
- [x] Behaviour tests:
  - FHIR invariants;
  - same-patient references;
  - identifier formats/uniqueness/placeholder;
  - finalized-record reasons;
  - entered-in-error;
  - attestation/signature binding;
  - provenance append-only;
  - legacy link/submission idempotency;
  - DSR decisions;
  - anchors;
  - pseudonymized analytics.
- [ ] Clinical governance approves code lists, templates and the minimum data set per Kepmenkes 1423 (owner).
- [ ] DPO approves the processing register, legal bases and DPIA references (owner).
- [ ] hms_services implements the transaction context and the first vertical slice against this schema.
- [ ] Production backup/PITR and off-site copy per Permenkes 24/2022 Pasal 20 (RUNBOOK) verified on the real target.

## Open questions
1. Column-level encryption of NIK, phone and address (application-level envelope encryption with a KMS and a blind
   index for lookup) versus access control only.
2. IHS-number identifier URI: the SATUSEHAT docs show both `.../id/ihs-number` and `.../id/patient-ihs-number`. It
   is not seeded until confirmed. Organization-specific systems (MRN, encounter, location) are also not seeded.
3. Break-glass access, care-relationship scope and department scope (ADR-DB-003 open items) for clinical reads.
4. Departments (FHIR Organization sub-units) for SATUSEHAT, and orders (ServiceRequest) and specimens for lab and
   radiology.
5. Retention execution after 25 years (Permenkes 24/2022 Pasal 39) and partitioning of history tables.
6. Whether general consent per encounter (Kepmenkes 1423 section III) is mandatory per admission or per visit.
