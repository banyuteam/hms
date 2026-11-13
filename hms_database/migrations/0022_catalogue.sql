-- 0022 catalogue: reference sources from outside HMS (web links and Excel, PDF, Word or image files) and the titles
-- of the data each one holds, browsed in the web Catalogue window (ADR-SVC-012).
--   sources       one entry per external source: title, type, publisher, description; the https URL of a link
--   data_titles   the titles of the data a source holds, in order
--   files         the stored file of a file-type source: its key on the shared hms_services file volume (namespace
--                 catalogue/), media type, size and SHA-256; uploads are malware-scanned before they are stored. The bytes are never in the database (shared-postgresql-platform: binary files outside
--                 relational tables, the database keeps the reference and the hash).
-- Owner: hms_database (definitions); writer: hms_services (hms_catalogue_rw), for holders of catalogue.manage; every
-- change is audited by hms_services. Classification: internal (reference material, no patient data: the upload form
-- says so; the database cannot check file contents).
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA catalogue;
COMMENT ON SCHEMA catalogue IS 'hms_database: reference sources from outside HMS and the titles of the data they hold';

CREATE TABLE catalogue.sources (
    id                  uuid        NOT NULL DEFAULT uuidv7(),
    organization_id     uuid        NOT NULL,
    title               text        NOT NULL,
    source_type         text        NOT NULL,
    publisher           text,
    description         text,
    url                 text,
    version             integer     NOT NULL DEFAULT 1,
    created_by_user_id  uuid        NOT NULL,
    updated_by_user_id  uuid        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_sources PRIMARY KEY (id),
    CONSTRAINT uq_sources_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT fk_sources_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_sources_created_by_user_id FOREIGN KEY (created_by_user_id, organization_id)
        REFERENCES iam.users (id, organization_id),
    CONSTRAINT fk_sources_updated_by_user_id FOREIGN KEY (updated_by_user_id, organization_id)
        REFERENCES iam.users (id, organization_id),
    CONSTRAINT ck_sources_title CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    CONSTRAINT ck_sources_source_type CHECK (source_type IN ('url', 'excel', 'pdf', 'word', 'image')),
    CONSTRAINT ck_sources_publisher CHECK (publisher IS NULL OR length(btrim(publisher)) BETWEEN 1 AND 200),
    CONSTRAINT ck_sources_description CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
    CONSTRAINT ck_sources_url CHECK ((source_type = 'url') = (url IS NOT NULL)),
    CONSTRAINT ck_sources_url_format CHECK (url IS NULL OR (url ~ '^https://[^[:space:]]+$' AND length(url) <= 2000)),
    CONSTRAINT ck_sources_version CHECK (version >= 1)
);
COMMENT ON TABLE catalogue.sources IS
    'External reference source (web link, Excel, PDF, Word or image) of one organization; no patient data';
COMMENT ON COLUMN catalogue.sources.source_type IS
    'url | excel | pdf | word | image; fixed at creation (the stored file must match it)';
COMMENT ON COLUMN catalogue.sources.url IS 'https link of a url-type source; null for every file type';
COMMENT ON COLUMN catalogue.sources.version IS 'Optimistic concurrency: an edit names the version it read';
CREATE INDEX idx_sources_organization_id_updated_at ON catalogue.sources (organization_id, updated_at DESC);
CREATE INDEX idx_sources_created_by_user_id ON catalogue.sources (created_by_user_id, organization_id);
CREATE INDEX idx_sources_updated_by_user_id ON catalogue.sources (updated_by_user_id, organization_id);

CREATE TABLE catalogue.data_titles (
    source_id  uuid    NOT NULL,
    position   integer NOT NULL,
    title      text    NOT NULL,
    CONSTRAINT pk_data_titles PRIMARY KEY (source_id, position),
    CONSTRAINT fk_data_titles_source_id FOREIGN KEY (source_id) REFERENCES catalogue.sources (id) ON DELETE CASCADE,
    CONSTRAINT ck_data_titles_position CHECK (position BETWEEN 1 AND 200),
    CONSTRAINT ck_data_titles_title CHECK (length(btrim(title)) BETWEEN 1 AND 300)
);
COMMENT ON TABLE catalogue.data_titles IS 'Titles of the data a source holds (e.g. sheets of a workbook), in order';

CREATE TABLE catalogue.files (
    source_id            uuid        NOT NULL,
    storage_key          text        NOT NULL,
    media_type           text        NOT NULL,
    size_bytes           bigint      NOT NULL,
    content_sha256       bytea       NOT NULL,
    uploaded_by_user_id  uuid        NOT NULL,
    uploaded_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_files PRIMARY KEY (source_id),
    CONSTRAINT uq_files_storage_key UNIQUE (storage_key),
    CONSTRAINT fk_files_source_id FOREIGN KEY (source_id) REFERENCES catalogue.sources (id) ON DELETE CASCADE,
    CONSTRAINT fk_files_uploaded_by_user_id FOREIGN KEY (uploaded_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_files_storage_key CHECK (storage_key ~
        '^catalogue/[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    CONSTRAINT ck_files_media_type CHECK (media_type IN (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg')),
    CONSTRAINT ck_files_size_bytes CHECK (size_bytes BETWEEN 1 AND 20971520),
    CONSTRAINT ck_files_content_sha256 CHECK (octet_length(content_sha256) = 32)
);
COMMENT ON TABLE catalogue.files IS
    'Stored file of a file-type source: key on the hms_services file volume, type from its bytes, size, SHA-256';
COMMENT ON COLUMN catalogue.files.storage_key IS
    'catalogue/yyyy/mm/<uuid> on the shared hms_services file volume; never the uploaded file name';
CREATE INDEX idx_files_uploaded_by_user_id ON catalogue.files (uploaded_by_user_id);

CREATE TRIGGER trg_sources_touch_updated_at BEFORE UPDATE ON catalogue.sources
    FOR EACH ROW EXECUTE FUNCTION hms_meta.touch_updated_at();

-- A stored file must be of its source's type: Excel = XLSX, Word = DOCX, PDF = PDF, image = PNG or JPEG; a link has
-- no file.
CREATE FUNCTION catalogue.check_file_type() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    kind text;
BEGIN
    SELECT s.source_type INTO kind FROM catalogue.sources s WHERE s.id = NEW.source_id;
    IF NOT (
        (kind = 'pdf' AND NEW.media_type = 'application/pdf') OR
        (kind = 'excel' AND NEW.media_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') OR
        (kind = 'word' AND NEW.media_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') OR
        (kind = 'image' AND NEW.media_type IN ('image/png', 'image/jpeg'))
    ) THEN
        RAISE EXCEPTION 'file type % does not match source type %', NEW.media_type, coalesce(kind, '<none>')
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION catalogue.check_file_type() FROM PUBLIC;
CREATE TRIGGER trg_files_check_type BEFORE INSERT OR UPDATE ON catalogue.files
    FOR EACH ROW EXECUTE FUNCTION catalogue.check_file_type();

GRANT USAGE ON SCHEMA catalogue TO hms_catalogue_rw;
GRANT SELECT, INSERT, DELETE ON catalogue.sources, catalogue.data_titles, catalogue.files TO hms_catalogue_rw;
GRANT UPDATE (title, publisher, description, url, version, updated_by_user_id) ON catalogue.sources TO hms_catalogue_rw;
GRANT UPDATE (storage_key, media_type, size_bytes, content_sha256, uploaded_by_user_id, uploaded_at)
    ON catalogue.files TO hms_catalogue_rw;
