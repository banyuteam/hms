# ADR-SVC-007: BPJS bridging data (read-through), SEP first

- Status: Accepted 2026-11-09 (Decisions 1–6; B-1 and B-4 decided by the owner); B-2 and B-3 wait for the casemix
  team's confirmation
- Date: 2026-11-09
- Owners: hms_services (runtime), hms_database (legacy inventory, field mapping, query catalog)
- Affected projects: hms_services, hms_database, hms_workspace/web (demo answers only)
- Related: ADR-SVC-003, ADR-SVC-004, ADR-SVC-006 (O-7), `contracts/api/assistant-v1.openapi.yaml`,
  `hms_database/legacy/schema-inventory/bpjs-bridging.md`, `hms_database/legacy/field-mapping/bpjs-bridging.md`,
  `hms_database/legacy/query-catalog/bpjs-bridging.md`

## Context
The owner stated (2026-11-09) that the legacy HMS keeps its BPJS data in the tables prefixed `bridging_` (and the
INA-CBG / E-Klaim tables `inacbg_*`), for visits with `reg_periksa.kd_pj = 'BPJ'`, and that the SEP is in
`bridging_sep`. Until now hms_services read none of them: claim readiness v1 reported the SEP as "not connected"
(ADR-SVC-006 O-7) and the visit timeline has no SEP. No column list of these tables existed in the workspace.

## Decision
1. **Inventory before use.** New command `hms-services inventory-legacy-schema` writes a metadata-only inventory
   (information_schema: tables, columns, indexes, foreign keys, approximate rows; no table rows) to
   `hms_database/legacy/schema-inventory/`. Run on the dev server 2026-11-09: 49 tables matching `bridging\_%`,
   `inacbg%`, `%bpjs%`. hms_database records meanings with their evidence in the field mapping.
2. **SEP read.** `legacyhms.SEPSection`: one fixed SELECT on `bridging_sep` by `no_rawat` (indexed, FK to
   `reg_periksa`), oldest first, at most 20 SEPs per visit. It reads only the SEP's own columns; the copy of the
   patient's identity in `bridging_sep` (`nama_pasien`, `tanggal_lahir`, `jkel`, `no_kartu`, `notelep`, `nomr`,
   address and accident-location codes) is never selected (allowlist test).
3. **Claim readiness v2** (ADR-SVC-006 O-7): for BPJS visits `sep_present` is `passed` when the visit has at least one
   SEP in `bridging_sep`, otherwise `failed` (`missing`, severity error). v1 is retired; a request pinned to version 1
   gets `unsupported_rule_set`. If the SEP read fails, the whole evaluation fails (503); it never becomes a result.
   No SEP value leaves the server: the API returns findings only.
4. **Checks.** `check-clinical-read` also runs the SEP statement (recent registrations, plus a sample of 25 recent SEP
   visits, mapped and checked with the SEP rules) and prints counts only.
5. **SEP in the visit timeline (owner decision B-1 = b, 2026-11-09).** `GET /encounters/{number}/timeline` reads the
   SEPs with the timeline and returns them as `summary.sep` (clinical-timeline-v1 1.3.0, additive; `sep` may appear in
   `truncated`). The SEP number is sent **in full** inside the timeline read, which already needs
   `encounter.clinical.read` and is audited; there is no separate reveal. The web shows the number in full (identity
   strip, SEP section, billing document); its browser-side SEP mask is removed.
6. **More SEP checks (owner decision B-4 = yes, 2026-11-09): claim readiness v3.** For BPJS visits, after `sep_present`:
   - `sep_service_type_matches` (warning): at least one SEP has the service type of the visit's care setting
     (`jnspelayanan` `1` inpatient, `2` outpatient). No SEP or care setting unknown → `not_evaluated`; none matching →
     `failed` (`mismatch`), or `not_evaluated` (`section_truncated`) when the SEP list was cut.
   - `sep_discharge_date_recorded` (error): for an inpatient stay, the latest inpatient SEP has its discharge date
     (`tglpulang`). Outpatient → `not_applicable`; no inpatient SEP → `not_evaluated` (`prerequisite_failed`).
   Severities follow O-1 (consistency = warning, a missing item = error). Claim readiness now reads the SEPs from the
   timeline (one read path); versions 1 and 2 are retired. On the dev server (2026-11-09) the 25 most recent SEP visits
   gave: `sep_present` passed 25, `sep_service_type_matches` passed 25, `sep_discharge_date_recorded` failed 10
   (inpatient, most likely still admitted) and not applicable 15.

## Open decisions (owner)
- **B-1** decided: (b), see Decision 5.
- **B-4** decided: yes, see Decision 6.
- **B-2 Which INA-CBG tables are current.** The `2` tables (`inacbg_klaim_baru2`, `inacbg_grouping_stage12`,
  `inacbg_data_terkirim2`) or the unnumbered ones; and what `inacbg_final` / `inacbg_idrg_final` mean (field mapping §1).
- **B-3 Claim progress.** With B-2 confirmed: a read-only "claim progress" for a BPJS visit (claim created in E-Klaim,
  grouped with INA-CBG code and tariff, data sent, final), as new claim-readiness rules or a separate view. Grouper
  output must be labelled as a grouping result, not insurer payment.

## Alternatives considered
1. Hand-write the column list from memory of the Khanza schema: rejected (no evidence; hms_database CLAUDE.md).
2. Read whole `bridging_sep` rows: rejected (patient identity copy; data minimisation).
3. Copy BPJS data into PostgreSQL: not now (same reasoning as ADR-SVC-003 Decision 1).

## Consequences
- Positive: the SEP check is real; the BPJS/INA-CBG schema is documented for the next slices.
- Negative: one more legacy read per claim evaluation (indexed, ≤21 rows).
- Security/privacy: no new endpoint, no new permission. The SEP number now reaches the browser in full (B-1) inside the
  audited timeline read; assistant findings carry no SEP value; the inventory holds no data. The patient-identity copy
  in `bridging_sep` is never read.
- Compatibility: clinical-timeline-v1 1.3.0 is additive (an older web ignores `summary.sep`; the web reads a server
  without it as "SEP not available"). assistant-v1 shape unchanged; `rule_set.version` is now 3 with two more rule ids
  (the web labels them; an unlabelled id is shown as an unknown check).

## Acceptance criteria
- [x] Inventory generated from the dev server and stored in hms_database (metadata only).
- [x] SEP statement allowlisted (table, filter, no identity columns), cap+1 read, tests.
- [x] Claim readiness v2 tests (SEP present / missing / non-BPJS / read failure / no SEP value in the response).
- [x] `check-clinical-read` ran the SEP statement on the dev server (34 SEP rows scanned for 25 visits).
- [x] Timeline 1.3.0 `summary.sep` mapping tests (full number, legacy no-date values as not recorded); web mapping,
      SEP shown in full, older-server fallback.
- [x] Claim readiness v3 tests (no SEP, outpatient, mismatch, cut list, unknown care setting, latest inpatient SEP).
- [ ] Casemix team confirms the field mapping marked "inferred" and decides B-2 and B-3.
