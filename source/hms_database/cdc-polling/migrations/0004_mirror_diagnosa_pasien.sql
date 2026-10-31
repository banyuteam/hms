-- 0004_mirror_diagnosa_pasien.sql
-- Mirror of Khanza `diagnosa_pasien` (visit diagnoses). Composite key (no_rawat, kd_penyakit, status).
-- Mapping: mappings/diagnosa_pasien.yaml.
-- Online-safe: yes. Rollback: DROP TABLE khanza_mirror.diagnosa_pasien;

BEGIN;

CREATE TABLE khanza_mirror.diagnosa_pasien (
    no_rawat        varchar(17)  NOT NULL,
    kd_penyakit     varchar(10)  NOT NULL,
    status          text         NOT NULL,
    prioritas       smallint,
    status_penyakit text,
    _cdc_row_hash   char(32)     NOT NULL,
    _cdc_synced_at  timestamptz  NOT NULL DEFAULT now(),
    _cdc_deleted_at timestamptz,
    PRIMARY KEY (no_rawat, kd_penyakit, status)
);
COMMENT ON TABLE khanza_mirror.diagnosa_pasien IS 'Mirror of Khanza diagnosa_pasien (written by cdc-polling only). PHI (diagnoses).';
COMMENT ON COLUMN khanza_mirror.diagnosa_pasien.no_rawat IS 'PHI: visit number.';
COMMENT ON COLUMN khanza_mirror.diagnosa_pasien.kd_penyakit IS 'PHI: ICD-10 diagnosis of the patient.';

COMMIT;
