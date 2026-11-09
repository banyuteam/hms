# Legacy query catalog: BPJS bridging

Read-only statements hms_services runs against the legacy HMS for BPJS data (ADR-SVC-007). The SQL source of truth is
`hms_services/integrations/legacyhms/bpjs.go`; its allowlist test fails if a statement changes shape or reads a
column listed as never read in [`../field-mapping/bpjs-bridging.md`](../field-mapping/bpjs-bridging.md).

Every statement runs in a read-only session with the legacy statement timeout (`LEGACY_DB_TIMEOUT_SECONDS`).

| Name | Used by | Statement (shape) | Index | Cap | Output |
|---|---|---|---|---|---|
| `sep` | every visit timeline read (`GET /encounters/{number}/timeline`, `summary.sep`) and so claim readiness v3 | `SELECT no_sep, tglsep, jnspelayanan, klsrawat, no_rujukan, nmppkrujukan, diagawal, nmdiagnosaawal, nmpolitujuan, nmdpdjp, tglpulang, cob, suplesi, no_sep_suplesi FROM bridging_sep WHERE no_rawat = ? ORDER BY tglsep, no_sep LIMIT ?` | `no_rawat` | 20 (reads 21 to detect more; `sep` in `truncated`) | timeline: these columns (SEP number in full, B-1); assistant: findings only |
| `sep_sample` | `check-clinical-read` only | `SELECT no_rawat FROM bridging_sep WHERE no_rawat IS NOT NULL ORDER BY tglsep DESC LIMIT ?` | none (sorts the table; check only, 25 rows) | 25 | counts printed, no numbers |

Schema inventory (metadata only, `inventory-legacy-schema`): `information_schema.TABLES`, `COLUMNS`, `STATISTICS`,
`KEY_COLUMN_USAGE` filtered by `TABLE_SCHEMA = DATABASE()` and a `LIKE` pattern. It reads no table rows.

Verified on the dev server (2026-11-09): `check-clinical-read` ran `sep` for 25 recent SEP visits (34 rows, service
types `1`×10 and `2`×24) and for 25 recent registrations (none had an SEP yet).
