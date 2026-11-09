# Schema `terminology`

- Migration: `0007_terminology.sql` ([ADR-DB-004](../../documentation/adr/ADR-DB-004-clinical-data-foundation.md))
- Writer: `hms_services` terminology import/governance (`hms_terminology_rw`)
- Readers: every clinical module; reporting (`hms_report_read`)
- Classification: internal (reference data, no PHI)

## Tables
- `code_systems`: registry of code systems by canonical URI (`scope` international/national/local/legacy). Every
  coded clinical column references `uri`, so a code always names its system even when no content is loaded. Seeded:
  - LOINC, SNOMED CT, ICD-10, ICD-9-CM, UCUM, DICOM DCM, ISO 3166 and BCP 47;
  - the HL7 code systems used by the schema;
  - KFA (`http://sys-ids.kemkes.go.id/kfa`).
- `code_system_releases`: one imported release with source, SHA-256 of the artifact, licence terms, tool version,
  effective dates and approval. Lifecycle is draft → approved → retired, or draft → rejected (`guard_lifecycle`).
- `concepts`: codes of a release; loadable only while the release is draft (`guard_release_content`).
- `value_sets`, `value_set_members`: versioned allowed-code lists, e.g. the Kepmenkes 1423 identity code lists.
  Members are fixed once the value set is active.
- `element_bindings`: which value set governs an element (`Patient.religion`), with strength and effective period.
  hms_services validates writes against the binding in force.
- `concept_maps`, `concept_map_elements`: versioned maps between systems (legacy → ICD-10, ICD-10 → SNOMED CT),
  using FHIR R4 equivalence; `unmatched` has no target.
- `identifier_systems`: identifier namespaces with `applies_to`, `kind`, `value_pattern`, `excluded_values`,
  `unique_value` and `sensitivity`. `terminology.check_identifier()` enforces them on patient and practitioner
  identifiers. Seeded (verified in the SATUSEHAT docs and Kepmenkes 1423):
  - NIK (16 digits, `9999999999999999` excluded, unique);
  - NIK ibu (not unique);
  - paspor;
  - KK.

## Loading a national code list
1. Register the code system (`scope` national) if needed.
2. Create a draft release with the source reference and SHA-256 of the official file.
3. Load the concepts, then create a draft value set and its members.
4. Review the content, then approve: `status`, `approved_at` and `approved_by_user_id` are set together.
5. Bind the element (`element_bindings`).

Never edit approved content; publish a new release or value set version instead.

## Not decided yet
- The IHS-number identifier URI, and the organization-specific SATUSEHAT systems (MRN, encounter, location).
- SNOMED CT licensing.
- Which ICD editions are in national use.
