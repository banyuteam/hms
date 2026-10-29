# web-workspace — Patient Detail profile pages: field mapping

- **Status:** Draft for review · **Date:** 2026-10-29 · **Covers:** PRD FR-18, Figma W10–W14 / mockups 10–13, OQ-50…52
- **Verified against:** `docs/references/khanza-schema/rsb221022021.sql` (structure only — the 5 `INSERT` lines in it are inside
  stored procedures/triggers, not data). Tables read: `pasien`, `reg_periksa`, `bridging_sep`, `penjab`, `perusahaan_pasien`,
  `suku_bangsa`, `bahasa_pasien`, `cacat_fisik`, `kelurahan`, `kecamatan`, `kabupaten`, `propinsi`.
- **Rule:** the new platform never reads Khanza directly (root `CLAUDE.md` rule 1) — these columns are what the CDC stream /
  read-only replica must supply to the profile projection. All values in the mockups are synthetic.

## 1. Navigation model (approved 2026-10-29)

Header = identity and safety (always visible) · 11 clinical tabs, the rest under **More ▾** · sidebar = profile pages + **Audit Log**
(stays in the sidebar — decided). One place is active at a time. Details: Figma W10 (the window-state rules in `window-states.md` are unaffected).

## 2. Field → source

`PHI` marks values masked by default (reveal is audited). *Derived* = not stored as a column.

### Personal Information (Figma W11 / mockup 10)

| UI field | Source | Notes |
|---|---|---|
| Full name | `pasien.nm_pasien` | |
| MRN | `pasien.no_rkm_medis` | primary key; PHI identifier |
| NIK | `pasien.no_ktp` | **PHI, masked** |
| Gender | `pasien.jk` (`L`/`P`) | UI maps to Male/Female |
| Birth place / Birth date | `pasien.tmp_lahir`, `pasien.tgl_lahir` | |
| Age | *derived* from `tgl_lahir` | `pasien.umur` is a free-text string — do not use |
| Blood type | `pasien.gol_darah` (`A`,`B`,`O`,`AB`,`-`) | **no Rh factor** — the mockups now show "O", not "O+" |
| Marital status | `pasien.stts_nikah` (`BELUM MENIKAH`,`MENIKAH`,`JANDA`,`DUDHA`,`JOMBLO`) | English labels in §3 |
| Religion | `pasien.agama` | free text |
| Education | `pasien.pnd` (`TS`,`TK`,`SD`,`SMP`,`SMA`,`SLTA/SEDERAJAT`,`D1`…`S3`,`-`) | English labels in §3 |
| Occupation | `pasien.pekerjaan` | |
| Ethnicity | `pasien.suku_bangsa` → `suku_bangsa.nama_suku_bangsa` | lookup |
| Language | `pasien.bahasa_pasien` → `bahasa_pasien.nama_bahasa` | lookup |
| Mother's name | `pasien.nm_ibu` | required in Khanza; used for identity check; shown only here |
| Disability | `pasien.cacat_fisik` → `cacat_fisik.nama_cacat` | lookup |
| First registered | `pasien.tgl_daftar` | |
| Last visit | *derived*: latest `reg_periksa.tgl_registrasi` for the MRN | |
| Encounters | *derived*: count of `reg_periksa` rows for the MRN | |

Not shown: `pasien.nip` (staff id, only for hospital employees).

### Contact (W12 / mockup 11)

| UI field | Source | Notes |
|---|---|---|
| Phone | `pasien.no_tlp` | **PHI, masked** — Khanza has **one** phone field (the earlier "home phone" was removed) |
| E-mail | `pasien.email` | **PHI, masked** |
| Address | `pasien.alamat` | **PHI, masked** |
| Village | `pasien.kd_kel` → `kelurahan.nm_kel` | lookup (kelurahan) |
| District | `pasien.kd_kec` → `kecamatan.nm_kec` | lookup (kecamatan) |
| City / regency | `pasien.kd_kab` → `kabupaten.nm_kab` | lookup |
| Province | `pasien.kd_prop` → `propinsi.nm_prop` | lookup |

Not in the schema, so **removed** from the design: postal code.

### Guarantor & Insurance (W13 / mockup 12)

| UI field | Source | Notes |
|---|---|---|
| Guarantor (default) | `pasien.kd_pj` → `penjab.png_jawab` | `penjab` = payer/guarantor |
| Membership no. | `pasien.no_peserta` | **PHI, masked** |
| Employer | `pasien.perusahaan_pasien` → `perusahaan_pasien.nama_perusahaan` | |
| Insurer phone | `penjab.no_telp` | often empty |
| Guarantor (this encounter) | `reg_periksa.kd_pj` → `penjab.png_jawab` | can differ from the default |
| SEP no. | `bridging_sep.no_sep` (by `no_rawat`) | **PHI, masked** |
| SEP date | `bridging_sep.tglsep` | |
| Service type | `bridging_sep.jnspelayanan` (`1`/`2`) | VClaim convention: 1 = inpatient, 2 = outpatient — confirm in the integration spec |
| BPJS class | `bridging_sep.klsrawat` (`1`,`2`,`3`) | the class the patient is entitled to on this SEP — **in Phase 1 (decided 2026-10-29)**; read from Khanza, no live VClaim call |
| Referral from | `bridging_sep.asal_rujukan` (`1. Faskes 1`, `2. Faskes 2(RS)`) | |
| Referrer | `bridging_sep.nmppkrujukan` | |
| Initial diagnosis | `bridging_sep.diagawal` + `nmdiagnosaawal` | |
| COB | `bridging_sep.cob` (`0. Tidak`/`1.Ya`) | |

Not in the schema, so **removed**: participant type, membership status and "last checked" (these exist only in BPJS VClaim
responses, not stored — the entitlement *class* is kept as "BPJS class" because Khanza stores it per SEP), "secondary insurance" and "patient share" (the latter is a billing figure — it belongs to the Billing tab,
which also avoids a duplicate).

### Family & Emergency (W14 / mockup 13)

Khanza models this as the **responsible person** ("penanggung jawab"), not as an emergency contact, and stores **no phone number** for them.

| UI field | Source | Notes |
|---|---|---|
| Name | `pasien.namakeluarga` | |
| Relationship | `pasien.keluarga` (`AYAH`,`IBU`,`ISTRI`,`SUAMI`,`SAUDARA`,`ANAK`) | |
| Occupation | `pasien.pekerjaanpj` | |
| Address | `pasien.alamatpj` | **PHI, masked** |
| Village / District / City / Province | `pasien.kelurahanpj`, `kecamatanpj`, `kabupatenpj`, `propinsipj` | **free text**, not lookups (unlike the patient's own address) |
| *This encounter:* name / relationship / address | `reg_periksa.p_jawab`, `hubunganpj`, `almt_pj` | the person who registered this visit |

## 3. English labels for enum values (decided 2026-10-29)

The UI shows these labels (English default; Indonesian translations go in `id.json`). The stored value never changes. Unknown or empty values show "—".

| Column | Stored value → English label |
|---|---|
| `pasien.jk` | `L` → Male · `P` → Female |
| `pasien.gol_darah` | `A` · `B` · `O` · `AB` (shown as is) · `-` → Unknown |
| `pasien.stts_nikah` | `BELUM MENIKAH` → Single · `JOMBLO` → Single · `MENIKAH` → Married · `JANDA` → Widowed / divorced · `DUDHA` → Widowed / divorced |
| `pasien.pnd` | `TS` → No schooling · `TK` → Kindergarten · `SD` → Primary school (SD) · `SMP` → Junior high (SMP) · `SMA` → Senior high (SMA) · `SLTA/SEDERAJAT` → Senior high or equivalent · `D1`…`D4` → Diploma 1 (D1)…Diploma 4 (D4) · `S1` → Bachelor's (S1) · `S2` → Master's (S2) · `S3` → Doctorate (S3) · `-` → Not recorded |
| `pasien.keluarga` | `AYAH` → Father · `IBU` → Mother · `SUAMI` → Husband · `ISTRI` → Wife · `SAUDARA` → Sibling · `ANAK` → Child |
| `bridging_sep.jnspelayanan` | `1` → Inpatient · `2` → Outpatient (VClaim convention — confirm in the integration spec) |
| `bridging_sep.klsrawat` | `1` → Class 1 · `2` → Class 2 · `3` → Class 3 |
| `bridging_sep.asal_rujukan` | `1. Faskes 1` → Primary care (Faskes 1) · `2. Faskes 2(RS)` → Hospital (Faskes 2) |
| `bridging_sep.cob` | `0. Tidak` → No · `1.Ya` → Yes |

Notes: `JANDA` and `DUDHA` both cover widowed *and* divorced in Khanza, so the English label cannot tell them apart; the two single
values are merged for the same reason. Free-text columns (religion, occupation, `hubunganpj`, names, addresses) are shown as stored.
Terms stay consistent with `docs/glossary.md` (OQ-13).

## 4. Issues found (for the product owner / hospital)

1. **No emergency-contact phone** anywhere in the patient record. If the hospital needs one, it is a gap in Khanza, not something the new
   platform can invent (a write-back would need an ADR).
2. **Latin-1 character set:** `pasien` and its lookups are `latin1`. Names with characters outside Latin-1 may already be damaged, and the
   event-streaming translators must decode them correctly before the profile projection (flag for `event-streaming`).
3. **Enum quirks:** `stts_nikah` contains both `JOMBLO` and `BELUM MENIKAH` and the misspelling `DUDHA`; `keluarga` has no value for "other".
   English labels are decided (§3); the merged values lose a distinction that Khanza itself does not store.
4. **Per-encounter vs per-patient:** guarantor and responsible person exist at both levels; the pages show the patient default and the
   current encounter separately so staff can see when they differ.
5. **BPJS class** is in Phase 1 (read from `bridging_sep.klsrawat`). **Membership validity/status** would need a live VClaim call — out of scope for the read-side projection unless that integration is approved.
6. **PHI masking list:** NIK, membership no., phone, e-mail, addresses (patient and responsible person), SEP no. — consistent with root `CLAUDE.md` rule 2.
