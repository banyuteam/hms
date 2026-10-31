-- Local dev container only: SELECT-only user, the same shape the DBA creates on the real replica.
CREATE USER IF NOT EXISTS 'cdc_reader'@'%' IDENTIFIED BY 'dev-reader-only';
GRANT SELECT ON `khanza_synthetic`.* TO 'cdc_reader'@'%';
