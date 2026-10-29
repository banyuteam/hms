# web-workspace — Patient Detail "Medical Record" tab: content and field mapping

- **Status:** Draft, decisions OQ-53…55 recorded 2026-10-29 · **Covers:** Figma W15 and mockup 14 (row "Clinical tabs"), PRD FR-18
- **Verified against:** `docs/references/khanza-schema/rsb221022021.sql` (structure only). Tables read: `diagnosa_pasien`, `penyakit`,
  `penilaian_medis_ranap`, `penilaian_medis_ralan`, `pemeriksaan_ranap`, `pemeriksaan_ralan`, `catatan_keperawatan_ranap`, `catatan_perawatan`,
  `alergi_pasien`, `resume_pasien_ranap`, `dokter`, `pegawai`.
- All values in the mockup are synthetic. Clinical notes are PHI: nothing here may be logged or stored outside the approved services
  (root `CLAUDE.md` rule 2); opening this tab must emit an audit event (who, what, when, why) — the backend does that, the UI passes the correlation id.
  Access is open to all roles for now; RBAC is designed later (OQ-55).

## 1. What the tab contains

The Medical Record tab is the longitudinal clinical record of the patient. It took over the sidebar items *Diagnoses* and *Problems & History*
(OQ-50); the **discharge summary** (`resume_pasien_ranap`) lives in the **Documents** tab (OQ-53); *Visit History* and *Appointments* are in the **Encounters** tab, *Procedures*, *Results*, *Medications* and *Billing* have their own tabs.

Layout: a toolbar — scope switch **Current encounter | All encounters**, the encounter context line, search — then four cards:

| Card | Purpose |
|---|---|
| Diagnoses | ICD-10 diagnoses of the selected scope, primary first |
| Medical history | Chief complaint, present illness, past illnesses, family history, medication history from the admission/clinic assessment |
| Clinical notes | Newest-first timeline of progress notes (SOAP), nursing notes and the admission note |
| Allergies | Detail behind the allergy chip in the header |

No second navigation inside the tab (that is why it is cards, not sub-tabs).

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

## 3. States

Empty scope ("No diagnoses recorded yet"), loading, error with retry, and "no access" (role) are to be added to the mockup when the PRD is
approved. Phase 1 is read-only: there are no add/edit actions on this tab.

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
