# Khanza → PostgreSQL mapping (cdc-polling mirror)

Source structure verified against `docs/references/khanza-schema/rsb221022021.sql`. The authoritative,
machine-read mapping is `source/hms_services/cdc-polling/mappings/<table>.yaml`; keep this file in step.
PHI columns are marked in the DDL comments.

## pasien → khanza_mirror.pasien (key `no_rkm_medis`, keyset ranges)

| Source column (MariaDB) | Mirror column | Note |
|---|---|---|
| no_rkm_medis varchar(15) | no_rkm_medis varchar(15) | PK, PHI (MRN) |
| nm_pasien varchar(100) | nm_pasien varchar(100) | PHI |
| no_ktp varchar(20) | no_ktp varchar(20) | PHI (NIK) |
| jk enum | jk text | |
| tmp_lahir varchar(15) | tmp_lahir varchar(15) | PHI |
| tgl_lahir date | tgl_lahir date | PHI; `0000-00-00` → NULL |
| nm_ibu varchar(40) | nm_ibu varchar(40) | PHI |
| alamat varchar(200) | alamat varchar(200) | PHI |
| gol_darah enum, stts_nikah enum | text | |
| agama varchar(12) | agama varchar(12) | |
| tgl_daftar date | tgl_daftar date | `0000-00-00` → NULL |
| no_tlp varchar(40) | no_tlp varchar(40) | PHI |
| kd_pj char(3) | kd_pj char(3) | |
| no_peserta varchar(25) | no_peserta varchar(25) | PHI (BPJS card) |
| kd_kel, kd_kec, kd_kab, kd_prop int | integer | |

Not copied (minimisation): pekerjaan, umur, pnd, keluarga, namakeluarga, all `*pj` columns,
perusahaan_pasien, suku_bangsa, bahasa_pasien, cacat_fisik, email, nip.

## reg_periksa → khanza_mirror.reg_periksa (key `no_rawat`, keyset ranges)

| Source column | Mirror column | Note |
|---|---|---|
| no_rawat varchar(17) | no_rawat varchar(17) | PK, PHI |
| no_reg varchar(8) | no_reg varchar(8) | |
| tgl_registrasi date, jam_reg time | date, time | |
| kd_dokter varchar(20), kd_poli char(5), kd_pj char(3) | same | |
| no_rkm_medis varchar(15) | no_rkm_medis varchar(15) | PHI |
| biaya_reg double | biaya_reg numeric | raw; translators convert to integer Rupiah |
| stts, stts_daftar, status_lanjut, sttsumur, status_bayar, status_poli enum | text | |
| umurdaftar int | integer | |

Not copied: p_jawab, almt_pj, hubunganpj.

## diagnosa_pasien → khanza_mirror.diagnosa_pasien (key `no_rawat, kd_penyakit, status`)

| Source column | Mirror column | Note |
|---|---|---|
| no_rawat varchar(17) | no_rawat varchar(17) | PK part, PHI |
| kd_penyakit varchar(10) | kd_penyakit varchar(10) | PK part, PHI (diagnosis) |
| status enum('Ralan','Ranap') | status text | PK part; ENUM key compared as text (`key.enum_columns`) |
| prioritas tinyint | prioritas smallint | |
| status_penyakit enum | status_penyakit text | |
