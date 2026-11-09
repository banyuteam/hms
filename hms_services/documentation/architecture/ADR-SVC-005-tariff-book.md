# ADR-SVC-005: Tariff book (read-through) and today's tariff on the bill

- Status: Proposed (owner decisions 2026-11-09 recorded in Decision 1–2)
- Date: 2026-11-09
- Owners: hms_services
- Affected projects: hms_services (owner), hms_workspace/web (consumer)
- Related: ADR-SVC-004 (visit bill), `contracts/api/tariff-book-v1.openapi.yaml`, `clinical-timeline-v1` 1.2.0

## Context
The owner named the legacy master price tables as the tariff book: `jns_perawatan` (outpatient procedures),
`jns_perawatan_inap` (inpatient procedures), `paket_operasi` (surgery packages), `databarang` (drugs and supplies),
`jns_perawatan_lab` with `template_laboratorium` (laboratory tests and their items) and `jns_perawatan_radiologi`.
Each tariff code is already one price for one payer (`kd_pj`) and class (`kelas`), for inpatient procedures also one
ward (`kd_bangsal`), for outpatient procedures one clinic (`kd_poli`); drugs carry one price per class column. When a
service is given, the legacy HMS copies the price into the visit row (`biaya_rawat`, `biaya`, `biaya_obat`, …), so
the tariff tables hold today's prices, not necessarily what a past visit was charged.

## Decision
1. **Tariff book catalogue (owner).** Read-only API `GET /api/v1/tariffs`, `/tariffs/{kind}` (search, payer, class,
   place and status filters, keyset pages by code) and `/tariffs/laboratory/{code}/items`, with its own permission
   `tariff.read`. One item shape for every kind: code, name, category, payer, place, class, unit, active, fee
   components and prices as stored. A surgery package's price is the sum of its fee columns (in SQL). One fixed
   statement per kind; filters that do not apply are bound as '' and switch themselves off. Drug purchase and base
   prices (`h_beli`, `dasar`) and laboratory reference ranges are not read. Reads are audited (`tariff.search`,
   `tariff.read`), fail closed.
2. **Today's tariff next to each bill line (owner); the bill keeps the price actually charged.** Bill lines carry
   `tariff` (today's price of the code, from the item table the charge section already joins for the name) and
   `tariff_matches` (tariff equals the charged unit price). Procedures use the price column of who performed them
   (`total_byrdr`, `total_byrpr`, `total_byrdrpr`); surgery the package sum; laboratory `total_byr` and item
   `biaya_item`; radiology `total_byr`; drugs and take-home drugs the `databarang` column of the visit's class
   (`ralan` for outpatient visits, else the class of the latest room: kelas1/2/3, utama, vip, vvip; none for
   intensive-care and perinatal rooms). Rooms, registration, returns, extra charges, discounts and the service fee
   have no tariff in this book.
3. Not chosen: pricing the bill from tariffs (it would reprice past visits at today's prices).

## Consequences
- Positive: one place to look up prices; price changes and manual price edits on a visit become visible.
- Negative: a difference is not necessarily an error (the tariff changed after the visit, or the legacy HMS priced
  drugs by its own settings, e.g. `set_harga_obat_*`, rather than the class columns). The UI says "differs", never
  "wrong".
- Privacy/security: tariffs are internal financial data, not PHI; access is permission-gated and audited.

## Acceptance criteria
- [x] Statement allowlist (tables, shape, column and parameter counts, no purchase/base price), filter binding,
      mapping, validation, paging, audit and fail-closed tests.
- [x] `check-clinical-read` runs every tariff statement (counts only).
- [ ] Owner runs `check-clinical-read` on the dev Khanza.
- [ ] Owner confirms the drug price column rule (or names the legacy setting that decides drug prices).
