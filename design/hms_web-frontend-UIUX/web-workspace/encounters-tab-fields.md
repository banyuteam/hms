# web-workspace — Patient Detail "Encounters" tab: layout, content and field mapping

- **Status:** Draft for design review, 2026-10-29 · **Covers:** Figma mockup 15 (row "Clinical tabs", Mockups page), PRD FR-18 · wireframe W16 not drawn yet
- **Verified against:** `docs/references/khanza-schema/rsb221022021.sql` (structure only). Tables read: `reg_periksa`, `kamar_inap`, `rawat_jl_dr`,
  `rawat_inap_dr`, `periksa_lab`, `periksa_radiologi`, `resep_obat`, `operasi`, `bridging_sep`, `dokter`, `poliklinik`, `kamar`.
- All values in the mockup are synthetic. Encounter ids and visit dates are PHI identifiers: mask in logs; opening this tab emits an audit event
  (the backend does that, the UI passes the correlation id). Access follows OQ-55 (open to all roles until RBAC). Phase 1 is read-only.

## 1. What the tab is

The Encounters tab is the **visit history** of one patient (it took over the sidebar items *Visit History* and *Appointments*, OQ-50). One *encounter* is one
Khanza `reg_periksa` row (`no_rawat`). The tab has **two sections side by side** and no second navigation level:

| Section | Purpose |
|---|---|
| **Encounter list** (left, 296 px) | All encounters of the patient, **ordered by encounter date, newest first** (`tgl_registrasi` + `jam_reg`). Type filter All / Inpatient / Outpatient. One item = date · status pill · type and unit · responsible doctor. Click or arrow keys select; the selected item has the selected fill and a left accent bar. The first encounter is selected on open. |
| **Encounter detail** (right, fills) | Header (title, encounter id, outcome pill, five facts: Registered · Admitted · Discharged · Length of stay · Payer) and below it the **timeline** of everything the hospital did in that encounter, **from registration to discharge, oldest first**. |

Each timeline event shows time (and the date on the first event of a day), an icon on a rail, a title, and **who provided it**: *unit · doctor*.

## 2. Field → source

| UI | Source | Notes |
|---|---|---|
| Encounter date (list) | `reg_periksa.tgl_registrasi`, `jam_reg` | list sort key, descending; indexed (`tgl_registrasi`) |
| Encounter id | `reg_periksa.no_rawat` | PHI identifier. The mockup uses a readable synthetic form (`INP-…`); the real value is the Khanza `no_rawat` |
| Type (Inpatient / Outpatient) | `reg_periksa.status_lanjut` (`Ranap` → Inpatient, `Ralan` → Outpatient) | enum label, OQ-51 style |
| Unit (outpatient) | `reg_periksa.kd_poli` → `poliklinik.nm_poli` | shown as stored |
| Unit (inpatient) | `kamar_inap.kd_kamar` → `kamar` → ward name | one row per room stay; room transfers are several rows |
| Responsible doctor (list) | `reg_periksa.kd_dokter` → `dokter.nm_dokter` | |
| Status pill | `reg_periksa.stts` (`Dirawat` → Admitted, `Sudah` → Completed, `Batal` → Cancelled, `Dirujuk` → Referred, `Meninggal` → Deceased, `Pulang Paksa` → Discharged against advice, `Belum` → Registered, `Berkas Diterima`/`Berkas Terkirim` → Record received/sent) | only some values are decided; see OQ-59 |
| Outcome in detail header | `kamar_inap.stts_pulang` (`Sembuh` → Recovered, `Membaik` → Improved, `APS` → Against advice, `Rujuk` → Referred, `Meninggal` → Deceased, …) | inpatient only |
| Registered / Admitted / Discharged | `reg_periksa.tgl_registrasi`+`jam_reg` · `kamar_inap.tgl_masuk`+`jam_masuk` · `kamar_inap.tgl_keluar`+`jam_keluar` | discharge is empty while the patient is still admitted |
| Length of stay | `kamar_inap.lama` (days) | |
| Payer | `reg_periksa.kd_pj` → `penjab.png_jawab`; SEP from `bridging_sep.no_rawat` | class `bridging_sep.klsrawat` as in the profile pages |

**Timeline events** (all joined on `no_rawat`, merged and sorted by timestamp in the BFF, not in the browser):

| Event | Source (time column) | Unit · doctor |
|---|---|---|
| Registration | `reg_periksa` (`tgl_registrasi`, `jam_reg`) | registration unit/poli · `kd_dokter` (the doctor registered for) — the registering clerk is **not stored** |
| Procedure / treatment (outpatient, ER) | `rawat_jl_dr` (`tgl_perawatan`, `jam_rawat`) | poli · `kd_dokter`; name from `kd_jenis_prw` → `jns_perawatan` |
| Procedure / doctor visit (inpatient) | `rawat_inap_dr` (`tgl_perawatan`, `jam_rawat`) | ward · `kd_dokter` |
| Laboratory | `periksa_lab` (`tgl_periksa`, `jam`) | Laboratory · requested by `dokter_perujuk`, performed by `kd_dokter` |
| Radiology | `periksa_radiologi` (`tgl_periksa`, `jam`) | Radiology · same two doctors |
| Prescription | `resep_obat` (`tgl_peresepan`, `jam_peresepan`; dispensed `tgl_penyerahan`/`jam_penyerahan`) | Pharmacy · `kd_dokter` |
| Admission / room transfer | `kamar_inap` (`tgl_masuk`, `jam_masuk`) | ward and room · attending doctor — **not stored on `kamar_inap`**; `dpjp_ranap` is the likely source, see OQ-60 |
| Surgery | `operasi` (`tgl_operasi`) | operating room · `operator1` and the team columns |
| Discharge | `kamar_inap` (`tgl_keluar`, `jam_keluar`, `stts_pulang`) | ward · attending doctor |

Content of an event stays one line in the timeline (name and key values only). Clinical notes stay in **Medical Record → Clinical notes**, results in the
**Results** tab, drugs in **Medications**, prices never appear here (Billing). An event may later link to the matching tab (not drawn).

## 3. Behaviour

- Selection drives the detail pane; the **Medical Record** tab keeps its own scope switch (*Current encounter | All encounters*). Open question OQ-61: should the two share the selection.
- Timeline order is **oldest first** (reads as a story from registration to discharge); the list is newest first. The hint under "Timeline" says so.
- An **open** encounter (still admitted or visit in progress) ends with a muted "Not discharged yet" node instead of the discharge event.
- Long timelines scroll inside the detail pane; the header and the list stay put.
- Keyboard: ↑/↓ moves in the list, Tab goes to the timeline, Enter on an event opens its tab (later).
- Compact window (tiled, below ~900 px content width): list becomes a collapsible drawer above the detail (to design).

## 4. States still to add to the mockup

Empty (no encounters yet), loading, error with retry, no access (role), a **cancelled** encounter (`Batal`), an **open** inpatient encounter, an encounter with
many events (scroll), and the compact layout. Draw them when the PRD is approved, as for the Medical Record tab.

## 5. Not covered

Appointments in the future (Khanza `booking_registrasi`, `referensi_mobilejkn_bpjs`) and referrals out (`rujuk`) are not in the first version; ask the
hospital whether upcoming appointments belong here (OQ-62).
