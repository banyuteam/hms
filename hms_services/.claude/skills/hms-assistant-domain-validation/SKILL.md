---
name: hms-assistant-domain-validation
description: Implement authoritative healthcare, insurance claim, catalogue, and workflow validation for the deterministic HMS assistant in Go services.
---

# HMS Assistant — Domain Validation

## Purpose

Implement deterministic domain validation behind `hms_services`. Do not put authoritative domain decisions in React.

## Scope

Potential domains:
- insurance claim completeness
- encounter and invoice consistency
- required document checklist
- workflow-state validation
- catalogue existence and version checks
- approved administrative workflow guidance

Reuse existing domain services and canonical models. Do not create duplicate patient, encounter, billing, claim, finance, or terminology entities.

## Healthcare catalogues

Support integration with approved, licensed, versioned sources for:
- ICD-10
- ICD-9-CM
- INA-CBG
- iDRG

For each catalogue result, preserve applicable source, release/version, effective date, code, display term, and relevant metadata.

Do not:
- invent codes or descriptions
- assume one catalogue release is current
- infer clinical diagnosis from symptoms
- treat keyword matching as definitive coding
- promise reimbursement or tariff outcomes
- treat grouping estimates as insurer adjudication

If catalogue data is unavailable, stale, or not authorized, return an explicit unavailable/needs-review result.

## Claim validation

Separate:
- required-field completeness
- document presence
- internal consistency
- policy/coverage verification
- clinical coding review
- external insurer acceptance

These are different checks and must not be collapsed into a single `valid=true`.

A complete internal checklist does not mean a claim is accepted by an insurer.

## Rule output

Return structured outcomes:
- code
- severity
- safe explanation
- field/resource references
- source/version
- whether human review is required
- allowed next action identifiers

## Clinical safety

The assistant is a support tool. It must not independently diagnose, prescribe, determine medical necessity, finalize a clinical record, or override a licensed professional.

## Testing

Use approved catalogue fixtures and known rule cases. Include effective-date boundaries, invalid codes, retired codes, missing sources, contradictory inputs, facility-specific policies, and human-review escalation.
