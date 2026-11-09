# Schema `knowledge`

- Migration: `0014_knowledge_models_and_profiles.sql` (ADR-DB-004)
- Writer: `hms_services` knowledge governance (`hms_terminology_rw`)
- Readers: clinical and interoperability modules; reporting
- Classification: internal (no PHI)

The governed clinical models and conformance artifacts. The artifacts themselves (ADL, OPT, StructureDefinition JSON)
live in source control or object storage. These tables hold identity, version, SHA-256, source, lifecycle and
approval. The lifecycle is draft → approved/active → retired (or rejected), and non-draft rows only change status
(`terminology.guard_lifecycle`).

## Tables
- `archetypes`: openEHR archetypes by id (`openEHR-EHR-OBSERVATION.blood_pressure.v2`) and semantic version.
  `source_lifecycle` is the status at the source (e.g. CKM published); `status` is local adoption.
- `templates`: openEHR operational templates with RM release (e.g. `1.1.0`). Compositions with structured content
  reference an active template.
- `template_archetypes`: archetypes a template uses.
- `template_bindings`: the semantic interoperability map. It takes a template path to:
  - `cdm_target` (`schema.table.column`);
  - `fhir_path` (plus profile);
  - a terminology concept and UCUM unit.

  Fixed once the template is active.
- `fhir_profiles`: FHIR StructureDefinitions (e.g. SATUSEHAT
  `https://fhir.kemkes.go.id/r4/StructureDefinition/Patient`) with FHIR version. They are referenced by
  `integration.outbound_submissions` and `integration.validation_results`.
