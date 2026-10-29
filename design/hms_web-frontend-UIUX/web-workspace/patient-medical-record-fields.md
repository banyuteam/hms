# web-workspace — Patient Detail "Medical Record" tab: content and field mapping

- **Status:** Draft, decisions OQ-53…55 recorded 2026-10-29. **Revised 2026-10-29: the tab is a high-level summary of seven sections (§1, §2a), confirmed by the product owner (OQ-64); allergies are merged into Clinical notes. Also decided: signature by the doctor in charge (OQ-65), final diagnosis = `diagnosa_pasien`, lab `keterangan` = free-text detail (OQ-66).** **Figma redrawn to match: wireframe W15, mockup 14 (current encounter, 12–15 Mar 2026 discharged) and mockup 16 (all encounters), both full-length; the scrolled state 16b was removed.** · **Covers:** PRD FR-18
- **Verified against:** `docs/references/khanza-schema/rsb221022021.sql` (structure only). Tables read: `diagnosa_pasien`, `penyakit`,
  `penilaian_medis_ranap`, `penilaian_medis_ralan`, `pemeriksaan_ranap`, `pemeriksaan_ralan`, `catatan_keperawatan_ranap`, `catatan_perawatan`,
  `alergi_pasien`, `resume_pasien_ranap`, `dokter`, `pegawai`; added for the summary (§2a): `resume_pasien`, `prosedur_pasien`, `periksa_lab`, `detail_periksa_lab`,
  `hasil_radiologi`, `periksa_radiologi`, `resep_obat`, `detail_pemberian_obat`, `resep_pulang`, `rawat_jl_dr`, `rawat_jl_pr`, `rawat_jl_drpr`, `rawat_inap_dr`,
  `rawat_inap_pr`, `operasi`, `kamar_inap`, `rujuk`, `surat_kontrol_umum`, `skdp_bpjs`, `verifikasi_dpjp`, `ttd_petugas`, `rsub2_tanda_tangan`, `surat_persetujuan_umum`.
- All values in the mockup are synthetic. Clinical notes are PHI: nothing here may be logged or stored outside the approved services
  (root `CLAUDE.md` rule 2); opening this tab must emit an audit event (who, what, when, why) — the backend does that, the UI passes the correlation id.
  Access is open to all roles for now; RBAC is designed later (OQ-55).

## 1. What the tab contains

The Medical Record tab is the longitudinal clinical record of the patient. It took over the sidebar items *Diagnoses* and *Problems & History*
(OQ-50); the **discharge summary** (`resume_pasien_ranap`) lives in the **Documents** tab (OQ-53); *Visit History* and *Appointments* are in the **Encounters** tab, *Procedures*, *Results*, *Medications* and *Billing* have their own tabs.

Layout: a toolbar — scope switch **Current encounter | All encounters**, the encounter context line, search — then the **high-level summary**: seven sections in a
fixed order, each a card. The order tells the clinical story (what the patient has → what was found → what was recorded → what was done → how it ended → what happens
next → who has acknowledged it). The summary is a **read-only digest**; the full lists stay in the Results, Medications, Procedures and Documents tabs.

| # | Section | Content | Main sources (details in §2 and §2a) |
|---|---|---|---|
| 1 | **Final diagnoses** | One **Primary** and one or several **Secondary** ICD-10 diagnoses. *Kept as before; the admission diagnosis and the discharge-resume copy are added.* | `diagnosa_pasien`, `penyakit`; `resume_pasien_ranap` |
| 2 | **Medical history** | Chief complaint, present illness, past illnesses, family history, medication history (as before) **plus supporting clinical data**: physical findings, laboratory results, radiology results and medication therapy | `penilaian_medis_*`; `detail_periksa_lab`, `hasil_radiologi`, `detail_pemberian_obat`, `resep_obat` |
| 3 | **Clinical notes** | Newest-first timeline, **SOAP-based notes first**, then nursing and doctor notes and the admission note. **Allergy information is merged here** as a pinned note | `pemeriksaan_*` (SOAP), `catatan_*`, `alergi_pasien` |
| 4 | **Procedures & interventions** | Procedures and interventions decided and performed by a **doctor or a nurse**, and the coded ICD-9-CM procedures | `prosedur_pasien`, `rawat_*_dr`, `rawat_*_pr`, `rawat_jl_drpr`, `operasi` |
| 5 | **Treatment and outcomes** | What was given (medication, diet, procedures in brief) and how the encounter ended (condition and way of leaving) | `resume_pasien_ranap`, `kamar_inap`, `detail_pemberian_obat` |
| 6 | **Discharge plan / follow-up** | Where care continues, medicines to take home, control visit, diet, education, pending results | `resume_pasien_ranap`, `resep_pulang`, `surat_kontrol_umum`, `skdp_bpjs`, `rujuk` |
| 7 | **Digital signature and date** | The record is acknowledged by the **doctor in charge (DPJP)**: name, status and date | `dpjp_ranap`, `verifikasi_dpjp` — see §2a.7 and OQ-65 |

There is **no separate Allergies card**. Allergies appear as a pinned **Allergy** note at the top of Clinical notes (patient-level, §2a.3). The allergy chip in the patient
header stays (OQ-50). No second navigation inside the tab (that is why it is cards, not sub-tabs). The full **discharge summary document** (`resume_pasien_ranap`, printable)
still lives in the **Documents** tab (OQ-53); sections 5–7 here show a short digest of the same encounter (OQ-64).

### 1a. Scope "All encounters" (Figma mockup 16 and 16b, row "Clinical tabs")

The same tab with the scope switch on **All encounters** (no extra reason prompt, OQ-55). The context line shows the count and date range ("4 encounters · Jun 2025 – Oct 2026").
Every record is shown **with the encounter it belongs to**; nothing is merged across encounters.

| Section | In "All encounters" |
|---|---|
| 1 Final diagnoses | Full-width table across all encounters: Code · Diagnosis · Role (Primary/Secondary) · Condition (New/Existing) · Encounter (date · type). Newest encounter first, primary first inside an encounter. The same code can repeat (e.g. I10 in four encounters) — that is the history, not a duplicate. |
| 2 Medical history | **Latest assessment only** (with its date and type) and an "Earlier assessments (3)" link to the older ones. Supporting data is listed **per encounter**, newest first, a few key results each, with a link to the Results / Medications tabs. Open: OQ-63. |
| 3 Clinical notes | Newest first, **grouped by encounter**: a group header (date · type · unit) followed by that encounter's notes. The **Allergy** note stays pinned at the very top, outside the groups (it belongs to the patient). |
| 4 Procedures & interventions | One table across encounters with an Encounter column, newest first. |
| 5 Treatment and outcomes | **One row per encounter**: treatment in brief, condition at the end, way of leaving. |
| 6 Discharge plan / follow-up | **One row per encounter** (the latest on top); open follow-ups (control date not yet passed) are highlighted with text, not colour alone. |
| 7 Digital signature and date | **One row per encounter**: the doctor in charge, status and date. |

Sorting key for the groups and rows is the encounter registration date (`reg_periksa.tgl_registrasi`, `jam_reg`), like the Encounters list. Loading and "many encounters"
(paging or "Load older encounters") are to be designed. Mockup 16 shows all seven sections; the open encounter (26 Oct 2026) shows "Not discharged yet" and "Not signed".

## 2. Field → source

| UI | Source | Notes |
|---|---|---|
| Diagnosis code | `diagnosa_pasien.kd_penyakit` | ICD-10 (WHO 2010 as used by INA-CBG) |
| Diagnosis name | `penyakit.nm_penyakit` (join on `kd_penyakit`) | shown as stored |
| Primary / Secondary | `diagnosa_pasien.prioritas` (`1` → Primary, `> 1` → Secondary) | numeric priority |
| New / Existing | `diagnosa_pasien.status_penyakit` (`Baru` → New, `Lama` → Existing) | |
| Inpatient / Outpatient | `diagnosa_pasien.status` (`Ranap` → Inpatient, `Ralan` → Outpatient) | |
| Scope "Current encounter" / "All encounters" | filter by `no_rawat` (encounter id, PHI identifier) | |
| Chief complaint | `penilaian_medis_ranap.keluhan_utama` / `penilaian_medis_ralan.keluhan_utama` | free text, up to 2000 characters |
| Present illness | `…​.rps` | free text |
| Past illnesses | `…​.rpd` | free text |
| Family history | `…​.rpk` | free text |
| Medication history | `…​.rpo` | free text |
| Assessment date / author | `…​.tanggal`, `kd_dokter` → `dokter.nm_dokter` | |
| Progress note (S / O / A / P) | `pemeriksaan_ranap` / `pemeriksaan_ralan`: `keluhan` (S), `pemeriksaan` + vitals (O), `penilaian` (A), `rtl` (P); also `instruksi`, `evaluasi` | vitals are **text** columns (`tensi`, `suhu_tubuh`, `nadi`, `respirasi`, `spo2`) — parse and validate before showing |
| Note date/time | `tgl_perawatan`, `jam_rawat` | |
| Note author | `pemeriksaan_*.nip` → staff name | see §4, point 2 |
| Nursing note | `catatan_keperawatan_ranap.uraian` (+ `tanggal`, `jam`, `nip`) | |
| Doctor's note | `catatan_perawatan.catatan` (+ `tanggal`, `jam`, `kd_dokter`) | not drawn in the mockup; same card |
| Admission note | derived from the admission assessment (`penilaian_medis_ranap`) | |
| Allergen | `alergi_pasien.id_alergen` / `teks_bebas` | **source of truth for allergies (decided)**; structured table, FHIR-like |
| Category, Type, Criticality | `alergi_pasien.kategori`, `tipe`, `kriticalitas` | `varchar(20)` — the stored vocabulary is **not defined in the DDL**; labels in the mockup are placeholders until the distinct values are known |
| Status | `alergi_pasien.status_klinis`, `status_verifikasi` | same caveat |
| Recorded | `alergi_pasien.tgl_dicatat` | |

English labels for the enum columns used here (decided style, OQ-51): `Autoanamnesis` → Self-reported · `Alloanamnesis` → Reported by others ·
`Compos Mentis` → Alert and oriented · `Somnolence`/`Somnolen` → Drowsy · `Sopor` → Stuporous · `Coma`/`Koma` → Coma. Free text is shown as stored.

## 2a. Field → source for the high-level summary (added 2026-10-29)

Verified against the same DDL snapshot. Everything in §2 stays valid; this section adds to it, one block per summary section. Fees and prices
(`biaya_*`, `tarif_*`, `material`, `bhp`, `h_beli`, `total`) are Billing data and are **never shown** on this tab. Columns marked "not yet read" were not opened in the DDL.

### 2a.1 Final diagnoses — kept as in §2, plus

| UI | Source | Notes |
|---|---|---|
| Primary / Secondary (one primary, any number of secondary) | `diagnosa_pasien.prioritas` (`1` → Primary, `> 1` → Secondary) | unchanged from §2 |
| Admission diagnosis (small line above the table) | `kamar_inap.diagnosa_awal`; `resume_pasien_ranap.diagnosa_awal` | free text, `varchar(100)`; inpatient only |
| Source of the final diagnosis | **Decided (OQ-66): the coded `diagnosa_pasien`** (with `prioritas`) is the final diagnosis | the discharge resume keeps its own free-text copy (`resume_pasien_ranap`: `diagnosa_utama` / `kd_diagnosa_utama`, `diagnosa_sekunder`…`diagnosa_sekunder4`; `resume_pasien` the same five slots). It is **not shown here**; it belongs to the discharge summary in the Documents tab |

### 2a.2 Medical history — assessment as in §2, plus supporting clinical data

| UI | Source | Notes |
|---|---|---|
| Physical examination | `resume_pasien_ranap.pemeriksaan_fisik`; vitals from `pemeriksaan_ranap` / `pemeriksaan_ralan` | text; vitals are text columns, parse before showing (§2) |
| **Laboratory results** | order: `periksa_lab` (`tgl_periksa`, `jam`, `dokter_perujuk`, `kd_dokter`, `kategori` PK/PA/MB); values: `detail_periksa_lab` (`id_template` → `template_laboratorium`, `nilai`, `nilai_rujukan`, `keterangan`) | value and reference range are **text** and are not compared by the UI. **Decided (OQ-66): `keterangan` is a free-text field with the detail of the result**; show it as stored, next to the value, with no derived High/Low flag. The resume's free text `hasil_laborat` and the still-pending `lab_belum` appear as a line |
| **Radiology results** | order: `periksa_radiologi` (`tgl_periksa`, `jam`, `kd_jenis_prw`, `dokter_perujuk`); reading: `hasil_radiologi.hasil` (keyed by `no_rawat`, `tgl_periksa`, `jam`) | reading text only; images belong to the Radiology viewer |
| **Medication therapy — ordered** | `resep_obat` (`no_resep`, `tgl_peresepan`, `jam_peresepan`, `kd_dokter`, `status`) | item lines are in `resep_dokter` (not yet read) |
| **Medication therapy — given** | `detail_pemberian_obat` (`kode_brng`, `jml`, `tgl_perawatan`, `jam`, `status`); summary text `resume_pasien_ranap.obat_di_rs` | drug names come from the drug master (not yet read) |
| Tests performed (text) | `resume_pasien_ranap.pemeriksaan_penunjang` | free text |

Presentation (mockups 14 and 16): the card has two parts — **History** (as before) and **Supporting findings** with three short lists (Laboratory · Radiology · Medication therapy), the five newest each,
with links to the Results and Medications tabs. The result detail is the lab's own free text (`keterangan`); the UI adds no High / Low labelling of its own.

### 2a.3 Clinical notes — as before, SOAP first, allergies merged in

| UI | Source | Notes |
|---|---|---|
| SOAP notes (main entries) | `pemeriksaan_ranap` / `pemeriksaan_ralan`: S `keluhan`, O `pemeriksaan` + vitals, A `penilaian`, P `rtl` (§2) | **priority rule:** records that have SOAP fields render as S/O/A/P blocks; newest first |
| Nursing, doctor and admission notes | `catatan_keperawatan_ranap`, `catatan_perawatan`, admission assessment (§2) | same timeline, lighter one-line form, below the SOAP weight in the layout but still ordered by time |
| **Pinned Allergy note** (top of the card, both scopes) | `alergi_pasien`: `id_alergen` / `teks_bebas` (allergen), `kategori`, `tipe`, `kriticalitas`, `status_klinis`, `status_verifikasi`, `tgl_dicatat`, `sumber`; patient key `no_rm` | one note, one line per allergen; replaces the Allergies card |

Rules for the Allergy note:

- It is **patient-level**: shown in both scopes, outside the encounter groups. `alergi_pasien.id_encounter` is a `bigint` and `reg_periksa.no_rawat` is `varchar(17)`; no link between them is known, so there is no per-encounter allergy filter.
- The earlier mockup showed a **Reaction** field. `alergi_pasien` has **no reaction column**; drop it, or show it only if it appears inside `teks_bebas`.
- Nothing recorded → "No allergy recorded". Do **not** write "No known allergies": Khanza cannot tell "none" from "not asked".
- `alergi_pasien` stays the source of truth (OQ-54). The older free-text fields (including `resume_pasien_ranap.alergi`) are still not used. The vocabulary caveat of OQ-54 stays open.

### 2a.4 Procedures & interventions (doctor or nurse)

| UI | Source | Notes |
|---|---|---|
| Performed by a **doctor** | `rawat_jl_dr` (outpatient), `rawat_inap_dr` (inpatient): `kd_jenis_prw` → `jns_perawatan` name, `kd_dokter`, `tgl_perawatan`, `jam_rawat` | role label "Doctor" |
| Performed by a **nurse** | `rawat_jl_pr`, `rawat_inap_pr`: `kd_jenis_prw`, `nip` → staff display name, `tgl_perawatan`, `jam_rawat` | role label "Nurse"; `nip` can also be another staff role (midwife, …) — label from the job title, to confirm |
| Doctor and nurse together | `rawat_jl_drpr`: `kd_dokter` and `nip` in one row (an inpatient equivalent was not read) | role label "Doctor and nurse" |
| Surgery | `operasi`: `tgl_operasi`, `kategori` (Khusus / Besar / Sedang / Kecil / Elektive / Emergency), `jenis_anasthesi`, `operator1`, `dokter_anestesi` and the rest of the team columns | show operator and anaesthetist; the other team members on expand |
| **Coded procedures** (ICD-9-CM) | `prosedur_pasien` (`kode` → `icd9`, `status`, `prioritas`); resume copy `prosedur_utama`, `prosedur_sekunder`…`prosedur_sekunder3` | claim view (INA-CBG). No key links a coded row to a performed row, so coded procedures form a **separate group** |

Each row: date and time · name · performed-by role and name · ICD-9-CM code when coded. The schema stores who **performed** an intervention, not who **decided** it
(OQ-66, still open): the UI says "Performed by".

### 2a.5 Treatment and outcomes

| UI | Source | Notes |
|---|---|---|
| Medication given, diet, procedures in brief | `detail_pemberian_obat`, `resume_pasien_ranap.obat_di_rs`, `resume_pasien_ranap.diet`, count of the rows in §2a.4 | digest only; detail in the Medications and Procedures tabs |
| Room and length of stay | `kamar_inap.kd_kamar`, `kamar_inap.lama` | inpatient |
| **Condition at the end** (inpatient) | `resume_pasien_ranap.keadaan` (`Membaik` → Improved, `Sembuh` → Recovered, `Keadaan Khusus` → Special condition, `Meninggal` → Deceased) + `ket_keadaan`; also `kamar_inap.stts_pulang` | enum labels as in OQ-51 style |
| Condition at the end (outpatient) | `resume_pasien.kondisi_pulang` (`Hidup` → Alive, `Meninggal` → Deceased) | |
| **Way of leaving** | `resume_pasien_ranap.cara_keluar` (`Atas Izin Dokter` → With the doctor's permission, `Pindah RS` → Transferred to another hospital, `Pulang Atas Permintaan Sendiri` → Left at own request, `Lainnya` → Other) + `ket_keluar` | |
| Encounter status | `reg_periksa.stts` | labels pending OQ-59 |

An encounter that is still open shows "Not discharged yet" and no outcome.

### 2a.6 Discharge plan / follow-up

| UI | Source | Notes |
|---|---|---|
| Care continues | `resume_pasien_ranap.dilanjutkan` (`Kembali Ke RS` → Return to this hospital, `RS Lain` → Another hospital, `Dokter Luar` → External doctor, `Puskesmes` → Primary health centre, `Lainnya` → Other) + `ket_dilanjutkan` | the DDL spells `Puskesmes`; show the English label |
| Control visit | `resume_pasien_ranap`: `kontrol`, `no_surat_kontrol`, `dokter_kontrol` / `kd_dokter_kontrol`, `poli_kontrol` / `kd_poli_kontrol`; control letters `surat_kontrol_umum` (`tanggal_datang`, `kd_poli`, `kd_dokter`, `status`) and `skdp_bpjs` (`tanggal_datang`, `rtl1`, `rtl2`) | `kontrol` is free text (50 characters): show as stored. The letters are keyed by `no_rkm_medis`, not `no_rawat` — link by patient and date |
| Medicines to take home | `resume_pasien_ranap.obat_pulang` (text); structured `resep_pulang` (`kode_brng`, `jml_barang`, `dosis`, `tanggal`) | no prices |
| Diet and education | `resume_pasien_ranap.diet`, `resume_pasien_ranap.edukasi` | `edukasi_pasien_dan_keluarga` is a learning-needs assessment, not discharge education — not used here |
| Pending results at discharge | `resume_pasien_ranap.lab_belum` | text |
| Referral out | `rujuk`: `no_rujuk`, `rujuk_ke`, `tgl_rujuk`, `kd_dokter`, `keterangan_diagnosa` | the table also holds transport and handover data; show destination, date and doctor only |

For an outpatient encounter `resume_pasien` has only `obat_pulang`; follow-up comes from the control letters.

### 2a.7 Digital signature and date (acknowledgement by the doctor in charge)

**Decided (OQ-65): the record is signed by the doctor in charge (DPJP).** No nurse or patient/guardian line. This section shows **who signed and when**; Phase 1 is read-only:
the UI never signs. One line per encounter — role · name · status · date and time (stored UTC, shown Asia/Jakarta); the status is a word plus an icon, never colour alone.

| UI | Source | Notes |
|---|---|---|
| Doctor in charge (name) | inpatient: `dpjp_ranap` (`no_rawat`, `prioritas`, `kd_dokter` → `dokter`), several doctors possible, `prioritas` orders them; outpatient: `reg_periksa.kd_dokter` | the same source resolves the attending doctor shown in the Encounters tab (OQ-60) |
| Status | `verifikasi_dpjp.status_verifikasi` (`belum` → Not signed, `sudah` → Signed), `nip_verifikator` | a **verification** flag, not a cryptographic signature (see below) |
| Date and time | `verifikasi_dpjp.tgl_prwtan`, `jam_prwtan` | see "Limits" |

**Limits of the source data (to settle with the hospital):**

- `verifikasi_dpjp` has the key (`no_rawat`, `tgl_prwtan`, `jam_prwtan`, `nip`): it records the verification **per care entry** (date and time of the care), not one signature on the whole record, and it has **no timestamp of the verification itself**. The displayed date is therefore the date of the care entry that was verified.
- `verifikasi_dpjp.nip` points to `petugas`, while the doctor in charge is a `dokter.kd_dokter`; that both identify the same person (the doctor's `kd_dokter` equals the staff `nip`) is **assumed, not verified**.
- No Khanza table stores a digital signature on the record itself (no certificate, no document hash, no signed-document id). `ttd_petugas` is a staff signature **image** (`longblob`, never sent to the browser) and `rsub2_tanda_tangan` a non-standard table of unknown origin; neither is used.
- A real digital signature is the job of the **api-gateway e-signature service**; its provider and the legal requirement are still open (OQ-65). Until then the UI shows "Signed (verified by DPJP)" / "Not signed" from `verifikasi_dpjp` only, and must not call a signature image or the `sudah` flag a legally valid e-signature.

## 3. States

Empty scope ("No diagnoses recorded yet"), loading, error with retry, and "no access" (role) are to be added to the mockup when the PRD is
approved. Phase 1 is read-only: there are no add/edit actions on this tab.

With seven sections **each section needs its own empty and error state** (one slow or failing source must not blank the whole summary): "No supporting results yet",
"No procedures recorded", "Not discharged yet" (sections 5–7 of an open encounter), "Not signed". Sections load independently.

## 4. Issues found

1. **Many specialty assessments.** Khanza has `penilaian_medis_ralan_*` for ~20 specialties (internal medicine, paediatrics, surgery, obstetrics, ENT,
   eye, neurology, …) and separate inpatient/neonatal forms. The mockup shows only the generic medical history; the specialty forms stay out of
   Phase 1 until the hospital names the ones it needs (OQ-53).
2. **Staff data is sensitive.** `pegawai` contains payroll and tax data (`gapok`, `npwp`, birth date, address). The projection must take only the
   display name and job title, never the row. The join between `nip` and `pegawai` (probably `pegawai.nik`) must be confirmed.
3. **Two allergy models.** `alergi_pasien` is the decided source of truth (OQ-54); older free-text allergy fields remain (`pemeriksaan_*.alergi`,
   `penilaian_medis_*.alergi`, `catatan_pasien_alergi`) and are **not used**. The vocabulary of its status/category columns still needs to be read from real data.
4. **Notes from many tables.** SOAP notes, nursing notes, observation charts (`catatan_observasi_*`), nutrition (`catatan_adime_gizi`) and others are
   separate tables with different shapes. The timeline merges the first three; the rest are out of scope until requested.
5. **Latin-1 and length limits** apply as on the profile pages (see `patient-profile-fields.md` §4); notes may be truncated at 700–2000 characters by the source columns.
6. **Who may read notes.** For now every user and role can open the tab (decided, OQ-55); RBAC comes later (OQ-18). The reference mockup's user is a finance manager, so the later RBAC design must decide what non-clinical roles see. The audit event on open stays.
7. **Two discharge sources.** The discharge resume (`resume_pasien_ranap`, `resume_pasien`) is free text typed by the doctor and duplicates data kept elsewhere
   (diagnoses, procedures, medicines, results). The summary is built from the structured tables (final diagnosis = `diagnosa_pasien`, decided in OQ-66); the resume text is not reconciled by the UI and is shown in the Documents tab.
8. **No digital signature in the source data** (§2a.7). The only usable source is `verifikasi_dpjp`, a per-care-entry verification flag without its own timestamp; the doctor-in-charge link goes through `petugas.nip`. A legally valid e-signature needs the api-gateway e-signature service (OQ-65).
9. **Staff names.** `nip` appears in several tables (`rawat_*_pr`, `ttd_petugas`, `verifikasi_dpjp`); as in issue 2, take only the display name and job title from `pegawai`, never the row.
10. **Allergy model gaps.** `alergi_pasien` has no reaction column and an `id_encounter` that does not obviously match `no_rawat` (§2a.3); the merge into Clinical notes therefore treats allergies as patient-level.
