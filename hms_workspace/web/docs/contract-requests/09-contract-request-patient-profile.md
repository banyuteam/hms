# 09 · Contract request to hms_services — patient profile completeness

**Status:** `PROPOSED` (nothing here is implemented unless marked; hms_services owns the contracts and the decision)
**Requester:** hms_workspace (Patient Profile window, W1) · **Owner to approve:** hms_services technical owner
**Date:** 2026-11-06 · **Revised:** 2026-11-09 (re-validated against the v4 contracts; items already served are closed)
**Reviewed against:** `hms_services/contracts/api/clinical-read-v1.openapi.yaml` 1.1.0 and ADR-SVC-003

## 1. Why

The project instructions for hms*workspace define Patient Management as: \_patient profile, background, blood type, identity, NIK, registered providers in this hospital, default provider, emergency contact, list of medical records history*.

The Profile window reads everything clinical-read-v1 gives: `GET /patients/{mrn}` (identity, background, masked contact, responsible person, guarantor code), `GET /patients/{mrn}/identifiers/{kind}` (audited reveal) and `GET /patients/{mrn}/encounters` (visits, newest first, paged with `before`). What remains cannot be built on the frontend without inventing data, so it is requested here.

### Already served and used (no request)

| Profile field                                                                              | clinical-read-v1 field                                                                                      |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Name, MRN, sex, birth date / age, mother's name                                            | `name`, `mrn`, `sex`, `birth_date`, `mother_name`                                                           |
| Blood type, birth place, marital status, religion, education, occupation, first registered | `blood_type`, `birth_place`, `marital_status`, `religion`, `education`, `occupation`, `first_registered_on` |
| NIK, address line, phone, e-mail (masked, audited reveal)                                  | `nik`, `address`, `phone`, `email` + `/identifiers/{kind}`                                                  |
| Responsible person / emergency contact: name, relationship, occupation, address            | `responsible_person.*`                                                                                      |
| Guarantor: payers used on the visits (code, name), each with its visits                    | `GET /patients/{mrn}/payers` (was P-2, closed)                                                              |
| Visit history, newest first, paged                                                         | `/patients/{mrn}/encounters?before=`                                                                        |
| Patient search by name and/or MRN                                                          | `GET /patients?q=` (was P-4, closed)                                                                        |

## 2. Requests

### P-1 · Names next to coded or missing patient fields — **required**

| Needed in the profile             | Today in clinical-read-v1                   | Legacy lookup (Khanza)                                                                                                   | Proposed output field(s)                              |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Village, district, city, province | not returned (only the masked address line) | `kelurahan.nm_kel`, `kecamatan.nm_kec`, `kabupaten.nm_kab`, `propinsi.nm_prop` via `pasien.kd_kel/kd_kec/kd_kab/kd_prop` | `address_area: { village, district, city, province }` |
| Ethnicity, language, disability   | not returned                                | `suku_bangsa.nama_suku_bangsa`, `bahasa_pasien.nama_bahasa`, `cacat_fisik.nama_cacat`                                    | `ethnicity`, `language`, `disability`                 |

- Each output is `null` when the code has no match or nothing is recorded; existing fields stay as they are (additive, minor version).
- Area names are coarse location, but together with the name and birth date they narrow down a person. The owner decides whether they are returned in clear or masked like the address line.

### P-2 · Payers the patient has used — **IMPLEMENTED 2026-11-09**

`GET /patients/{mrn}/payers` in clinical-read-v1 1.1.0 (`encounter.read`, ADR-SVC-003 amendment): every visit of the
patient (`reg_periksa`) with its payer code and `penjab.png_jawab`, grouped by payer code, payers ordered by their latest
visit, visits latest first, at most 500 visits (`truncated`). Cancelled visits are included with their status. The
Profile's guarantor section shows it and no longer reads the `pasien` guarantor columns (`kd_pj`, `no_peserta`,
`perusahaan_pasien`); the API still returns them.

### P-3 · Visit summary on the patient — **recommended**

The profile shows "N visits shown · more are available" because the encounter list has no total, and it cannot show a "Last visit" or "Encounters" figure without loading every page.

Add to `GET /patients/{mrn}`:

| Field             | Source                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `last_encounter`  | the patient's latest `reg_periksa` row, in the `Encounter` schema |
| `encounter_count` | count of the patient's visits (cancelled included, as in P-2)     |

`reg_periksa` has an index on `no_rkm_medis`; please confirm the query plan. The service never creates indexes on the legacy database.

### P-5 · Meaning of `marital_status` — **clarification**

clinical-read-v1 normalises `marital_status` to `single`, `married`, `widowed_divorced`. Please document how the legacy value `JOMBLO` is mapped (the workspace shows whatever the service returns).

### P-6 · Emergency contact phone — **question only**

`responsible_person` has no phone number, and `pasien` holds none for the responsible person. Is there a legacy table that stores it? If not, the profile keeps no phone row for the contact and this item is closed.

## 3. Frontend behaviour until this is implemented

- Area, ethnicity, language and disability: not shown; the area row says "not available from source".
- Last visit and visit count: not shown. The workspace does not derive them by loading every visit page.
- No synthetic data is ever shown for a live patient.

When each item lands: P-1 → names in `livePatientApi.ts`; P-3 → "Last visit" and "Encounters" rows and "N of M" in the visit list.

## 4. Questions for the hms_services owner

1. P-1: area names in clear or masked? One additive change to `Patient`, or a separate document?
2. P-3: fields on `/patients/{mrn}`, or a total on the encounter list?
3. P-5: how is `JOMBLO` mapped?
4. P-6: does any legacy table hold the responsible person's phone?
