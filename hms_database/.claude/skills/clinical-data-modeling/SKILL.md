---
name: clinical-data-modeling
description: >
  Models clinical records, encounters, observations, orders, medication, reports, amendments and provenance.
---


# Clinical Data Modeling
Preserve patient, encounter, author/practitioner, organization and effective time as appropriate. Distinguish order, performed service, observation/result and report. Model verification lifecycle explicitly. Preserve amendments/corrections; never silently overwrite signed records. Define units, reference ranges, terminology and methods. Separate clinical facts from billing representations. Keep DICOM/PACS references separate from imaging binaries.

Workflow: identify clinical process/actor -> define states/invariants -> provenance/timestamps -> terminology/units -> constraints/query patterns -> audit/correction -> validate with clinicians. Never invent clinical semantics.
