# ADR-0004: PostgreSQL 18 for the new services' databases

- Status: proposed
- Date: 2026-10-29
- Deciders: Product owner (user)

## Context
`source/hms_database/` holds the schemas and migrations of the domain microservices (database-per-service)
and the ICD-10 / ICD-9-CM catalogue. The product owner named PostgreSQL 18 on 2026-10-29. Khanza itself stays on MariaDB.

## Options considered
| Option | Notes |
|---|---|
| **PostgreSQL 18 (named by product owner)** | Mature, strong JSON/full-text, row-level security for PHI; newest major version, so plan the upgrade/support window. |
| MariaDB | Same engine as Khanza; less separation from the legacy system. |

## Decision
_Proposed:_ PostgreSQL 18, one database/schema per service, plus a shared read-only catalogue schema.
Migration tool and the data-warehouse engine are not decided here.

## Consequences (incl. PHI / compliance impact)
- Use row-level security / column encryption for PHI (NIK, BPJS number) where the PRD requires.
- Different engine from Khanza: the translators in `event-streaming` own type/charset mapping.
- Hosting (on-premise vs cloud) is a hospital decision; no PHI to external services without an ADR.
