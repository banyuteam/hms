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
| `<schema>.resource_versions` | 0006 helper | one version of one record | (`resource_type`, `resource_id`, `version`) | in `workforce`, `patient`, `clinical`, `imaging`, `privacy`; append-only snapshot + actor + reason (ADR-DB-005) |
| `terminology.code_systems` | 0007 | one code system | `id`, `uri` unique | coded columns reference `uri` |
| `terminology.code_system_releases` | 0007 | one imported release | `id`, (`code_system_id`, `version`) | source, SHA-256, licence, approval; immutable once approved |
| `terminology.concepts` | 0007 | one code in a release | (`release_id`, `code`) | loadable only while draft |
| `terminology.value_sets` / `value_set_members` | 0007 | value set version / member | `id`; (`value_set_id`, `system_uri`, `code`) | e.g. Kepmenkes 1423 code lists |
| `terminology.element_bindings` | 0007 | value set bound to an element | `id`; one open binding per element | FHIR binding strength |
| `terminology.concept_maps` / `concept_map_elements` | 0007 | map version / correspondence | `id` | FHIR R4 equivalence |
| `terminology.identifier_systems` | 0007 | one identifier namespace | `id`, `uri` unique | format, excluded placeholders, uniqueness, sensitivity |
| `platform.locations` | 0008 | one physical place | `id`, (`facility_id`, `code`) | FHIR Location; hierarchy within a facility |
| `workforce.practitioners` | 0009 | one practitioner | `id` | optional link to `iam.users` (one per user) |
| `workforce.practitioner_identifiers` | 0009 | one identifier | `id`; active unique values per organization | NIK, STR, SIP, SATUSEHAT id |
| `workforce.practitioner_roles` | 0009 | role at a facility for a period | `id` | specialty, licence identifier |
| `patient.patients` | 0010 | one patient of an organization | `id` (UUIDv7) | master patient index; Kepmenkes 1423 coded demographics |
| `patient.identifiers` | 0010 | one identifier | `id`; active unique values per organization | NIK, NIK ibu, MRN, passport, KK, BPJS, legacy |
| `patient.names` / `telecoms` / `addresses` / `contacts` | 0010 | one part | `id` | addresses with Kemendagri codes, RT/RW |
| `patient.links` | 0010 | link between two patients | `id` | duplicate resolution (`replaced-by`) |
| `patient.consents` | 0010 | one consent decision | `id` | FHIR Consent; optional encounter (0011) |
| `clinical.encounters` (+ `encounter_status_history`, `_participants`, `_locations`, `_diagnoses`) | 0011 | one encounter / part | `id` | FHIR Encounter; v3 ActEncounterCode class |
| `clinical.conditions` | 0011 | one condition | `id` | problem list or encounter diagnosis; con-3/4/5 |
| `clinical.allergy_intolerances` / `allergy_reactions` | 0011 | allergy / reaction | `id` | ait-1/2 |
| `clinical.observations` / `observation_components` | 0012 | observation / component | `id` | one value[x]; obs-6; panels via parent |
| `clinical.procedures` / `procedure_performers` | 0012 | procedure / performer | `id` | FHIR EventStatus |
| `clinical.diagnostic_reports` / `diagnostic_report_results` | 0012 | report / reported observation | `id` | same-patient results; imaging study (0017) |
| `clinical.medications` / `medication_ingredients` | 0013 | medication definition / ingredient | `id` | KFA code or compounded (racikan) |
| `clinical.medication_requests` / `_dispenses` / `_administrations` / `_statements` | 0013 | one event of the medication process | `id` | `dosage_text` always kept |
| `clinical.compositions` (+ `_authors`, `_sections`, `_section_entries`) | 0015 | document / part | `id` | FHIR Composition; optional openEHR content per active template |
| `clinical.composition_attestations` | 0015 | attestation of one version | `id` | append-only; final/amended versions only |
| `clinical.signatures` | 0015 | electronic signature over a version hash | `id` | signature bytes in object storage; no keys |
| `clinical.provenances` (+ `_agents`, `_entities`) | 0015 | provenance of a resource version | `id` | append-only |
| `knowledge.archetypes` / `templates` / `template_archetypes` / `template_bindings` | 0014 | openEHR artifact / binding | `id` | semantic map path -> column / FHIR / concept |
| `knowledge.fhir_profiles` | 0014 | one profile version | `id`, (`canonical_url`, `version`) | e.g. SATUSEHAT R4 profiles |
| `integration.external_systems` | 0016 | one external system | `code` | `legacy-hms`, `satusehat`, `pacs` |
| `integration.legacy_record_links` | 0016, 0021 | legacy row -> canonical record | `id`; active unique legacy key per organization | bridge-only; `mapping_version`; Khanza never written |
| `integration.external_resource_ids` | 0016 | external id of a record | `id` | SATUSEHAT resource ids |
| `integration.outbound_submissions` | 0016 | one submission of a version | `id`, `submission_id`, idempotency key | payload hash only |
| `integration.validation_results` | 0016 | one profile validation | `id` | append-only; no values |
| `integration.record_domains` | 0021 | one record domain (unit of cutover) | `code` | 16 domains, e.g. `patient`, `encounter` |
| `integration.record_domain_tables` | 0021 | one canonical record table | `table_name` | child tables in their parent's domain |
| `integration.domain_authority` | 0021 | authority of a domain for an organization | `id`; (`organization_id`, `domain`) | `legacy`/`cutover`/`native`; versioned; owner-only |
| `integration.bridge_issues` | 0021 | one problem with a legacy row | `id`; one open per key, reason, field | keys and reason codes only |
| `imaging.studies` / `series` | 0017 | DICOM study / series | `id`; UIDs unique per organization | images stay in PACS |
| `readmodel.clinical_timeline` | 0018 | latest version of one resource | (`resource_type`, `resource_id`) | derived, rebuildable |
| `readmodel.patient_summaries` | 0018 | one patient banner | `patient_id` | derived, rebuildable |
| `readmodel.projection_checkpoints` | 0018 | one projection | `projection_name` | no PHI |
| `privacy.processing_activities` | 0019 | one processing activity | `code` | DPIA required for active specific data |
| `privacy.disclosures` | 0019 | one disclosure | `id` | append-only |
| `privacy.data_subject_requests` | 0019 | one request | `id` | versioned; decisions with reasons |
| `audit.chain_anchors` | 0019 | one external anchor | `id` | must match the chain on insert |
| `analytics.encounter_facts` / `diagnosis_facts` / `observation_facts` (views) | 0020 | pseudonymized fact | - | pseudonym keys owner-only |
| `catalogue.sources` | 0022 | one external reference source | `id` (UUIDv7) | url | excel | pdf | word | image; type fixed; https URL for links only; `version` for edits |
| `catalogue.data_titles` | 0022 | one data title of a source | (`source_id`, `position`) | ordered; deleted with the source |
| `catalogue.files` | 0022 | the stored file of a source | `source_id` | volume key `catalogue/yyyy/mm/<uuid>`, type matches the source, <= 20 MiB, SHA-256; no bytes, no file name |

Details: [platform](../schemas/platform/README.md), [audit](../schemas/audit/README.md),
[eventing](../schemas/eventing/README.md), [integration](../schemas/integration/README.md), [iam](../schemas/iam/README.md),
[terminology](../schemas/terminology/README.md), [workforce](../schemas/workforce/README.md),
[patient](../schemas/patient/README.md), [clinical](../schemas/clinical/README.md),
[knowledge](../schemas/knowledge/README.md), [imaging](../schemas/imaging/README.md),
[readmodel](../schemas/readmodel/README.md), [privacy](../schemas/privacy/README.md),
[analytics](../schemas/analytics/README.md), [catalogue](../schemas/catalogue/README.md). Requirement traceability: [standards-traceability](standards-traceability.md).
