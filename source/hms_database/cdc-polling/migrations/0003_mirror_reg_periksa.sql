-- 0003_mirror_reg_periksa.sql
-- Mirror of Khanza `reg_periksa` (visit / encounter registration). Mapping: mappings/reg_periksa.yaml.
-- biaya_reg is a MariaDB double; kept as numeric here (raw mirror). Translators convert to integer Rupiah.
-- Online-safe: yes. Rollback: DROP TABLE khanza_mirror.reg_periksa;

BEGIN;

CREATE TABLE khanza_mirror.reg_periksa (
    no_rawat        varchar(17)  NOT NULL,
    no_reg          varchar(8),
    tgl_registrasi  date,
    jam_reg         time,
    kd_dokter       varchar(20),
    no_rkm_medis    varchar(15),
    kd_poli         char(5),
    biaya_reg       numeric,
    stts            text,
    stts_daftar     text,
    status_lanjut   text,
    kd_pj           char(3),
    umurdaftar      integer,
    sttsumur        text,
    status_bayar    text,
    status_poli     text,
    _cdc_row_hash   char(32)     NOT NULL,
    _cdc_synced_at  timestamptz  NOT NULL DEFAULT now(),
    _cdc_deleted_at timestamptz,
    PRIMARY KEY (no_rawat)
);
COMMENT ON TABLE khanza_mirror.reg_periksa IS 'Mirror of Khanza reg_periksa (written by cdc-polling only). PHI.';
COMMENT ON COLUMN khanza_mirror.reg_periksa.no_rawat IS 'PHI: visit number.';
COMMENT ON COLUMN khanza_mirror.reg_periksa.no_rkm_medis IS 'PHI: medical record number (MRN).';
CREATE INDEX reg_periksa_no_rkm_medis_idx ON khanza_mirror.reg_periksa (no_rkm_medis);

COMMIT;
