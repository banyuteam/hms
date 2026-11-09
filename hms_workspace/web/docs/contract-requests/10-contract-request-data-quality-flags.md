# 10 · Contract request to hms_services — data-quality flags

**Status:** `PROPOSED` (nothing here is implemented; hms_services owns the contracts and the decision)
**Requester:** hms_workspace (EMR windows, bill view, Patient Profile) · **Owner to approve:** hms_services technical owner
**Date:** 2026-11-09
**Reviewed against:** `hms_services/contracts/api/clinical-timeline-v1.openapi.yaml` 1.2.0 and `clinical-read-v1.openapi.yaml` 1.0.0

## 1. Why

Clinical screens must tell three cases apart: **not recorded**, **recorded but not a valid value**, and **a valid value**. A clinician who sees "not recorded" asks the patient or looks elsewhere; one who sees "the stored value is not a valid date" knows the record itself is faulty. Merging the two hides a data problem.

Today the workspace cannot do this reliably:

| Field kind                                                                            | What the contract returns today                                                 | What the workspace can show                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeline dates: `at`, `prescribed_at`, `dispensed_at`, `discharged_at`, `finished_at` | `null` both when the legacy row has no date and when it holds an impossible one | "Not recorded" for both. The invalid case is lost.                                                                                                                           |
| Bill `saved_bill.billed_at`, `receivable.due_date`                                    | Same as above                                                                   | Same as above                                                                                                                                                                |
| Patient `birth_date`, `first_registered_on`, encounter `registered_at`                | `null` (format `date` / `date-time`)                                            | Same as above                                                                                                                                                                |
| Quantities, amounts, `length_of_stay`, vitals                                         | Strings, as recorded                                                            | The workspace checks them with its own parser and shows a warning when a string is not a number. That is the browser guessing at the legacy data, not the service saying so. |
| Coded values (payer, status, room class)                                              | Code, plus a name or `null` when there is no lookup match                       | Cannot tell "no name in the lookup table" from "no name returned"                                                                                                            |

The service reads the legacy row and is the only place that knows the raw value and why it was rejected. The workspace should display that verdict, not reinvent it (root `CLAUDE.md` §4: the workspace does not own business rules or a second copy of backend logic).

## 2. Request

### Q-1 · `quality` list on Timeline, Bill and Patient — **required**

Add an optional, additive property `quality` to the `Timeline` and `Bill` schemas (clinical-timeline-v1) and to the patient detail schema (clinical-read-v1).

```yaml
DataQualityIssue:
  type: object
  required: [path, issue]
  properties:
    path:
      {
        type: string,
        description: JSON Pointer (RFC 6901) to the affected field in this same response,
      }
    issue: { type: string, enum: [invalid_date, invalid_time, invalid_number, unknown_code] }
    raw:
      {
        type: [string, 'null'],
        maxLength: 40,
        description: the stored value,
        only for the issue kinds in Q-2,
      }
    source: { type: [string, 'null'], description: legacy table.column, for support staff }
quality:
  type: array
  items: { $ref: '#/components/schemas/DataQualityIssue' }
  description: Issues found while reading this record. Absent or empty = none found (not "verified correct").
```

Rules proposed:

1. **The field keeps today's value.** An invalid date stays `null`, an invalid number stays the recorded string. Existing consumers see no change, so the change is a minor version: clinical-timeline-v1 1.3.0, clinical-read-v1 1.1.0.
2. **Not recorded is not an issue.** `0000-00-00`, `0000-00-00 00:00:00`, empty and `-` keep meaning "not recorded" and get no flag. This is how the workspace treats them today.
3. **`path` points into the same response**, for example `/entries/12/dispensed_at`. When `truncated` cuts a section, issues for rows that were cut are dropped too.
4. **Issue kinds** (no clinical judgement):

   | `issue`          | Meaning                                             | Example                         |
   | ---------------- | --------------------------------------------------- | ------------------------------- |
   | `invalid_date`   | A date that is not on the calendar                  | `2026-02-31`                    |
   | `invalid_time`   | A time that is not a clock time                     | `24:61:00`                      |
   | `invalid_number` | A numeric value stored as text that is not a number | quantity `2,5x`                 |
   | `unknown_code`   | A code with no row in its lookup table              | payer code with no `penjab` row |

5. **Clinical plausibility is out of scope.** A pulse of 400 or a weight of 0 is a clinical rule. It needs approved clinical governance and is not a data-type check, so it is not part of this request.

### Q-2 · Privacy of `raw` — **required**

- `raw` is sent only for `invalid_date`, `invalid_time` and `invalid_number`. These are the same field the person is already allowed to see. It is cut to 40 characters.
- `raw` is never sent for free text (notes, reports, names) or masked identifiers (NIK, phone, address, membership number).
- `raw` and `path` are not written to logs, traces or metrics. A metric, if wanted, counts by `issue` and `source` only, with no patient or encounter identifier as a label (root `CLAUDE.md` §6, §16).
- The flags travel in the same audited response as the record, so no new access path is created.

### Q-3 · Malformed response stays an error — **confirmation only**

A response that does not match the schema is still an error, not a data-quality issue. The workspace shows "the server's answer could not be read" (`BAD_SHAPE`) and no record. Please confirm the service never returns a partial record with flags in place of a 5xx.

## 3. Example (synthetic values)

```json
{
  "encounter_number": "2026/10/26/000123",
  "entries": [
    {
      "type": "prescription",
      "at": "2026-10-26T09:10:00+07:00",
      "number": "R-2026102600045",
      "prescribed_at": "2026-10-26T09:10:00+07:00",
      "dispensed_at": null,
      "items": []
    }
  ],
  "truncated": [],
  "quality": [
    {
      "path": "/entries/0/dispensed_at",
      "issue": "invalid_date",
      "raw": "2026-02-31 10:00:00",
      "source": "resep_obat.tgl_penyerahan"
    }
  ]
}
```

The workspace shows the handed-over time as "The stored date is not valid: 2026-02-31 10:00:00", not "Not recorded".

## 4. Workspace behaviour

**Until this lands**

- Dates that come back `null` are shown as "Not recorded". Invalid legacy dates therefore also read as "Not recorded" in live data.
- Quantities and amounts that are not numbers are shown with the "stored value is not valid" warning. That check runs in the browser (`BillCharges.tsx`, `StoredTime.tsx`).
- The demo data path already shows all three states, so the presentation is built and tested.

**When it lands**

- `liveTimeline.ts`, the bill mapper and `livePatientApi.ts` read `quality`, validate it with Zod, and attach each issue to the field at `path`. A path that does not resolve is ignored and counted in a test, never shown as a guess.
- The field renders with the existing `InvalidValue` warning (`src/components/StoredTime.tsx`): icon plus text, never colour alone.
- The browser's own number check stays only as a fallback for fields the service does not flag yet. Once a field is covered by `quality`, the browser check for it is removed so there is one source of truth.

## 5. Acceptance tests (proposed)

| #   | Given                                       | Expect                                                                        |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | `resep_obat.tgl_penyerahan = '2026-02-31'`  | `dispensed_at: null` and one `invalid_date` issue with its path and raw value |
| 2   | `resep_obat.tgl_penyerahan = '0000-00-00'`  | `dispensed_at: null` and no issue                                             |
| 3   | A valid record                              | `quality` absent or `[]`                                                      |
| 4   | A drug quantity that is not a number        | Quantity as recorded and one `invalid_number` issue                           |
| 5   | A payer code with no lookup row             | `payer.name: null` and one `unknown_code` issue, with no `raw`                |
| 6   | An invalid value in a free-text column      | No `raw` in the response                                                      |
| 7   | A section cut by its row cap                | No issue whose path points past the returned rows                             |
| 8   | A request whose audit write fails           | 503 and no record or flags (unchanged)                                        |
| 9   | Service logs and metrics after tests 1 to 6 | No raw value, path, MRN or encounter number                                   |

## 6. Questions for the hms_services owner

1. Is one `quality` list per response acceptable, or do you prefer a flag next to each field (larger change, more schema churn)?
2. Should `unknown_code` be in the first version, or later?
3. Is `source` (legacy `table.column`) acceptable in responses, or should it stay server-side?
4. Are there legacy values the service already rejects that are missing from the issue list?
5. Target versions: clinical-timeline-v1 1.3.0 and clinical-read-v1 1.1.0?
