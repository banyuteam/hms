-- terminology and knowledge (migrations 0007, 0014): release lifecycle, immutable approved content, identifier rules.
-- Synthetic data; rolled back.
BEGIN;

INSERT INTO platform.organizations (id, code, name) VALUES ('00000000-0000-7000-8000-00000000000a', 'TEST-ORG-A', 'Test Organization A');
INSERT INTO iam.users (id, organization_id, display_name) VALUES
    ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-00000000000a', 'Test Governance User');

DO $$
DECLARE
    rt  text := pg_temp.r('runtime');
BEGIN
    -- Registry seed is present and code systems are unique by URI.
    PERFORM pg_temp.ok((SELECT count(*) FROM terminology.code_systems
                           WHERE uri IN ('http://loinc.org', 'http://snomed.info/sct', 'http://hl7.org/fhir/sid/icd-10',
                                         'http://unitsofmeasure.org', 'http://sys-ids.kemkes.go.id/kfa')) = 5,
                          'well-known code systems are registered');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO terminology.code_systems (uri, name, publisher, scope)
                                       VALUES ('http://loinc.org', 'dup', 'x', 'international')$q$, '23505', 'duplicate code system URI');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO terminology.code_systems (uri, name, publisher, scope)
                                       VALUES ('not a uri', 'x', 'x', 'local')$q$, '23514', 'code system URI format');

    -- A local code system with a draft release.
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO terminology.code_systems (uri, name, publisher, scope)
        VALUES ('urn:hms:test:religion', 'Test religion codes', 'Test', 'local')$q$);
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO terminology.code_system_releases
        (id, code_system_id, version, effective_from, source_reference, artifact_sha256, import_tool_version)
        SELECT '00000000-0000-7000-8000-0000000000e1', id, '2022', DATE '2022-09-14', 'test fixture',
               sha256('fixture'::bytea), 'test-1' FROM terminology.code_systems WHERE uri = 'urn:hms:test:religion'$q$);
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$INSERT INTO terminology.concepts (release_id, code, display) VALUES
        ('00000000-0000-7000-8000-0000000000e1', '1', 'Test A'), ('00000000-0000-7000-8000-0000000000e1', '2', 'Test B')$q$) = 2,
        'concepts load into a draft release');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE terminology.code_system_releases SET status = 'approved'
                                       WHERE id = '00000000-0000-7000-8000-0000000000e1'$q$, '23514',
                                 'approval needs approver and time');
    PERFORM pg_temp.exec_as(rt, $q$UPDATE terminology.code_system_releases
        SET status = 'approved', approved_at = now(), approved_by_user_id = '00000000-0000-7000-8000-0000000000c1'
        WHERE id = '00000000-0000-7000-8000-0000000000e1'$q$);

    -- Approved content is immutable.
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO terminology.concepts (release_id, code, display)
                                       VALUES ('00000000-0000-7000-8000-0000000000e1', '3', 'Test C')$q$, 'P0001',
                                 'no concept added to an approved release');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE terminology.concepts SET display = 'changed'
                                       WHERE release_id = '00000000-0000-7000-8000-0000000000e1'$q$, 'P0001',
                                 'no concept changed in an approved release');
    PERFORM pg_temp.expect_error(rt, $q$DELETE FROM terminology.concepts WHERE release_id = '00000000-0000-7000-8000-0000000000e1'$q$,
                                 'P0001', 'no concept removed from an approved release');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE terminology.code_system_releases SET artifact_sha256 = sha256('x'::bytea)
                                       WHERE id = '00000000-0000-7000-8000-0000000000e1'$q$, 'P0001',
                                 'approved release metadata cannot change');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE terminology.code_system_releases SET status = 'draft'
                                       WHERE id = '00000000-0000-7000-8000-0000000000e1'$q$, 'P0001',
                                 'approved release cannot return to draft');
    PERFORM pg_temp.ok(pg_temp.exec_as(rt, $q$UPDATE terminology.code_system_releases SET status = 'retired', effective_until = DATE '2030-01-01'
                                              WHERE id = '00000000-0000-7000-8000-0000000000e1'$q$) = 1,
                          'approved release can be retired');

    -- Concept maps: unmatched has no target; equivalence from FHIR R4.
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO terminology.concept_maps (id, uri, version, name, source_system_uri, target_system_uri)
        VALUES ('00000000-0000-7000-8000-0000000000e2', 'urn:hms:test:map', '1', 'Test map', 'urn:hms:test:religion',
                'http://snomed.info/sct')$q$);
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO terminology.concept_map_elements (concept_map_id, source_code, target_code, equivalence)
                                       VALUES ('00000000-0000-7000-8000-0000000000e2', '1', '123', 'unmatched')$q$, '23514',
                                 'unmatched element has no target');
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO terminology.concept_map_elements (concept_map_id, source_code, target_code, equivalence)
                                       VALUES ('00000000-0000-7000-8000-0000000000e2', '1', '123', 'same')$q$, '23514',
                                 'equivalence code set');

    -- Identifier systems from SATUSEHAT / Kepmenkes 1423.
    PERFORM pg_temp.ok((SELECT value_pattern = '^[0-9]{16}$' AND unique_value AND sensitivity = 'restricted'
                                  AND excluded_values = ARRAY['9999999999999999']
                           FROM terminology.identifier_systems WHERE uri = 'https://fhir.kemkes.go.id/id/nik'),
                          'NIK: 16 digits, unique, restricted, placeholder excluded');
    PERFORM pg_temp.ok(NOT (SELECT unique_value FROM terminology.identifier_systems WHERE uri = 'https://fhir.kemkes.go.id/id/nik-ibu'),
                          'NIK ibu is shared by siblings, not unique');

    -- Knowledge: openEHR archetype id format and template lifecycle.
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO knowledge.archetypes (archetype_id, semver, rm_class, adl_version, source_lifecycle,
                                       source_reference, artifact_sha256) VALUES ('blood pressure', '2.0.0', 'OBSERVATION', '1.4',
                                       'published', 'ckm', sha256('a'::bytea))$q$, '23514', 'archetype id format');
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO knowledge.archetypes (id, archetype_id, semver, rm_class, adl_version, source_lifecycle,
        source_reference, artifact_sha256) VALUES ('00000000-0000-7000-8000-0000000000a1', 'openEHR-EHR-OBSERVATION.blood_pressure.v2',
        '2.0.3', 'OBSERVATION', '1.4', 'published', 'https://ckm.openehr.org/ckm/', sha256('a'::bytea))$q$);
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO knowledge.templates (id, template_id, version, name, rm_release, source_reference,
        artifact_sha256) VALUES ('00000000-0000-7000-8000-0000000000a2', 'hms.test.vitals', '1.0.0', 'Test vitals', '1.1.0',
        'repo:templates/vitals.opt', sha256('t'::bytea))$q$);
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO knowledge.template_archetypes VALUES
        ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-0000000000a1')$q$);
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO knowledge.template_bindings (template_id, path, cdm_target, fhir_path, code_system, code, unit_ucum)
        VALUES ('00000000-0000-7000-8000-0000000000a2', '/content[openEHR-EHR-OBSERVATION.blood_pressure.v2]/data/events/data/items[at0004]/value',
                'clinical.observation_components.value_quantity', 'Observation.component.valueQuantity', 'http://loinc.org', '8480-6', 'mm[Hg]')$q$);
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO knowledge.template_bindings (template_id, path)
                                       VALUES ('00000000-0000-7000-8000-0000000000a2', '/x')$q$, '23514', 'binding needs a target');
    PERFORM pg_temp.exec_as(rt, $q$UPDATE knowledge.templates SET status = 'active', approved_at = now(),
        approved_by_user_id = '00000000-0000-7000-8000-0000000000c1' WHERE id = '00000000-0000-7000-8000-0000000000a2'$q$);
    PERFORM pg_temp.expect_error(rt, $q$DELETE FROM knowledge.template_bindings WHERE template_id = '00000000-0000-7000-8000-0000000000a2'$q$,
                                 'P0001', 'bindings of an active template are fixed');
    PERFORM pg_temp.expect_error(rt, $q$UPDATE knowledge.templates SET rm_release = '1.0.4' WHERE id = '00000000-0000-7000-8000-0000000000a2'$q$,
                                 'P0001', 'active template content is fixed');

    -- FHIR profile registry.
    PERFORM pg_temp.exec_as(rt, $q$INSERT INTO knowledge.fhir_profiles (canonical_url, version, fhir_version, resource_type, publisher,
        source_reference, artifact_sha256) VALUES ('https://fhir.kemkes.go.id/r4/StructureDefinition/Patient', '1.0.0', '4.0.1',
        'Patient', 'Kementerian Kesehatan RI', 'test fixture', sha256('p'::bytea))$q$);
    PERFORM pg_temp.expect_error(rt, $q$INSERT INTO knowledge.fhir_profiles (canonical_url, version, fhir_version, resource_type, publisher,
        source_reference, artifact_sha256) VALUES ('ftp://x', '1', 'R4', 'Patient', 'x', 'x', sha256('p'::bytea))$q$, '23514',
                                 'profile URL and FHIR version format');

    -- Reporting reads reference data but cannot change it.
    PERFORM pg_temp.ok(pg_temp.exec_as(pg_temp.r('reporting'), 'SELECT * FROM terminology.identifier_systems') >= 4, 'reporting reads terminology');
    PERFORM pg_temp.expect_error(pg_temp.r('reporting'), $q$INSERT INTO terminology.code_systems (uri, name, publisher, scope)
                                       VALUES ('urn:x:y', 'x', 'x', 'local')$q$, '42501', 'reporting cannot write terminology');
END
$$;

ROLLBACK;
