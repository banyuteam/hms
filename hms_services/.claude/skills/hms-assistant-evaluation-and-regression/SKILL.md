---
name: hms-assistant-evaluation-and-regression
description: Build reproducible evaluation datasets and regression gates for HMS assistant improvements.
---
# HMS Assistant Evaluation & Regression

Use curated, approved, de-identified examples; synthetic cases are preferred. Each case defines stable ID, scenario/intent, inputs or synthetic context, expected behavior, prohibited behavior, relevant flow/rule/template/catalogue version, risk category and provenance.

Evaluate separately: intent/flow routing, clarification, catalogue correctness, structured finding completeness, clarity/actionability, safe refusal/escalation, context isolation, authorization, PHI leakage and compatibility. A single aggregate score must not hide a critical failure.

For deterministic rules, assert exact expected outcomes and properties. For templates, test required/prohibited content and valid action IDs. Compare current and candidate versions on the same frozen dataset. Report dataset/version, candidate version, sample size, pass rate by dimension, critical regressions and limitations.

Block release for authorization/tenant-isolation regression, PHI leakage, unsupported clinical/claim assertions, incorrect catalogue-version behavior or unintended side effects. Domain-owner approval is required for clinical, coding, claims, finance or regulated changes.

Monitor after release using defined windows and baselines. Account for case-mix changes. Roll back to a prior approved immutable version when needed.

Test evaluator reproducibility, missing expected values, dataset/version mismatch, critical gates and report integrity.
