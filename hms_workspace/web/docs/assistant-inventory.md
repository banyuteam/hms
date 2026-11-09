# Assistant: current-state inventory (Phase 1)

**Status:** `BASELINE` (describes the code as of 2026-11-09, before Phase 4). Since Phase 4 the claim checks of §4 run in
hms_services and the browser copy is removed, which addresses F-1 to F-6 (ADR-SVC-006; since claim readiness v2 the server reads the SEP from `bridging_sep`,
ADR-SVC-007).
F-11 is settled (O-8). F-7 is fixed (2026-11-09): a patient tag carries only the MRN (enforced by the `AssistantTag`
type), and a question with only a patient tagged gets "tag the visit you are asking about" instead of an answer about the
latest visit. F-8 to F-10 are fixed (2026-11-09): a tagged section gives the topic when the text names none, and the
quick-action buttons put it first (F-8); with several visits tagged the assistant asks which one and the user picks a chip
(F-9); the UI no longer calls it AI (labels, sparkles icon, "AI draft"), and the attachment control that never read files
is gone (F-10). Feedback on findings and answers is built per ADR-SVC-008 (Phase A, assistant panel).
**Governs:** `hms-assistant-workspace-governance` skill, Phase 1 · **Next:** ADR-SVC-006 and `assistant-v1` contract (Phase 2)
**Reviewed:** `src/features/assistant/{AssistantPanel,rules}.tsx|ts`, `src/state/assistant.tsx`, `src/api/select.ts`,
`src/api/liveTimeline.ts`, `src/features/emr/windows/*` (Ask AI buttons), `hms_services/contracts/api/clinical-timeline-v1.openapi.yaml` 1.2.0

## 1. What exists

| Part           | File                                                         | What it does                                                                                                                                        |
| -------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel          | `src/features/assistant/AssistantPanel.tsx`                  | Closed (rail button), docked or maximized. Chat log, free-text box, tag picker (encounter search), tag and attachment chips. Labelled "AI", tier 1. |
| Reply rules    | `src/features/assistant/rules.ts`                            | Keyword topic detection and read-back of the tagged encounter. No network call.                                                                     |
| State          | `src/state/assistant.tsx`                                    | Mode, tags, attachments and messages in memory; wiped by `useEndSession`.                                                                           |
| Claim checks   | `src/api/select.ts` (`claimChecks`, `isClaimable`, `isBpjs`) | The 7 claim-readiness checks. Shared by the Records window and the assistant.                                                                       |
| Ask AI buttons | Profile, Records, Encounter, Diagnostics, Viewer windows     | Add a tag and open the docked panel.                                                                                                                |

There is no assistant code in `hms_services` and no assistant table in `hms_database`.

## 2. Topics (free text, first match wins)

Order of the checks in `rules.ts`: advice refusal first, then the topics in this order.

| Order | Topic       | Keywords (EN + ID, regex)                                                                                                                       | Answer                                                      |
| ----- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0     | refuse      | should I/we, recommend, what dose/drug/treatment, diagnose, is it safe, sarankan, rekomendasi, sebaiknya, dosis berapa, obat apa, terapi apa, … | Refusal message                                             |
| 1     | claim       | claim, klaim, bpjs, casemix, resume, ina-cbg, readiness, kelengkapan                                                                            | The claim checks (§4)                                       |
| 2     | diagnoses   | diagnos\*, icd-10, dx                                                                                                                           | Diagnoses by priority                                       |
| 3     | procedures  | procedure*, tindakan, icd-9*, operasi, surgery                                                                                                  | Coded procedures (ICD-9-CM)                                 |
| 4     | labs        | lab*, result*, hasil                                                                                                                            | Lab results with a flag (`keterangan` not empty)            |
| 5     | medications | med*, drug*, obat, resep, prescri\*                                                                                                             | Prescription items and instructions                         |
| 6     | summary     | summar*, ringkas*, overview, riwayat, timeline                                                                                                  | Care setting, DPJP, length of stay, status, top 3 diagnoses |
| —     | help        | anything else                                                                                                                                   | What can be asked                                           |

Before a topic is answered: no tag with an encounter number → "tag an encounter"; encounter not in the data cache →
"not loaded". Every answer starts with the encounter number it used and ends with a disclaimer.

## 3. Rule classification

| Rule                                                           | Category (skill §4)                         | Owner after the plan                                                  |
| -------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| Topic detection, help text, refusal wording                    | Presentation and navigation                 | `hms_workspace` (stays)                                               |
| Read-back of diagnoses, procedures, labs, medications, summary | Display of data the user already sees       | `hms_workspace` (stays)                                               |
| Clinical-advice refusal                                        | Safety guard on presentation                | `hms_workspace`; the backend never offers advice (no such capability) |
| Claim-readiness checks (§4)                                    | **Deterministic domain validation**         | **`hms_services`** (ADR-SVC-006)                                      |
| Which payers need a claim (`NO_CLAIM_PAYERS`)                  | **Domain rule** (owner decision 2026-11-09) | **`hms_services`** (ADR-SVC-006)                                      |
| Which payer has an SEP (`BPJ`)                                 | **Domain rule**                             | **`hms_services`** (ADR-SVC-006)                                      |

## 4. Claim-readiness checks as built (`select.ts:230`)

Applicability: the Records window shows the section only when the payer code (trimmed, upper case) is not one of
`''`, `-`, `UMU`, `KRX`. States: `ok`, `missing`, `mismatch`, `notApplicable`, `unavailable`.

| Check id           | Applies when                                             | `ok` when                                                   | Otherwise                                                |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| `sep`              | payer `BPJ` only (otherwise the check is absent)         | `summary.sep` has rows                                      | `missing`; `unavailable` when `summary.sep` is undefined |
| `primaryDx`        | always                                                   | at least one diagnosis                                      | `missing`                                                |
| `dischargeSummary` | inpatient                                                | discharge summary present                                   | `missing`; `notApplicable` if not inpatient              |
| `dxMatchesSummary` | inpatient, summary and diagnosis present                 | summary main diagnosis code `===` priority-1 diagnosis code | `mismatch`; `notApplicable` otherwise                    |
| `procedureCoded`   | at least one billed action not performed by a nurse only | at least one coded procedure                                | `missing`; `notApplicable` without doctor actions        |
| `lengthOfStay`     | inpatient                                                | the first room stay's `lama` is not null                    | `missing`                                                |
| `dischargeStatus`  | inpatient                                                | the first room stay's `stts_pulang` is not empty            | `missing`                                                |

Tests: `src/api/select.test.ts` (all-ok inpatient, mismatch, fresh visit, SEP states, payer codes).

## 5. Findings

These are observations, not fixes. Each is an input to ADR-SVC-006 or to the workspace owner.

| #    | Finding                                                                                                                                                                                                                 | Where                                    | Effect                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| F-1  | SEP is never available in live data. `clinical-timeline-v1` has no SEP field and `liveTimeline.ts` never sets `summary.sep`, so every BPJS visit shows SEP as "Not available from source". Only demo data has SEP rows. | `select.ts:146`, `liveTimeline.ts:320`   | The SEP check cannot pass in live mode.                                                                               |
| F-2  | The assistant answers the claim topic for every payer; the Records window hides claim readiness for `-`, `UMU`, `KRX`.                                                                                                  | `rules.ts:118` vs `RecordsWindow.tsx:65` | Same visit, two different answers.                                                                                    |
| F-3  | Length of stay and discharge status come from the **first** room stay. For a patient who changed rooms, that is not the room they were discharged from.                                                                 | `select.ts:108`, `select.ts:272`         | Possibly a wrong `ok` or `missing`. Needs owner confirmation of the intended row.                                     |
| F-4  | Care setting `unknown` is mapped to `null` and treated as "not inpatient", so the inpatient checks show "Not applicable" instead of "could not be checked".                                                             | `liveTimeline.ts:326`, `select.ts:232`   | A gap is hidden.                                                                                                      |
| F-5  | Truncated sections are ignored. If billed actions are cut by their row cap, `procedureCoded` can say "Not applicable" on incomplete data.                                                                               | `select.ts:235`                          | A gap is hidden (rare).                                                                                               |
| F-6  | `dxMatchesSummary` compares codes exactly (`===`); `A09.9` and `A09.9 ` are a mismatch.                                                                                                                                 | `select.ts:258`                          | Possible false "Check".                                                                                               |
| F-7  | Tagging a **patient** from the Profile window silently carries the patient's latest encounter number. The chip shows only the MRN, but the answer is about that encounter.                                              | `ProfileWindow.tsx:123`, `rules.ts:68`   | Context the user did not explicitly choose (root `CLAUDE.md` §9, HMS-CRC rule 1). The answer does name the encounter. |
| F-8  | Section tags (`labs`, `cppt`, `diagnoses`, `claim`) are labels only; the topic still comes from the typed text.                                                                                                         | `rules.ts:68`                            | Tagging "claim" and asking "summary" answers the summary.                                                             |
| F-9  | With several encounter tags, only the most recently added one is used.                                                                                                                                                  | `rules.ts:68`                            | Visible (the answer names it), but not explained.                                                                     |
| F-10 | The UI calls the assistant "AI" (`emr.ai.*`, sparkles icon, "tier 1"); the governance skill says it must not be described as AI-powered.                                                                                | `AssistantPanel.tsx`, locales            | Naming decision for the owner.                                                                                        |
| F-11 | `hms_services` skill `hms-insurer-claim-virtual-assistant-backend` allows optional AI-agent orchestration; `hms-assistant-workspace-governance` and `hms-assistant-rule-engine` exclude any model.                      | skills                                   | Governance conflict; this plan follows the deterministic skills.                                                      |

## 6. Responsibility map

```
hms_workspace/web                        hms_services                              hms_database
-----------------                        ------------                              ------------
panel, topics, read-back, refusal        POST /assistant/rules/evaluate           audit.audit_events (existing,
explicit tags -> context references  ->   session + permission                       0002): one event per evaluation
loading / unavailable / stale states      reference authorization                  iam.permissions (existing, 0005):
render findings (i18n by rule id)         read timeline (existing legacy reads)      new codes registered at startup
                                          claim-readiness@1 (Go, in code)
                                          audit, fail closed
```

No new table or migration is needed for the first slice (ADR-SVC-006, Ownership impact).
