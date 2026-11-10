-- 0021 layer separation: the native transaction layer and the legacy bridge write the same canonical records, and the
-- database decides per organization and domain which of the two may (ADR-ROOT-002, ADR-DB-006).
--   record_domains, record_domain_tables  the domain each canonical record table belongs to
--   domain_authority                       per organization and domain: legacy (only the bridge writes), cutover
--                                          (nobody writes) or native (only the native layer writes)
--   record_origin + layer guard            on every canonical record table: which layer created the row, and a
--                                          trigger that refuses a writer without the domain's authority
--   bridge_issues                          rejected and partially mapped legacy rows, legacy changes after cutover
--   legacy_record_links.mapping_version    the mapping version that produced a linked record; the active-link
--                                          rule becomes per organization (fix to 0016)
--   urn:hms:id:mrn                         the organization's medical record number as a patient identifier system
-- The legacy bridge is the members of hms_legacy_bridge (bootstrap): its own login, never the runtime's. Bridge
-- state (crosswalk, polling cursors, leases, runs, issues) is written by the bridge only; the runtime keeps SELECT.
-- Owner: hms_database. domain_authority is changed by the owner only, through the cutover procedure in
-- documentation/operations/RUNBOOK.md. Classification: internal (registry, authority); confidential (bridge_issues:
-- legacy business keys, no values).
-- Online-safe: the new column has a constant default (no table rewrite). Afterwards every write to a record table
-- needs a domain_authority row for its organization (none exist yet: no environment holds clinical records).
-- Rollback: fix forward.

-- Domains --------------------------------------------------------------------------------------------------------

CREATE TABLE integration.record_domains (
    code  text NOT NULL,
    name  text NOT NULL,
    CONSTRAINT pk_record_domains PRIMARY KEY (code),
    CONSTRAINT ck_record_domains_code CHECK (code ~ '^[a-z][a-z0-9-]{1,39}$'),
    CONSTRAINT ck_record_domains_name CHECK (length(btrim(name)) BETWEEN 1 AND 200)
);
COMMENT ON TABLE integration.record_domains IS
    'Unit of cutover: a set of record tables whose authority moves from the legacy bridge to the native layer together';

CREATE TABLE integration.record_domain_tables (
    table_name  text NOT NULL,
    domain      text NOT NULL,
    CONSTRAINT pk_record_domain_tables PRIMARY KEY (table_name),
    CONSTRAINT fk_record_domain_tables_domain FOREIGN KEY (domain) REFERENCES integration.record_domains (code),
    CONSTRAINT ck_record_domain_tables_table_name CHECK (table_name ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);
COMMENT ON TABLE integration.record_domain_tables IS
    'Domain of each canonical record table (schema.table); a child table belongs to its parent''s domain';

INSERT INTO integration.record_domains (code, name) VALUES
    ('patient',                   'Patient identity and demographics'),
    ('consent',                   'Patient consent'),
    ('workforce',                 'Practitioners and their roles'),
    ('encounter',                 'Encounters (visits, admissions) and their diagnoses'),
    ('condition',                 'Conditions and problems'),
    ('allergy',                   'Allergies and intolerances'),
    ('observation',               'Observations (vital signs, results, assessments)'),
    ('procedure',                 'Procedures'),
    ('diagnostic-report',         'Diagnostic reports'),
    ('medication',                'Medication definitions'),
    ('medication-request',        'Prescriptions and medication orders'),
    ('medication-dispense',       'Medication dispensing'),
    ('medication-administration', 'Medication administration'),
    ('medication-statement',      'Medication statements'),
    ('composition',               'Clinical documents'),
    ('imaging',                   'Imaging studies and series');

-- Authority ------------------------------------------------------------------------------------------------------

SELECT hms_meta.create_version_store('integration');

CREATE TABLE integration.domain_authority (
    id                  uuid        NOT NULL DEFAULT uuidv7(),
    organization_id     uuid        NOT NULL,
    domain              text        NOT NULL,
    authority           text        NOT NULL,
    effective_at        timestamptz NOT NULL DEFAULT now(),
    decision_reference  text        NOT NULL,
    version             integer     NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    last_xact_id        xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_domain_authority PRIMARY KEY (id),
    CONSTRAINT uq_domain_authority_organization_id_domain UNIQUE (organization_id, domain),
    CONSTRAINT fk_domain_authority_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_domain_authority_domain FOREIGN KEY (domain) REFERENCES integration.record_domains (code),
    CONSTRAINT ck_domain_authority_authority CHECK (authority IN ('legacy', 'cutover', 'native')),
    CONSTRAINT ck_domain_authority_decision_reference CHECK (length(btrim(decision_reference)) BETWEEN 1 AND 200)
);
COMMENT ON TABLE integration.domain_authority IS
    'Who may write a domain''s records for an organization: legacy (bridge only), cutover (nobody), native (native layer only)';
COMMENT ON COLUMN integration.domain_authority.effective_at IS 'When the current authority took effect (set by the database)';
COMMENT ON COLUMN integration.domain_authority.decision_reference IS 'Approval of the change (cutover plan, change ticket); no PHI';

-- Allowed moves: legacy -> cutover -> native, and cutover -> legacy to abort. native is final: records created
-- natively do not exist in the legacy HMS, so handing the domain back would split it. Every change needs a reason.
CREATE FUNCTION integration.check_domain_authority() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.authority = 'cutover' THEN
            RAISE EXCEPTION 'a domain starts as legacy or native, not cutover' USING ERRCODE = '23514';
        END IF;
        NEW.effective_at := now();
        RETURN NEW;
    END IF;
    IF NEW.authority IS NOT DISTINCT FROM OLD.authority THEN
        NEW.effective_at := OLD.effective_at;
        RETURN NEW;
    END IF;
    IF (OLD.authority, NEW.authority) NOT IN (('legacy', 'cutover'), ('cutover', 'legacy'), ('cutover', 'native')) THEN
        RAISE EXCEPTION 'authority of domain % cannot move from % to %', OLD.domain, OLD.authority, NEW.authority
            USING ERRCODE = '23514';
    END IF;
    IF nullif(btrim(current_setting('hms.change_reason', true)), '') IS NULL THEN
        RAISE EXCEPTION 'set hms.change_reason to change the authority of domain %', OLD.domain;
    END IF;
    NEW.effective_at := now();
    RETURN NEW;
END
$$;
COMMENT ON FUNCTION integration.check_domain_authority() IS
    'Authority moves legacy -> cutover -> native (or cutover -> legacy), with a reason; native is final';

CREATE TRIGGER trg_domain_authority_check BEFORE INSERT OR UPDATE ON integration.domain_authority
    FOR EACH ROW EXECUTE FUNCTION integration.check_domain_authority();
SELECT hms_meta.enable_versioned_record('integration.domain_authority', 'DomainAuthority', NULL, 'id,organization_id,domain');

-- Layer guard ----------------------------------------------------------------------------------------------------

-- BEFORE INSERT OR UPDATE on every canonical record table (installed by hms_meta.enable_record_domain).
-- The writer is the legacy bridge when the current role is a member of hms_legacy_bridge (a superuser counts as the
-- bridge only when it declares hms.actor_service = legacy-bridge), else the native layer. Rules:
--   1. hms.actor_service = legacy-bridge is reserved to the bridge, and the bridge always declares it.
--   2. The writer must hold the authority of the table's domain for the row's organization (SQLSTATE HM001).
--   3. record_origin is set on insert to the writer and never changes.
-- Rows caused by another record trigger (a child touching its parent) were checked at their own table. A row of
-- another tenant is left to row-level security, which refuses it.
CREATE FUNCTION hms_meta.guard_record_layer() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    svc        text := nullif(current_setting('hms.actor_service', true), '');
    is_bridge  boolean;
    writer     text;
    dom        text;
    auth       text;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;
    IF NEW.organization_id IS DISTINCT FROM nullif(current_setting('hms.organization_id', true), '')::uuid THEN
        RETURN NEW;
    END IF;

    IF (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user) THEN
        is_bridge := svc IS NOT DISTINCT FROM 'legacy-bridge';
    ELSE
        is_bridge := pg_has_role(current_user, 'hms_legacy_bridge', 'MEMBER');
    END IF;
    IF is_bridge <> (svc IS NOT DISTINCT FROM 'legacy-bridge') THEN
        RAISE EXCEPTION 'actor service legacy-bridge is reserved to the legacy bridge role, which must declare it'
            USING ERRCODE = '42501';
    END IF;
    writer := CASE WHEN is_bridge THEN 'legacy' ELSE 'native' END;

    SELECT d.domain, a.authority INTO dom, auth
    FROM integration.record_domain_tables d
    LEFT JOIN integration.domain_authority a ON a.domain = d.domain AND a.organization_id = NEW.organization_id
    WHERE d.table_name = TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
    IF dom IS NULL THEN
        RAISE EXCEPTION '%.% is not registered in a record domain', TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;
    IF auth IS DISTINCT FROM writer THEN
        RAISE EXCEPTION 'domain % is % for this organization; the % layer cannot write %.%',
            dom, coalesce(auth, 'not assigned'), writer, TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = 'HM001',
                  HINT = 'Domain authority changes only through the cutover procedure (integration.domain_authority).';
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.record_origin := writer;
    ELSIF NEW.record_origin IS DISTINCT FROM OLD.record_origin THEN
        RAISE EXCEPTION '%.%: record_origin cannot change', TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END
$$;
COMMENT ON FUNCTION hms_meta.guard_record_layer() IS
    'Refuses a write by a layer (legacy bridge or native) that does not hold the domain''s authority; stamps record_origin';

-- Migration helper: puts a record table into a domain, adds record_origin and installs the layer guard. Every table
-- made a versioned record in patient, workforce, clinical or imaging must also be given a domain (governance test).
CREATE FUNCTION hms_meta.enable_record_domain(p_table regclass, p_domain text) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    sch text;
    t   text;
BEGIN
    SELECT n.nspname, c.relname INTO sch, t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = p_table;
    INSERT INTO integration.record_domain_tables (table_name, domain) VALUES (sch || '.' || t, p_domain);
    EXECUTE format('ALTER TABLE %s ADD COLUMN record_origin text NOT NULL DEFAULT %L', p_table, 'native');
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (record_origin IN (%L, %L))',
                   p_table, 'ck_' || t || '_record_origin', 'native', 'legacy');
    EXECUTE format('COMMENT ON COLUMN %s.record_origin IS %L', p_table,
                   'Layer that created the row: native (HMS) or legacy (mapped from the legacy HMS by the bridge)');
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION hms_meta.guard_record_layer()',
                   'trg_' || t || '_layer', p_table);
END
$$;
COMMENT ON FUNCTION hms_meta.enable_record_domain(regclass, text) IS
    'Migration helper: domain registration, record_origin column and layer guard for a record table';

SELECT hms_meta.enable_record_domain(t.tbl::regclass, t.domain)
FROM (VALUES
    ('patient.patients', 'patient'), ('patient.identifiers', 'patient'), ('patient.names', 'patient'),
    ('patient.telecoms', 'patient'), ('patient.addresses', 'patient'), ('patient.contacts', 'patient'),
    ('patient.links', 'patient'),
    ('patient.consents', 'consent'),
    ('workforce.practitioners', 'workforce'), ('workforce.practitioner_identifiers', 'workforce'),
    ('workforce.practitioner_roles', 'workforce'),
    ('clinical.encounters', 'encounter'), ('clinical.encounter_status_history', 'encounter'),
    ('clinical.encounter_participants', 'encounter'), ('clinical.encounter_locations', 'encounter'),
    ('clinical.encounter_diagnoses', 'encounter'),
    ('clinical.conditions', 'condition'),
    ('clinical.allergy_intolerances', 'allergy'), ('clinical.allergy_reactions', 'allergy'),
    ('clinical.observations', 'observation'), ('clinical.observation_components', 'observation'),
    ('clinical.procedures', 'procedure'), ('clinical.procedure_performers', 'procedure'),
    ('clinical.diagnostic_reports', 'diagnostic-report'), ('clinical.diagnostic_report_results', 'diagnostic-report'),
    ('clinical.medications', 'medication'), ('clinical.medication_ingredients', 'medication'),
    ('clinical.medication_requests', 'medication-request'),
    ('clinical.medication_dispenses', 'medication-dispense'),
    ('clinical.medication_administrations', 'medication-administration'),
    ('clinical.medication_statements', 'medication-statement'),
    ('clinical.compositions', 'composition'), ('clinical.composition_authors', 'composition'),
    ('clinical.composition_sections', 'composition'), ('clinical.composition_section_entries', 'composition'),
    ('imaging.studies', 'imaging'), ('imaging.series', 'imaging')
) AS t(tbl, domain);

-- Bridge issues --------------------------------------------------------------------------------------------------

CREATE TABLE integration.bridge_issues (
    id                 uuid        NOT NULL DEFAULT uuidv7(),
    organization_id    uuid        NOT NULL,
    source_system      text        NOT NULL,
    source_entity      text        NOT NULL,
    source_key         text        NOT NULL,
    source_field       text        NOT NULL DEFAULT '',
    kind               text        NOT NULL,
    reason_code        text        NOT NULL,
    mapping_version    text        NOT NULL,
    source_row_sha256  bytea,
    status             text        NOT NULL DEFAULT 'open',
    first_seen_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    seen_count         integer     NOT NULL DEFAULT 1,
    closed_at          timestamptz,
    closed_by_user_id  uuid,
    close_note         text,
    CONSTRAINT pk_bridge_issues PRIMARY KEY (id),
    CONSTRAINT fk_bridge_issues_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_bridge_issues_source_system FOREIGN KEY (source_system) REFERENCES integration.external_systems (code),
    CONSTRAINT fk_bridge_issues_closed_by_user_id FOREIGN KEY (closed_by_user_id) REFERENCES iam.users (id),
    CONSTRAINT ck_bridge_issues_source_entity CHECK (source_entity ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_bridge_issues_source_key CHECK (length(source_key) BETWEEN 1 AND 200),
    CONSTRAINT ck_bridge_issues_source_field CHECK (source_field ~ '^([a-z][a-z0-9_]{0,63})?$'),
    -- rejected: the row was not written; partial: written without the field; not_applied: the legacy row changed
    -- after its domain left legacy authority, so the change was not applied.
    CONSTRAINT ck_bridge_issues_kind CHECK (kind IN ('rejected', 'partial', 'not_applied')),
    CONSTRAINT ck_bridge_issues_reason_code CHECK (reason_code ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT ck_bridge_issues_mapping_version CHECK (mapping_version ~ '^[a-z][a-z0-9_.-]{0,63}/[0-9]{1,6}$'),
    CONSTRAINT ck_bridge_issues_sha256 CHECK (octet_length(source_row_sha256) = 32),
    -- resolved: the cause went away (set by the bridge) or was fixed; accepted: a steward accepts it as it is.
    CONSTRAINT ck_bridge_issues_status CHECK (status IN ('open', 'resolved', 'accepted')),
    CONSTRAINT ck_bridge_issues_closed CHECK ((status = 'open') = (closed_at IS NULL)),
    CONSTRAINT ck_bridge_issues_accepted CHECK (status <> 'accepted' OR (closed_by_user_id IS NOT NULL AND close_note IS NOT NULL)),
    CONSTRAINT ck_bridge_issues_close_note CHECK (length(btrim(close_note)) BETWEEN 1 AND 500),
    CONSTRAINT ck_bridge_issues_seen CHECK (seen_count >= 1 AND last_seen_at >= first_seen_at)
);
COMMENT ON TABLE integration.bridge_issues IS
    'Legacy rows the bridge could not map fully, and legacy changes after cutover; keys and reason codes only, never values';
COMMENT ON COLUMN integration.bridge_issues.source_field IS 'Legacy column concerned; empty when the whole row is concerned';
CREATE UNIQUE INDEX uq_bridge_issues_open ON integration.bridge_issues
    (organization_id, source_system, source_entity, source_key, reason_code, source_field) WHERE status = 'open';
CREATE INDEX idx_bridge_issues_status ON integration.bridge_issues (organization_id, status, last_seen_at);
CREATE TRIGGER trg_bridge_issues_no_delete BEFORE DELETE ON integration.bridge_issues
    FOR EACH ROW EXECUTE FUNCTION hms_meta.refuse_change();
SELECT hms_meta.enable_tenant_rls('integration.bridge_issues');

-- Crosswalk: the mapping that produced the record --------------------------------------------------------------

-- Fix to 0016: the active-link rule must be per organization. Legacy keys (e.g. MRN 000001) repeat across
-- organizations, and a global rule would also reveal through a unique violation that another tenant holds a key.
DROP INDEX integration.uq_legacy_record_links_active;
CREATE UNIQUE INDEX uq_legacy_record_links_active ON integration.legacy_record_links
    (organization_id, source_system, source_entity, source_key, resource_type) WHERE status = 'linked';

ALTER TABLE integration.legacy_record_links ADD COLUMN mapping_version text;
ALTER TABLE integration.legacy_record_links ADD CONSTRAINT ck_legacy_record_links_mapping_version
    CHECK (mapping_version ~ '^[a-z][a-z0-9_.-]{0,63}/[0-9]{1,6}$');
COMMENT ON COLUMN integration.legacy_record_links.mapping_version IS
    'Mapping (name/version) that last wrote the linked record, e.g. legacy-hms.pasien/1';

-- Identifier system ----------------------------------------------------------------------------------------------

-- The organization's medical record number. Unique per organization (partial index on patient.identifiers). Format
-- as the legacy HMS stores it (no_rkm_medis); a native allocation format is an open owner decision (ADR-ROOT-002).
INSERT INTO terminology.identifier_systems (uri, name, applies_to, kind, value_pattern, excluded_values, unique_value, sensitivity)
VALUES ('urn:hms:id:mrn', 'Nomor rekam medis (organization medical record number)', ARRAY['Patient'],
        'medical_record_number', '^[A-Za-z0-9.-]{1,15}$', '{}', true, 'confidential');

-- Privileges -----------------------------------------------------------------------------------------------------

-- The guard runs as the writer, which reads the domain registry and its own organization's authority.
GRANT USAGE ON SCHEMA integration TO hms_workforce_rw, hms_patient_rw, hms_clinical_rw, hms_legacy_bridge;
GRANT SELECT ON integration.record_domains, integration.record_domain_tables, integration.domain_authority
    TO hms_workforce_rw, hms_patient_rw, hms_clinical_rw, hms_integration_rw, hms_legacy_bridge;

-- Bridge state belongs to the bridge; the native runtime only reads it.
REVOKE INSERT, UPDATE, DELETE ON integration.poll_checkpoints, integration.poll_leases, integration.sync_runs
    FROM hms_integration_rw;
REVOKE INSERT ON integration.legacy_record_links FROM hms_integration_rw;
REVOKE UPDATE (last_observed_at, source_row_sha256, status, status_reason) ON integration.legacy_record_links
    FROM hms_integration_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON integration.poll_checkpoints, integration.poll_leases, integration.sync_runs
    TO hms_legacy_bridge;
GRANT SELECT ON integration.external_systems TO hms_legacy_bridge;
GRANT SELECT, INSERT ON integration.legacy_record_links, integration.bridge_issues TO hms_legacy_bridge;
GRANT UPDATE (last_observed_at, source_row_sha256, status, status_reason, mapping_version)
    ON integration.legacy_record_links TO hms_legacy_bridge;
GRANT UPDATE (last_seen_at, seen_count, source_row_sha256, mapping_version, status, closed_at)
    ON integration.bridge_issues TO hms_legacy_bridge;
-- Data stewards close issues through hms_services.
GRANT SELECT ON integration.bridge_issues TO hms_integration_rw;
GRANT UPDATE (status, closed_at, closed_by_user_id, close_note) ON integration.bridge_issues TO hms_integration_rw;

-- What the bridge reads besides its own state: identifier and code system rules (identifier triggers run as the
-- writer) and the organization/facility it serves.
GRANT USAGE ON SCHEMA terminology, platform TO hms_legacy_bridge;
GRANT SELECT ON terminology.identifier_systems, terminology.code_systems TO hms_legacy_bridge;
GRANT SELECT ON platform.organizations, platform.facilities TO hms_legacy_bridge;
