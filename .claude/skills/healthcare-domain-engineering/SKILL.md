---
name: healthcare-domain-engineering
description: >
  Guides healthcare domain modeling and clinical workflows, including patient, practitioner, encounter, order, result and provenance. Use for clinical semantics and lifecycle design.
---


# Healthcare Domain Engineering

Model clinical meaning rather than legacy table shape. Separate patient identity, practitioner, encounter, order, performed service, observation/result, report and financial account. Preserve provenance, author, verifier, source and amendment history where known. Distinguish draft, preliminary, verified/final, amended, corrected and cancelled states as applicable.

Workflow: identify actor and purpose; define lifecycle and invariants; identify authoritative source; define identifiers and terminology; specify persistence/event implications; validate with domain owners.

Never infer missing clinical facts. A technical event is not clinical approval. Corrections must preserve history. Minimize PHI in asynchronous messages.
