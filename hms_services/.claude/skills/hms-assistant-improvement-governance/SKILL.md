---
name: hms-assistant-improvement-governance
description: Govern learning observations, proposals, reviews, approvals, releases and rollback.
---
# HMS Assistant Improvement Governance

Lifecycle: `observation -> proposal -> triage -> domain review -> evaluation -> approval -> publish -> monitor -> retire/rollback`. Never conflate these states.

Each proposal records ID/status, problem, evidence window/sample size, affected capability/version, evidence limitations, proposed change, expected outcome and acceptance criteria, risk, reviewers, evaluation dataset/version and decision/release references.

Route clinical workflow/diagnosis/medication to clinical owner; ICD/INA-CBG/iDRG/claim logic to coding/claims owner; finance/billing to finance owner; security/access/privacy to security/privacy owner; presentation-only copy/navigation to product/workspace owner. User feedback cannot override official catalogues, law, contracts or clinical policy.

Separate author and approver where risk warrants. Published versions are immutable. Record approver, decision, time and evaluation evidence. Activate only approved versions; support rollback. Learning must never change authorization policies.

Do not randomize clinical decisions, medication, diagnosis, signatures, claim eligibility or regulated outcomes. Presentation experiments must preserve domain logic and authorization.

Restrict raw evidence; audit proposal access, review, approval, publication and rollback. Test invalid lifecycle transitions, unauthorized approvals, release without evaluation, immutability and audit completeness.
