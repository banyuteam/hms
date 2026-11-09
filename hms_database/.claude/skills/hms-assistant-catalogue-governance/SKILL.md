---
name: hms-assistant-catalogue-governance
description: Govern versioned healthcare and insurance catalogues used by the deterministic HMS assistant, including ICD-10, ICD-9-CM, INA-CBG, and iDRG.
---

# HMS Assistant — Catalogue Governance

## Purpose

Ensure deterministic assistant rules use approved, traceable, appropriately licensed catalogue/reference data.

## Catalogue classes

Keep distinct:
- ICD-10 diagnosis classification
- ICD-9-CM procedure classification
- INA-CBG grouper and associated reference data
- iDRG grouper and associated reference data

Do not assume their versions, semantics, update schedules, licensing, or effective dates are identical.

## Required provenance

For each imported release, capture as applicable:
- catalogue code
- source authority/provider
- release/version identifier
- publication date
- effective-from and effective-to
- imported-at timestamp
- source artifact checksum
- licence/usage constraints
- import process/version
- validation status
- approval status

## Import lifecycle

```text
Source acquired
  -> checksum and provenance recorded
  -> format/schema validation
  -> code/reference validation
  -> duplicate and integrity checks
  -> comparison with prior release
  -> review and approval
  -> activate for applicable scope/date
  -> monitor and retain prior release
```

Never overwrite a prior release in place.

## Data quality

Check:
- duplicate codes
- missing required descriptions
- invalid parent/child references
- invalid effective periods
- unexpected row-count changes
- encoding and normalization
- incompatible release format
- checksum mismatch

## Runtime behavior

Services should request a specific approved release or resolve an approved release based on effective date and facility policy. Results should include provenance.

If a code is retired, unavailable, or outside its effective period, return a clear status rather than silently mapping it to another code.

## Licensing and regulatory caution

Use only data sources the hospital is authorized to use. Do not scrape restricted catalogues or redistribute licensed data without permission. Confirm applicable Indonesian standards and release versions with the responsible official source and hospital governance.

## Testing

Maintain fixtures for known codes and release transitions. Test retired codes, effective-date boundaries, missing descriptions, malformed imports, duplicate records, and rollback to a prior approved release.
