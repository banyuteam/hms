-- 0010 patient: master patient index (identity, names, identifiers, contact points, addresses, related persons,
-- links between duplicate records) and consent (schema patient, ADR-DB-004). Maps to FHIR Patient and Consent and to
-- the identity variables of Kepmenkes HK.01.07/MENKES/1423/2022 (Permenkes 24/2022 Pasal 14: at least medical record
-- number, name and NIK; social data at least religion, occupation, education and marital status).
-- Owner: hms_database (definitions); writes: hms_services patient module (hms_patient_rw); reads: hms_services.
-- Classification: restricted (identity of patients, specific personal data under UU 27/2022 Pasal 4).
-- Native HMS data: no foreign key or column mirrors the legacy Khanza tables. Khanza keys are linked through
-- integration.legacy_record_links (0016); the hospital MRN is an ordinary identifier with its own system.
-- Versioned records (ADR-DB-005): changes kept in patient.resource_versions with actor and reason; rows are never
-- deleted (a wrong part is deactivated, a wrong record is marked inactive and linked); tenant row-level security.
-- Online-safe: creates new objects only. Rollback: fix forward.

CREATE SCHEMA patient;
COMMENT ON SCHEMA patient IS 'hms_database: patient identity (master patient index) and consent';

SELECT hms_meta.create_version_store('patient');

CREATE TABLE patient.patients (
    id                     uuid        NOT NULL DEFAULT uuidv7(),
    organization_id        uuid        NOT NULL,
    active                 boolean     NOT NULL DEFAULT true,
    administrative_gender  text        NOT NULL,
    gender_system          text,
    gender_code            text,
    birth_date             date,
    birth_date_estimated   boolean     NOT NULL DEFAULT false,
    birth_place            text,
    deceased               boolean     NOT NULL DEFAULT false,
    deceased_at            timestamptz,
    multiple_birth_order   smallint,
    marital_status_system  text,
    marital_status_code    text,
    religion_system        text,
    religion_code          text,
    religion_text          text,
    education_system       text,
    education_code         text,
    occupation_system      text,
    occupation_code        text,
    occupation_text        text,
    nationality_code       text,
    preferred_language     text,
    version                integer     NOT NULL DEFAULT 1,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    last_xact_id           xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_patients PRIMARY KEY (id),
    CONSTRAINT uq_patients_id_organization_id UNIQUE (id, organization_id),
    CONSTRAINT fk_patients_organization_id FOREIGN KEY (organization_id) REFERENCES platform.organizations (id),
    CONSTRAINT fk_patients_gender_system FOREIGN KEY (gender_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_patients_marital_status_system FOREIGN KEY (marital_status_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_patients_religion_system FOREIGN KEY (religion_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_patients_education_system FOREIGN KEY (education_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT fk_patients_occupation_system FOREIGN KEY (occupation_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 AdministrativeGender (SATUSEHAT Patient.gender).
    CONSTRAINT ck_patients_administrative_gender CHECK (administrative_gender IN ('male', 'female', 'other', 'unknown')),
    CONSTRAINT ck_patients_gender CHECK ((gender_system IS NULL) = (gender_code IS NULL) AND length(gender_code) <= 20),
    CONSTRAINT ck_patients_birth_place CHECK (length(btrim(birth_place)) BETWEEN 1 AND 200),
    CONSTRAINT ck_patients_deceased CHECK (deceased OR deceased_at IS NULL),
    CONSTRAINT ck_patients_multiple_birth_order CHECK (multiple_birth_order BETWEEN 1 AND 20),
    CONSTRAINT ck_patients_marital_status CHECK ((marital_status_system IS NULL) = (marital_status_code IS NULL) AND length(marital_status_code) <= 20),
    CONSTRAINT ck_patients_religion CHECK ((religion_system IS NULL) = (religion_code IS NULL) AND length(religion_code) <= 20),
    CONSTRAINT ck_patients_religion_text CHECK (length(btrim(religion_text)) BETWEEN 1 AND 100),
    CONSTRAINT ck_patients_education CHECK ((education_system IS NULL) = (education_code IS NULL) AND length(education_code) <= 20),
    CONSTRAINT ck_patients_occupation CHECK ((occupation_system IS NULL) = (occupation_code IS NULL) AND length(occupation_code) <= 20),
    CONSTRAINT ck_patients_occupation_text CHECK (length(btrim(occupation_text)) BETWEEN 1 AND 100),
    -- ISO 3166-1 alpha-2 (urn:iso:std:iso:3166).
    CONSTRAINT ck_patients_nationality_code CHECK (nationality_code ~ '^[A-Z]{2}$'),
    -- BCP 47 language tag, e.g. id, jv, en.
    CONSTRAINT ck_patients_preferred_language CHECK (preferred_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);
COMMENT ON TABLE patient.patients IS
    'Patient (FHIR Patient) of one organization; demographics coded by bound value sets (Kepmenkes 1423/2022)';
COMMENT ON COLUMN patient.patients.administrative_gender IS 'FHIR AdministrativeGender used for exchange (SATUSEHAT)';
COMMENT ON COLUMN patient.patients.gender_code IS 'Recorded jenis kelamin per the bound national value set (Kepmenkes 1423: 0-4)';
COMMENT ON COLUMN patient.patients.birth_date_estimated IS 'true when the birth date was estimated (e.g. only the age is known)';
COMMENT ON COLUMN patient.patients.religion_text IS 'Free text when the religion code means "lain-lain" (Kepmenkes 1423)';
COMMENT ON COLUMN patient.patients.occupation_text IS 'Free text when the occupation code means "lain-lain" (Kepmenkes 1423)';
CREATE INDEX idx_patients_birth_date ON patient.patients (organization_id, birth_date);

-- Identifiers: NIK, NIK ibu (newborns), IHS number, hospital medical record number, passport/KITAS, BPJS member
-- number, legacy keys. One value of a unique system identifies at most one active patient per organization.
CREATE TABLE patient.identifiers (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    organization_id      uuid        NOT NULL,
    patient_id           uuid        NOT NULL,
    system_uri           text        NOT NULL,
    value                text        NOT NULL,
    use                  text        NOT NULL DEFAULT 'official',
    period_start         date,
    period_end           date,
    verified_at          timestamptz,
    verification_source  text,
    active               boolean     NOT NULL DEFAULT true,
    unique_value         boolean     NOT NULL DEFAULT false,
    version              integer     NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    last_xact_id         xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_identifiers PRIMARY KEY (id),
    CONSTRAINT fk_identifiers_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_identifiers_system_uri FOREIGN KEY (system_uri) REFERENCES terminology.identifier_systems (uri),
    CONSTRAINT ck_identifiers_value CHECK (length(value) BETWEEN 1 AND 100 AND value = btrim(value)),
    -- FHIR R4 IdentifierUse.
    CONSTRAINT ck_identifiers_use CHECK (use IN ('usual', 'official', 'temp', 'secondary', 'old')),
    CONSTRAINT ck_identifiers_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
    CONSTRAINT ck_identifiers_verification CHECK ((verified_at IS NULL) = (verification_source IS NULL)),
    CONSTRAINT ck_identifiers_verification_source CHECK (verification_source ~ '^[a-z][a-z0-9_.-]{0,63}$')
);
COMMENT ON TABLE patient.identifiers IS 'Patient identifier (restricted values: masked by default in APIs)';
COMMENT ON COLUMN patient.identifiers.verification_source IS 'Registry that confirmed the value, e.g. satusehat, dukcapil';
CREATE UNIQUE INDEX uq_identifiers_active ON patient.identifiers (organization_id, system_uri, value) WHERE active AND unique_value;
CREATE INDEX idx_identifiers_lookup ON patient.identifiers (system_uri, value) WHERE active;
CREATE INDEX idx_identifiers_patient_id ON patient.identifiers (patient_id);

CREATE TABLE patient.names (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    patient_id       uuid        NOT NULL,
    use              text        NOT NULL DEFAULT 'official',
    text             text        NOT NULL,
    family           text,
    given            text[],
    prefix           text[],
    suffix           text[],
    period_start     date,
    period_end       date,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_names PRIMARY KEY (id),
    CONSTRAINT fk_names_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    -- FHIR R4 NameUse.
    CONSTRAINT ck_names_use CHECK (use IN ('usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden')),
    CONSTRAINT ck_names_text CHECK (length(btrim(text)) BETWEEN 1 AND 200),
    CONSTRAINT ck_names_family CHECK (length(btrim(family)) BETWEEN 1 AND 100),
    CONSTRAINT ck_names_parts CHECK (cardinality(given) <= 10 AND cardinality(prefix) <= 5 AND cardinality(suffix) <= 5),
    CONSTRAINT ck_names_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
COMMENT ON TABLE patient.names IS 'Patient name; text is the full name as written (many Indonesian names have one part)';
CREATE INDEX idx_names_patient_id ON patient.names (patient_id);
CREATE INDEX idx_names_search ON patient.names (organization_id, lower(text) text_pattern_ops) WHERE active;

CREATE TABLE patient.telecoms (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    patient_id       uuid        NOT NULL,
    system           text        NOT NULL,
    value            text        NOT NULL,
    use              text,
    rank             smallint,
    period_start     date,
    period_end       date,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_telecoms PRIMARY KEY (id),
    CONSTRAINT fk_telecoms_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    -- FHIR R4 ContactPointSystem / ContactPointUse.
    CONSTRAINT ck_telecoms_system CHECK (system IN ('phone', 'fax', 'email', 'pager', 'url', 'sms', 'other')),
    CONSTRAINT ck_telecoms_value CHECK (length(value) BETWEEN 1 AND 200 AND value = btrim(value)),
    CONSTRAINT ck_telecoms_use CHECK (use IN ('home', 'work', 'temp', 'old', 'mobile')),
    CONSTRAINT ck_telecoms_rank CHECK (rank >= 1),
    CONSTRAINT ck_telecoms_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
COMMENT ON TABLE patient.telecoms IS 'Patient phone/email contact point (restricted: masked by default in APIs)';
CREATE INDEX idx_telecoms_patient_id ON patient.telecoms (patient_id);

-- Indonesian addresses carry the Kemendagri administrative codes and RT/RW (Kepmenkes 1423/2022; SATUSEHAT extension
-- https://fhir.kemkes.go.id/r4/StructureDefinition/administrativeCode with province, city, district, village, rt, rw).
CREATE TABLE patient.addresses (
    id               uuid        NOT NULL DEFAULT uuidv7(),
    organization_id  uuid        NOT NULL,
    patient_id       uuid        NOT NULL,
    use              text        NOT NULL DEFAULT 'home',
    type             text,
    line             text,
    city             text,
    postal_code      text,
    country_code     text        NOT NULL DEFAULT 'ID',
    province_code    text,
    city_code        text,
    district_code    text,
    village_code     text,
    rt               text,
    rw               text,
    period_start     date,
    period_end       date,
    active           boolean     NOT NULL DEFAULT true,
    version          integer     NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    last_xact_id     xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_addresses PRIMARY KEY (id),
    CONSTRAINT fk_addresses_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    -- FHIR R4 AddressUse / AddressType.
    CONSTRAINT ck_addresses_use CHECK (use IN ('home', 'work', 'temp', 'old', 'billing')),
    CONSTRAINT ck_addresses_type CHECK (type IN ('postal', 'physical', 'both')),
    CONSTRAINT ck_addresses_line CHECK (length(btrim(line)) BETWEEN 1 AND 500),
    CONSTRAINT ck_addresses_city CHECK (length(btrim(city)) BETWEEN 1 AND 100),
    CONSTRAINT ck_addresses_postal_code CHECK (postal_code ~ '^[0-9A-Za-z -]{3,10}$'),
    CONSTRAINT ck_addresses_country_code CHECK (country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT ck_addresses_admin_codes CHECK (province_code ~ '^[0-9.]{1,13}$' AND city_code ~ '^[0-9.]{1,13}$'
                                               AND district_code ~ '^[0-9.]{1,13}$' AND village_code ~ '^[0-9.]{1,13}$'),
    CONSTRAINT ck_addresses_rt_rw CHECK (rt ~ '^[0-9]{1,3}$' AND rw ~ '^[0-9]{1,3}$'),
    CONSTRAINT ck_addresses_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
COMMENT ON TABLE patient.addresses IS 'Patient address with Kemendagri administrative codes and RT/RW (restricted)';
COMMENT ON COLUMN patient.addresses.village_code IS 'Kemendagri kode wilayah of the kelurahan/desa (format validated by hms_services)';
CREATE INDEX idx_addresses_patient_id ON patient.addresses (patient_id);

-- Related persons: next of kin, guarantor (penanggung jawab), mother of a newborn.
CREATE TABLE patient.contacts (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    organization_id      uuid        NOT NULL,
    patient_id           uuid        NOT NULL,
    relationship_system  text        NOT NULL,
    relationship_code    text        NOT NULL,
    name                 text        NOT NULL,
    phone                text,
    address_text         text,
    administrative_gender text,
    period_start         date,
    period_end           date,
    active               boolean     NOT NULL DEFAULT true,
    version              integer     NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    last_xact_id         xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_contacts PRIMARY KEY (id),
    CONSTRAINT uq_contacts_id_patient_id UNIQUE (id, patient_id),
    CONSTRAINT fk_contacts_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_contacts_relationship_system FOREIGN KEY (relationship_system) REFERENCES terminology.code_systems (uri),
    CONSTRAINT ck_contacts_relationship_code CHECK (length(relationship_code) BETWEEN 1 AND 20),
    CONSTRAINT ck_contacts_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_contacts_phone CHECK (length(phone) BETWEEN 3 AND 30),
    CONSTRAINT ck_contacts_address_text CHECK (length(btrim(address_text)) BETWEEN 1 AND 500),
    CONSTRAINT ck_contacts_administrative_gender CHECK (administrative_gender IN ('male', 'female', 'other', 'unknown')),
    CONSTRAINT ck_contacts_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
COMMENT ON TABLE patient.contacts IS 'Related person of a patient (next of kin, guarantor, mother); restricted';
CREATE INDEX idx_contacts_patient_id ON patient.contacts (patient_id);

-- Links between patient records of the same organization (FHIR Patient.link): a duplicate found later is marked
-- inactive and linked replaced-by the surviving record; clinical rows keep their original patient_id.
CREATE TABLE patient.links (
    id                uuid        NOT NULL DEFAULT uuidv7(),
    organization_id   uuid        NOT NULL,
    patient_id        uuid        NOT NULL,
    other_patient_id  uuid        NOT NULL,
    link_type         text        NOT NULL,
    active            boolean     NOT NULL DEFAULT true,
    version           integer     NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    last_xact_id      xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_links PRIMARY KEY (id),
    CONSTRAINT fk_links_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_links_other_patient FOREIGN KEY (other_patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT ck_links_not_self CHECK (other_patient_id <> patient_id),
    -- FHIR R4 LinkType.
    CONSTRAINT ck_links_link_type CHECK (link_type IN ('replaced-by', 'replaces', 'refer', 'seealso'))
);
COMMENT ON TABLE patient.links IS 'Link between two patient records (duplicate resolution); never merges rows physically';
CREATE UNIQUE INDEX uq_links_active ON patient.links (patient_id, other_patient_id, link_type) WHERE active;
CREATE INDEX idx_links_other_patient_id ON patient.links (other_patient_id);

-- Consent (FHIR Consent): general consent at registration/admission (Kepmenkes 1423 data sets, section III), consent
-- for research or data sharing. Legal obligations (e.g. reporting required by regulation) are not consent-based and
-- are recorded as processing activities (privacy schema), not here.
CREATE TABLE patient.consents (
    id                   uuid        NOT NULL DEFAULT uuidv7(),
    organization_id      uuid        NOT NULL,
    patient_id           uuid        NOT NULL,
    status               text        NOT NULL,
    scope                text        NOT NULL,
    category_system      text        NOT NULL,
    category_code        text        NOT NULL,
    category_display     text,
    decided_at           timestamptz NOT NULL,
    grantor_kind         text        NOT NULL,
    grantor_contact_id   uuid,
    provision            text        NOT NULL,
    period_start         timestamptz,
    period_end           timestamptz,
    policy_reference     text,
    source_document_ref  text,
    source_document_sha256 bytea,
    version              integer     NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    last_xact_id         xid8        NOT NULL DEFAULT pg_current_xact_id(),
    CONSTRAINT pk_consents PRIMARY KEY (id),
    CONSTRAINT fk_consents_patient FOREIGN KEY (patient_id, organization_id) REFERENCES patient.patients (id, organization_id),
    CONSTRAINT fk_consents_grantor_contact FOREIGN KEY (grantor_contact_id, patient_id) REFERENCES patient.contacts (id, patient_id),
    CONSTRAINT fk_consents_category_system FOREIGN KEY (category_system) REFERENCES terminology.code_systems (uri),
    -- FHIR R4 ConsentState / consent-scope / ConsentProvisionType.
    CONSTRAINT ck_consents_status CHECK (status IN ('draft', 'proposed', 'active', 'rejected', 'inactive', 'entered-in-error')),
    CONSTRAINT ck_consents_scope CHECK (scope IN ('adr', 'research', 'patient-privacy', 'treatment')),
    CONSTRAINT ck_consents_category_code CHECK (length(category_code) BETWEEN 1 AND 100 AND length(category_display) <= 500),
    CONSTRAINT ck_consents_grantor CHECK ((grantor_kind = 'patient' AND grantor_contact_id IS NULL)
                                          OR (grantor_kind = 'related_person' AND grantor_contact_id IS NOT NULL)),
    CONSTRAINT ck_consents_provision CHECK (provision IN ('permit', 'deny')),
    CONSTRAINT ck_consents_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end > period_start),
    CONSTRAINT ck_consents_policy_reference CHECK (length(btrim(policy_reference)) BETWEEN 1 AND 500),
    CONSTRAINT ck_consents_source_document CHECK ((source_document_ref IS NULL) = (source_document_sha256 IS NULL)
        AND length(source_document_ref) <= 500 AND octet_length(source_document_sha256) = 32)
);
COMMENT ON TABLE patient.consents IS 'Consent decision of a patient or representative (FHIR Consent); withdrawal = new status with reason';
COMMENT ON COLUMN patient.consents.source_document_ref IS 'Object-storage key of the signed form (binary kept outside PostgreSQL)';
CREATE INDEX idx_consents_patient_id ON patient.consents (patient_id, scope);

CREATE TRIGGER trg_identifiers_check BEFORE INSERT OR UPDATE ON patient.identifiers
    FOR EACH ROW EXECUTE FUNCTION terminology.check_identifier('Patient');

SELECT hms_meta.enable_versioned_record('patient.patients', 'Patient', 'id', 'id,organization_id');
SELECT hms_meta.enable_versioned_record('patient.identifiers', 'Patient.identifier', 'patient_id',
                                        'id,organization_id,patient_id,system_uri,value', '', 'patient.patients', 'patient_id');
SELECT hms_meta.enable_versioned_record(t.tbl::regclass, t.rtype, 'patient_id', 'id,organization_id,patient_id', '',
                                        'patient.patients', 'patient_id')
FROM (VALUES ('patient.names', 'Patient.name'),
             ('patient.telecoms', 'Patient.telecom'), ('patient.addresses', 'Patient.address'),
             ('patient.contacts', 'Patient.contact'), ('patient.links', 'Patient.link')) AS t(tbl, rtype);
SELECT hms_meta.enable_versioned_record('patient.consents', 'Consent', 'patient_id', 'id,organization_id,patient_id',
                                        'active,rejected,inactive');

-- Fixed columns, versions and timestamps are protected by the version trigger, so writers get table-level UPDATE.
GRANT USAGE ON SCHEMA patient TO hms_patient_rw;
GRANT SELECT, INSERT, UPDATE ON patient.patients, patient.identifiers, patient.names, patient.telecoms,
    patient.addresses, patient.contacts, patient.links, patient.consents TO hms_patient_rw;
GRANT SELECT ON patient.resource_versions TO hms_patient_rw;
