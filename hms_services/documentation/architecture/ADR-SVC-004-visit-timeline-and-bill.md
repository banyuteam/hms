# ADR-SVC-004: Visit timeline and saved bill (read-through)

- Status: Proposed (owner decisions 2026-11-08 recorded in Decision 1–3)
- Date: 2026-11-08
- Owners: hms_services
- Affected projects: hms_services (owner), hms_workspace/web (consumer)
- Related: ADR-SVC-003 (clinical read), `contracts/api/clinical-timeline-v1.openapi.yaml`, Khanza schema snapshot
  (schema catalogue of the dev legacy server, schema rsb221022021, read 2026-11-06)

## Context
The web Records, Encounter and Diagnostics windows and the lab, radiology, prescription and bill viewers need the
visit timeline the previous implementation served as a "journey" document. Its sections, joins, row caps and time keys were
proven against the dev Khanza; the web only reads part of each section (survey 2026-11-08).

## Decision
1. **Separate permission for clinical content (owner).** `encounter.clinical.read` is required for the timeline;
   `encounter.read` keeps covering the visit list only.
2. **Scope (owner): every section the screens use.** Registration, room stays, clinical notes (outpatient and
   inpatient), procedures (six legacy tables), laboratory tests with result lines, radiology exams and reports,
   prescriptions with items and compounds, medication given with dose instructions, surgeries and surgery reports;
   summary: payer, diagnoses (ICD-10), coded procedures (ICD-9-CM), attending doctors, inpatient discharge summary.
   SEP (`bridging_sep`) is not included (the web already handles "not sent"). *Amended 2026-11-09 (ADR-SVC-007
   Decision 5): clinical-timeline-v1 1.3.0 adds `summary.sep`, the SEP number in full.*
3. **Bill included now (owner), with its own permission `billing.read`.** *Amended 2026-11-08 (owner): the bill no
   longer reads the cashier's `billing` table.* The charges are aggregated from the tables where the legacy HMS
   records each service with its cost, as its billing screen collects them at discharge: `kamar_inap` (ttl_biaya),
   `rawat_jl_dr/pr/drpr` and `rawat_inap_dr/pr/drpr` (biaya_rawat), `operasi` (sum of the fee columns),
   `detail_pemberian_obat` (total; embalase + tuslah shown as additional), `periksa_lab` (biaya) with the priced items
   of `detail_periksa_lab` (biaya_item), `periksa_radiologi` (biaya). Lines are grouped per service and unit price;
   subtotals and the total are exact cent sums. Amounts are decimal strings (IDR, 2 decimals), summed as
   DECIMAL(18,2) in SQL. The cashier's saved header (`nota_jalan`/`nota_inap`), payments (`detail_nota_*`) and
   receivable (`piutang_pasien`) are still returned as saved, next to the charges.
   Also included (owner, 2026-11-08): registration fee (`reg_periksa.biaya_reg`, when not 0), extra charges
   (`tambahan_biaya`), discounts (`pengurangan_biaya`, negative), take-home drugs (`resep_pulang`, total), drug
   returns (`returpasien`, negative; it has no price, so it is priced at the patient's own charge for that drug,
   batch and invoice in `detail_pemberian_obat`) and the inpatient service fee. The service fee is computed: per row
   of the legacy settings (`set_service_ranap` for self-paying patients, `set_service_ranap_piutang` for insurers and
   BPJS; the legacy HMS has no outpatient settings), its percentage of the subtotals it is switched on for, rounded to
   the cent; a doctor-and-nurse procedure counts under the doctor switch. Assumptions to confirm: the settings table
   per payer, the sign of discounts, the return price.
   Not included: daily/one-time room fees (`biaya_harian`, `biaya_sekali`, both empty in the snapshot) and the
   radiology consumables (owner: not used); visits billed together (`ranap_gabung`) show only their own charges.
   The owner-run `check-bill-sources` command compares each category of the bill, and alternative formulas where the
   legacy one is uncertain, with the saved `billing` per visit (counts only) before the bill is relied on.
4. One fixed, parameterised SELECT per section, filtered by the encounter number through an indexed column, with the
   name lookups (doctor, staff, ward, room, drug, test, ICD) as LEFT JOINs on primary keys (they cannot multiply rows).
   Each section is capped; a capped section is listed in `truncated`, never silently cut.
5. Clinical values (vitals, notes, results, legacy status codes such as `stts_pulang`) are returned as recorded;
   SOAP mapping follows the legacy convention (keluhan = S, pemeriksaan = O, penilaian = A, rtl = P). Lab result lines
   attach to their test by the shared legacy key (encounter, test code, date, time). Times are hospital local time
   with the facility offset; a row without a valid date has `at: null`.
6. Audit: `encounter.timeline.read` and `encounter.bill.read` (data access) with the encounter number; fail closed.

## Consequences
- Positive: the existing windows show the real record, with a narrower permission for clinical content and the bill.
- Negative: ~25 indexed queries per timeline and ~24 per bill on the legacy database; the bill formulas mirror the
  legacy billing screen and must be confirmed per category with `check-bill-sources`.
- Privacy: notes and results are the most sensitive content; only `encounter.clinical.read` holders see them, every
  read is audited. Review the role catalog with clinical governance.

## Web (hms_workspace/web)
`liveEmrApi.getJourney` maps the timeline to the journey the windows already read (`src/api/liveTimeline.ts`): entries
are grouped by their local time as written (`YYYY-MM-DDTHH:MM:SS`, `undated` last) and nothing is filled in. The
billing document (`BillCharges`) asks for the bill only when the session holds `billing.read`. The document itself is
built on the timeline (visit facts, diagnoses), so a cashier needs `encounter.clinical.read` too. A bill-only document
would need its own visit header: follow-up.

## Acceptance criteria
- [x] Statement allowlist (tables, shape, column counts), cap+1 truncation, mapping, permission, audit and fail-closed
      tests; PostgreSQL integration test for both permissions (2026-11-08, scratch cluster).
- [x] `check-clinical-read` extended to the timeline and bill statements (counts only).
- [ ] `check-clinical-read` run by the owner on the dev Khanza.
- [ ] `check-bill-sources` run by the owner; every category's formula confirmed (or corrected) against the saved bills.
- [x] Owner decision on the further categories (2026-11-08: registration, extra charges, discounts, returns,
      take-home drugs and service fee included; radiology consumables not used).
- [ ] Visits billed together (`ranap_gabung`): decide whether the mother's bill shows the baby's charges.
- [ ] Role catalog for `encounter.clinical.read` / `billing.read` reviewed with clinical governance.

**Amendment 2026-11-09:** references to the previous implementation outside this workspace removed; decisions unchanged.
