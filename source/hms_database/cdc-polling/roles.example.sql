-- roles.example.sql — TEMPLATE, run by the DBA, not by the service. Replace the placeholder password
-- from your secret store; never commit a real one.
-- Gives the cdc-polling service write access to its own schemas only.

CREATE ROLE cdc_polling LOGIN PASSWORD '<from-secret-store>';
GRANT USAGE ON SCHEMA cdc, khanza_mirror TO cdc_polling;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cdc, khanza_mirror TO cdc_polling;
ALTER DEFAULT PRIVILEGES IN SCHEMA cdc, khanza_mirror GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cdc_polling;

-- Read-only role for consumers (event-streaming relay, web-datatooling).
CREATE ROLE khanza_mirror_reader NOLOGIN;
GRANT USAGE ON SCHEMA khanza_mirror, cdc TO khanza_mirror_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA khanza_mirror TO khanza_mirror_reader;
GRANT SELECT ON cdc.change_event TO khanza_mirror_reader;
