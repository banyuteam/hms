# Legacy field mapping: BPJS bridging and INA-CBG data

**Status:** `DRAFT` (2026-11-09). Structure is taken from the schema inventory
([`../schema-inventory/bpjs-bridging.md`](../schema-inventory/bpjs-bridging.md), schema `rsb221022021`,
MariaDB 10.6). Meanings are marked by evidence; anything marked **inferred** needs confirmation by the casemix/BPJS
owner before a rule or a screen depends on it (hms_database `CLAUDE.md`: no legacy semantics without evidence).

**Scope (owner, 2026-11-09):** BPJS data of the legacy HMS is in the tables prefixed `bridging_` (and the INA-CBG /
E-Klaim tables `inacbg_*`), and applies to visits whose payer is BPJS: `reg_periksa.kd_pj = 'BPJ'`. The SEP is in
`bridging_sep`.

Evidence labels: **schema** = column, key or foreign key in the inventory · **owner** = stated by the product owner ·
**BPJS** = BPJS VClaim / E-Klaim convention, confirmed by values seen in the data · **inferred** = from names and row
counts only.

## 1. How the tables connect

```
reg_periksa (no_rawat, kd_pj = 'BPJ')                               owner + schema
 ├─ bridging_sep            no_rawat → reg_periksa   PK no_sep      schema (FK), ~47 000 rows
 │   ├─ bridging_rujukan_bpjs        no_sep → bridging_sep          schema (FK)  outgoing referral
 │   ├─ bridging_surat_kontrol_bpjs  no_sep → bridging_sep          schema (FK)  follow-up (control) letter
 │   ├─ bpjs_prb                     no_sep → bridging_sep          schema (FK)  PRB (back-referral programme)
 │   └─ inacbg_grouping_stage1       no_sep → bridging_sep          schema (FK)  older grouping table, ~1 900 rows
 ├─ bridging_surat_pri_bpjs  no_rawat → reg_periksa                 schema (FK)  inpatient order letter (SPRI)
 └─ inacbg_klaim_baru2       no_rawat → reg_periksa  PK no_rawat, unique no_sep   schema, ~81 500 rows
     ├─ inacbg_grouping_stage12   no_sep → inacbg_klaim_baru2       schema (FK)  code_cbg, deskripsi, tarif
     └─ inacbg_data_terkirim2     no_sep → inacbg_klaim_baru2       schema (FK)  nik (who sent)
inacbg_final (no_sep), inacbg_idrg_final (no_sep, coder)            no keys       inferred: "final" markers
*_internal tables → bridging_sep_internal                          schema (FK)  inferred: internal SEPs
```

Observations to confirm (**inferred**):
- Tables without the `2` suffix (`inacbg_klaim_baru`, `inacbg_grouping_stage1`, `inacbg_data_terkirim`) have far
  fewer rows than the `2` tables and look like an earlier version of the E-Klaim bridging. Which set is current?
- `inacbg_klaim_baru2` (~81 500) has more rows than `bridging_sep` (~47 000). Row counts are server estimates, but the
  gap is large: are there claims whose SEP is not in `bridging_sep` (created elsewhere, deleted, or `bridging_sep_internal`)?
- `inacbg_final` and `inacbg_idrg_final` have no primary key; is a row there the "claim finalised" (INA-CBG / iDRG) mark,
  and who writes it?
- `rvp_klaim_bpjs` (82 columns, a few rows): claim payment and receivable figures per visit; in use?

## 2. `bridging_sep` (SEP, Surat Eligibilitas Peserta)

Key: `no_sep` (PK). Visit: `no_rawat` → `reg_periksa` (FK, indexed). A visit can have more than one SEP: a sample of 25
recent SEP visits on 2026-11-09 had 34 SEP rows (**schema**/data; e.g. suplesi).

"Read" columns are returned in clinical-timeline-v1 1.3.0 `summary.sep` (owner decision B-1, 2026-11-09: the SEP
number in full) and used by claim readiness v3 (`jnspelayanan`, `tglpulang`).

| Column | Meaning | Evidence | Class | Read by hms_services |
|---|---|---|---|---|
| `no_sep` | SEP number | schema (PK) | claim identifier | yes, sent in full (`number`) |
| `no_rawat` | visit | schema (FK) | key | filter only |
| `tglsep` | SEP date | schema | administrative | yes |
| `jnspelayanan` | `1` inpatient, `2` outpatient | BPJS; values `1`/`2` seen | administrative | yes |
| `klsrawat` | entitled class `1`–`3` | BPJS | administrative | yes |
| `klsnaik`, `pembiayaan`, `pjnaikkelas` | class upgrade and who pays it | BPJS | financial | no |
| `no_rujukan`, `tglrujukan`, `kdppkrujukan`, `nmppkrujukan`, `asal_rujukan` | incoming referral | BPJS | administrative | `no_rujukan`, `nmppkrujukan` |
| `kdppkpelayanan`, `nmppkpelayanan` | serving facility | BPJS | administrative | no |
| `diagawal`, `nmdiagnosaawal` | initial diagnosis (ICD-10) on the SEP | BPJS | clinical | yes |
| `kdpolitujuan`, `nmpolitujuan` | destination clinic | BPJS | administrative | `nmpolitujuan` |
| `kddpjp`, `nmdpdjp`, `kddpjplayanan`, `nmdpjplayanan` | DPJP (BPJS doctor codes) | BPJS | administrative | `nmdpdjp` |
| `tglpulang` | discharge date sent to BPJS | BPJS | administrative | yes |
| `cob`, `katarak`, `eksekutif` | flags `0. Tidak` / `1.Ya` | schema (enum) | administrative | `cob` |
| `suplesi`, `no_sep_suplesi` | suplesi (accident guarantee) and its SEP | BPJS | administrative | yes (API only; the web does not show them yet) |
| `lakalantas`, `tglkkl`, `keterangankkl`, `kdprop`…`nmkec` | traffic-accident data and accident location | BPJS | sensitive | no |
| `tujuankunjungan`, `flagprosedur`, `penunjang`, `asesmenpelayanan`, `noskdp` | VClaim 2.0 visit purpose fields | BPJS | administrative | no (not needed yet) |
| `catatan`, `user` | free note, operator | schema | free text / staff | no |
| `nomr`, `nama_pasien`, `tanggal_lahir`, `jkel`, `peserta`, `no_kartu`, `notelep` | copy of the patient's identity and BPJS card | schema | **PHI duplicate** | **never** (already on the patient record; data minimisation) |

## 3. INA-CBG / E-Klaim (`inacbg_*`): not read yet

| Table | Columns | Meaning | Evidence |
|---|---|---|---|
| `inacbg_klaim_baru2` | `no_rawat`, `no_sep`, `patient_id`, `admission_id`, `hospital_admission_id` | claim created in E-Klaim for the visit | inferred (name, FK) |
| `inacbg_grouping_stage12` | `no_sep`, `code_cbg`, `deskripsi`, `tarif` | grouper result: INA-CBG code, description, tariff | inferred (names); BPJS for `code_cbg` |
| `inacbg_data_terkirim2` | `no_sep`, `nik` | claim data sent; `nik` = employee who sent it | inferred |
| `inacbg_final` / `inacbg_idrg_final` | `no_sep` (+ `coder`) | claim finalised (INA-CBG / iDRG) | inferred |
| `inacbg_coder_nik` | `nik` → `pegawai`, `no_ik` | coders and their E-Klaim id | inferred |

Nothing from these tables is read until the owner confirms the meanings above (ADR-SVC-007, open decisions). Grouper
output is a grouping result, not an insurer's payment decision; any screen that shows it must say so.

## 4. Other BPJS tables in the inventory (not used)

Referrals and letters (`bridging_rujukan_bpjs*`, `bridging_surat_kontrol_bpjs`, `bridging_surat_pri_bpjs`,
`skdp_bpjs`), Mobile JKN queue references (`referensi_mobilejkn_bpjs*`, including dated copies), pharmacy bridging
(`bridging_resep_apotek_bpjs*`, `maping_obat_apotek_bpjs`, empty), fingerprint and approval (`finger_bpjs`,
`approval_bpjs`), manual BA (`bridging_bpjs_manual_ba*`), other insurers (`bridging_inhealth`, empty) and
`bridging_dukcapil` (empty). Each needs its own decision before it is read.
