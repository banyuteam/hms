# Research notes — hospital UX (web-frontend)

Compiled 2026-10-28 from web searches (US-skewed search tool; Indonesian evidence is thin).
Most hits were **secondary sources** (trade press, news, vendor blogs, abstracts); full papers were
**not** read. Treat everything here as *leads to verify*, not as settled facts. Strength: S strong ·
M moderate · W weak. Add new findings at the bottom with the same fields; promote decisions to
`source/web-frontend/docs/open-questions.md`.

## R1. Alert fatigue and interruptive alerts — M/W

- A 2022 style guide for interruptive alerts (Applied Clinical Informatics) proposes typographic emphasis,
  response options, default actions and opt-out to cut alert fatigue; alerts should be clear, concise, actionable.
  <https://thieme-connect.de/products/ejournals/abstract/10.1055/a-2508-7039>
- JAMIA 2015 drug–drug-interaction alert recommendations (24-expert workgroup, via secondary summary):
  consistent terminology, visual cues, minimal text, standard content; override rate is a weak effectiveness measure.
  <https://www.healthcareittoday.com/2015/06/25/some-methods-for-improving-emr-alerts/>
- Practical rules (trade press): reserve workflow-blocking alerts for the most serious situations; critical
  info on the top-level screen, evidence behind links; let users act from within the alert.
- **Applied here:** passive pills/banners by default; allergy always visible; no interruptive alerts in Phase 1 (OQ-10).

## R2. Information density, sprawl and clinician overload — M/W

- ICU study (PMC6584062): information density (elements per screen) and sprawl (data across screens) linked to
  overload; performance negatively correlated with interface complexity/inconsistency.
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC6584062>
- Trade press (TechTarget): remove elements not needed for the task, visual cues for key data, minimise clicks,
  screen changes and visual interruptions; a 2020 JAMA Netw Open study argued usability/information design
  (esp. graphing numeric data) should be part of EHR certification.
  <https://www.techtarget.com/searchhealthit/feature/How-to-Design-a-Comprehensive-EHR-Usability-Assessment>
- **Applied here:** clear-space canvas, summary-first cards, density levels. **Tension:** Khanza users are used to
  dense screens; whitespace may slow experts → validate (OQ-09, OQ-17).

## R3. Multiple open patient records and wrong-patient errors — M (one RCT, secondary summaries)

- Safety guidance has long favoured one open record (expert opinion). An RCT (Adelman et al., JAMA 2019, via
  Columbia/AHRQ/HPN summaries) randomised clinicians to 1 vs up to 4 open records: 88 vs 91 wrong-patient order
  errors per 100,000 order sessions — similar; most orders were placed with one record open (limited power).
  Errors rose with more open records mostly because of *setting* (inpatient/ED vs outpatient), not the count.
  44% of surveyed EHRs allowed ≥3 open records, 38% only 1. Patient-ID alerts and patient photos look promising;
  an AHRQ-funded RCT of photos was under way.
  <https://www.hpnonline.com/healthcare-it/article/21082239/having-multiple-ehrs-open-simultaneously-may-not-increase-wrongpatient-order-errors> ·
  <https://www.cuimc.columbia.edu/news/do-electronic-health-records-cause-patient-mixups> ·
  <https://digital.ahrq.gov/ahrq-funded-projects/assess-risk-wrong-patient-errors-emr-allows-multiple-records-open>
- **Applied here:** multi-window is kept (user requirement) but identity is in title bar + dock tab + header;
  optional patient photo and a limit on simultaneously open *patient* windows are open questions (OQ-04).
  Inpatient/ED roles are the high-risk group.

## R4. Indonesian rules affecting UX — W (vendor/secondary; verify against official text)

- Permenkes 24/2022 (rekam medis elektronik): sources say electronic records need an **audit trail** of entry,
  change and access, access control/no access by unauthorised parties, retention **≥ 25 years** from last
  visit (Pasal 39(1)), and connection to SATUSEHAT. **Article numbers disagree between sources** (Pasal 28 vs 35 for
  audit/security) — check JDIH Kemenkes / peraturan.go.id before citing.
  <https://medminutes.io/blog/permenkes-24-2022-rekam-medis-elektronik-rumah-sakit/> ·
  <https://pasal.id/peraturan/permen/permenkes-no-24-tahun-2022>
- A study of one Denpasar hospital found access reactivation/rights did not comply with the regulation or the
  hospital's SOP (<https://journal.ugm.ac.id/jkesvo/article/view/89228>) — hints that **access/lock UX** is an audit focus.
- No SATUSEHAT technical requirement for user-access logging was found. **Applied here:** audit event on
  reveal/print/export; auto-lock; reason capture (OQ-08, OQ-12). Regulatory interpretation is the hospital's call.

## R5. Khanza usability evidence — W

- Small SUS/TAM studies exist: UDINUS (40 medical-records *students*, not clinicians); RSUD Banyuasin registration
  module SUS = 26 ("poor", n = 5); Batam nursing-documentation study (50 nurses) reported repetitive/inconsistent
  documentation from features not yet effective/efficient; Aloei Saboe hospital nurses (n = 37) mostly rated Khanza
  efficient; an EUCS study cited interface design and slow response at peak hours.
  <https://pels.umsida.ac.id/index.php/PELS/article/view/1929> · <https://jurnal.unismuhpalu.ac.id/index.php/IJHESS/article/view/10683>
- **Gaps:** nothing found on keyboard shortcuts, nor a physician-only sample. Results are mixed and mostly
  student/small-sample → do **our own baseline** with real roles (OQ-17). Try Indonesian queries next
  ("pintasan keyboard SIMRS Khanza", "usability SIMRS Khanza dokter").

## R6. Not yet researched (candidates)

Touch/bedside tablet ergonomics; colour-vision deficiency in clinical charts; night-shift/dark-mode in wards;
DICOM viewer UX and PACS options; window-manager patterns in web apps (focus management, ARIA for windows,
browser shortcut conflicts, PWA/kiosk mode); lock-screen/fast-user-switching on shared workstations;
Indonesian accessibility regulations; e-signature (PSrE) UX.
