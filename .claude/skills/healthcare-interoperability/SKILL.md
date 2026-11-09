---
name: healthcare-interoperability
description: >
  Guides HL7 FHIR, SATUSEHAT, DICOM and terminology integration at explicit healthcare interoperability boundaries.
---


# Healthcare Interoperability

Keep external standards at explicit integration boundaries; do not force external resource shapes into the internal canonical model. Maintain versioned mappings, terminology and conformance tests. Verify current SATUSEHAT profiles and legal requirements before implementation. Keep DICOM/PACS metadata and imaging binaries in appropriate imaging infrastructure.

Workflow: identify external profile/version; establish ownership; map identifiers, terminology and cardinality; define validation/security/retry/reconciliation; build conformance tests; document mapping version and provenance.

Do not treat FHIR resources as ordinary database tables or hardcode terminology without version governance.
