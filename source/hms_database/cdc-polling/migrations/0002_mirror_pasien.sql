-- 0002_mirror_pasien.sql
-- Mirror of Khanza `pasien` (patient master). Mapping: mappings/pasien.yaml in cdc-polling.
-- Only the columns listed in the mapping are copied (data minimisation).
-- Online-safe: yes. Rollback: DROP TABLE khanza_mirror.pasien;

BEGIN;

CREATE TABLE khanza_mirror.pasien (
    no_rkm_medis    varchar(15)  NOT NULL,
    nm_pasien       varchar(100),
    no_ktp          varchar(20),
    jk              text,
    tmp_lahir       varchar(15),
    tgl_lahir       date,
    nm_ibu          varchar(40),
    alamat          varchar(200),
    gol_darah       text,
    stts_nikah      text,
    agama           varchar(12),
    tgl_daftar      date,
    no_tlp          varchar(40),
    kd_pj           char(3),
    no_peserta      varchar(25),
    kd_kel          integer,
    kd_kec          integer,
    kd_kab          integer,
    kd_prop         integer,
    _cdc_row_hash   char(32)     NOT NULL,
    _cdc_synced_at  timestamptz  NOT NULL DEFAULT now(),
    _cdc_deleted_at timestamptz,
    PRIMARY KEY (no_rkm_medis)
);
COMMENT ON TABLE khanza_mirror.pasien IS 'Mirror of Khanza pasien (written by cdc-polling only). PHI.';
COMMENT ON COLUMN khanza_mirror.pasien.no_rkm_medis IS 'PHI: medical record number (MRN).';
COMMENT ON COLUMN khanza_mirror.pasien.nm_pasien IS 'PHI: patient name.';
COMMENT ON COLUMN khanza_mirror.pasien.no_ktp IS 'PHI (high): NIK. Encrypt at rest if the PRD requires.';
COMMENT ON COLUMN khanza_mirror.pasien.tgl_lahir IS 'PHI: date of birth.';
COMMENT ON COLUMN khanza_mirror.pasien.nm_ibu IS 'PHI: mother''s name.';
COMMENT ON COLUMN khanza_mirror.pasien.alamat IS 'PHI: address.';
COMMENT ON COLUMN khanza_mirror.pasien.no_tlp IS 'PHI: phone number.';
COMMENT ON COLUMN khanza_mirror.pasien.no_peserta IS 'PHI (high): BPJS card number. Encrypt at rest if the PRD requires.';
COMMENT ON COLUMN khanza_mirror.pasien._cdc_row_hash IS 'MD5 of the mapped source columns, computed by MariaDB.';
COMMENT ON COLUMN khanza_mirror.pasien._cdc_deleted_at IS 'Set when the row disappeared from Khanza (soft delete).';

COMMIT;
