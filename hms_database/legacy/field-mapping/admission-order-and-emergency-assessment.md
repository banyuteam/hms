# Legacy field mapping: inpatient admission order and emergency medical assessment

**Status:** `DRAFT` (2026-11-11). Structure is taken from the schema inventory
([`../schema-inventory/admission-order-and-emergency-assessment.md`](../schema-inventory/admission-order-and-emergency-assessment.md),
schema `rsb221022021`, MariaDB 10.6). Meanings are marked by evidence; anything marked **inferred** needs confirmation
by the legacy/clinical owner before a rule depends on it (hms_database `CLAUDE.md`: no legacy semantics without
evidence). Read by hms_services in the visit timeline (clinical-timeline-v1 1.4.0, ADR-SVC-004 amendment 2026-11-11).

Evidence labels: **schema** = column, type, key or foreign key in the inventory · **owner** = stated by the product
owner · **Khanza** = label of the SIMRS Khanza form that writes the column · **inferred** = from the column name only.

## 1. How the tables connect

```
reg_periksa (no_rawat)                                                      schema
 ├─ perintah_ranap        no_rawat → reg_periksa   PK no_rawat (1 per visit)   schema (FK), ~11 000 rows
 │   └─ kd_kamar → kamar → bangsal (kd_bangsal)                                schema (FK), same joins as kamar_inap
 └─ penilaian_medis_igd   no_rawat → reg_periksa   PK no_rawat (1 per visit)   schema (FK), ~12 300 rows
     └─ kd_dokter → dokter                                                      schema (FK)
```

Both tables are keyed by the visit number, so a visit has at most one admission order and one emergency assessment.
Neither is the BPJS SPRI letter (`bridging_surat_pri_bpjs`, see `bpjs-bridging.md`), which is not read here.

## 2. `perintah_ranap` — Surat Perintah Rawat Inap (inpatient admission order)

| Column | Meaning | Evidence | Class | Read by hms_services |
|---|---|---|---|---|
| `no_rawat` | visit the order belongs to | schema (PK, FK) | key | filter only |
| `tanggal` | date of the order — **a date, no time** | schema (`date`) | clinical, administrative | yes: `at` = 00:00 of the date, `time_recorded: false` (owner decision 2026-11-11) |
| `kd_kamar` | room ordered | schema (FK → `kamar`) | administrative | yes, with `bangsal.nm_bangsal` and `kamar.kelas` |
| `diagnosa` | diagnosis written on the order (free text) | inferred | clinical | yes |
| `catatan` | note on the order (free text) | inferred | clinical | yes |
| `kd_dpjp` | code of the responsible doctor | inferred (name); not an FK, `varchar(5)` vs `dokter.kd_dokter` `varchar(20)` | administrative | **never** (the stored name is read instead) |
| `nm_dpjp` | name of the responsible doctor as stored on the order | inferred | administrative | yes, as stored |

## 3. `penilaian_medis_igd` — emergency medical assessment

All columns are `NOT NULL`; empty text (and `-`) means not recorded. Enum values are returned as recorded.

| Column | Meaning | Evidence | Class | Read by hms_services |
|---|---|---|---|---|
| `no_rawat` | visit | schema (PK, FK) | key | filter only |
| `tanggal` | date and time of the assessment | schema (`datetime`) | clinical | yes: `at` |
| `kd_dokter` | assessing doctor | schema (FK → `dokter`) | administrative | name only (`dokter.nm_dokter`); the code is **never** selected |
| `anamnesis` | history taken from the patient or from another person | schema (enum Autoanamnesis / Alloanamnesis) | clinical | yes |
| `hubungan` | informant's relationship to the patient (alloanamnesis) | inferred | clinical | yes |
| `keluhan_utama` | chief complaint | Khanza ("Keluhan Utama") | clinical | yes |
| `rps` | history of present illness (riwayat penyakit sekarang) | Khanza | clinical | yes |
| `rpd` | past medical history (riwayat penyakit dahulu) | Khanza | clinical | yes |
| `rpk` | family history (riwayat penyakit keluarga) | Khanza | clinical | yes |
| `rpo` | medication history (riwayat penggunaan obat) | Khanza | clinical | yes |
| `alergi` | allergy as written on the form | inferred | clinical, safety | yes — shown in the assessment only; **not** part of the patient allergy list (owner decision 2026-11-11) |
| `keadaan` | general condition | schema (enum `-`, Sehat … Sakit Berat) | clinical | yes |
| `gcs` | Glasgow Coma Scale as written | inferred | clinical | yes |
| `kesadaran` | consciousness | schema (enum Compos Mentis … Koma) | clinical | yes |
| `td`, `nadi`, `rr`, `suhu`, `spo` | blood pressure, pulse, respiration, temperature, SpO2 — text, **no unit stored** | inferred | clinical | yes, as written |
| `bb`, `tb` | weight, height — text, no unit stored | inferred | clinical | yes, as written |
| `kepala`, `mata`, `gigi`, `leher`, `thoraks`, `abdomen`, `genital`, `ekstremitas` | body-region examination result | schema (enum Normal / Abnormal / Tidak Diperiksa) | clinical | yes |
| `ket_fisik` | physical examination findings (free text) | inferred | clinical | yes |
| `ket_lokalis` | local status (status lokalis) | inferred | clinical | yes |
| `ekg`, `rad`, `lab` | ECG, radiology, laboratory results or requests as written in the form | inferred | clinical | yes |
| `diagnosis` | diagnosis (free text, not ICD-10 coded) | inferred | clinical | yes |
| `tata` | management (tatalaksana) | inferred | clinical | yes |
| `cara_keluar` | disposition from the emergency department | schema (enum: Dipulangkan, Rawat Inap di, Dirujuk ke, D.O.A …) | clinical, administrative | yes |
| `deskripsi` | text accompanying the disposition (e.g. the ward or hospital after "Rawat Inap di" / "Dirujuk ke") | **inferred — confirm** | administrative | yes, labelled neutrally ("Keterangan") |
| `indikasi` | indication (likely for the disposition) | **inferred — confirm** | clinical | yes, labelled "Indikasi" |

## 4. Open questions for the owner

1. `deskripsi` and `indikasi`: confirm what the IGD form writes there; the screens use neutral labels until then.
2. `perintah_ranap.kd_dpjp`: which master it refers to (its length does not match `dokter.kd_dokter`).
3. Whether `tanggal` of `perintah_ranap` can be paired with a time recorded elsewhere — not done: the order is placed
   at 00:00 of its date and says the time is not recorded.
