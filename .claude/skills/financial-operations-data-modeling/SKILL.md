---
name: financial-operations-data-modeling
description: Design hospital financial schemas, double-entry journals, subledgers, reconciliation, posting rules and accounting controls.
---


# Financial Operations Data Modeling

## Mandatory reading
- `standards/finance/financial-operations-architecture.md`
- `hms_database/documentation/finance/`

## Ownership
- Database project owns schemas, constraints, migrations and data dictionary.
- Services project owns posting authority, financial workflow, approval enforcement and idempotency.
- Workspace project owns screens and presentation only.

## Modeling rules
- Separate operational source transactions, subledgers, GL, controls, reporting and analytics.
- Use NUMERIC for money; define currency, precision and rounding.
- Every posted journal must balance; validate aggregate balance in a controlled transaction.
- Posted journals are immutable; correct by reversal/replacement.
- Store source reference, posting-rule version and audit provenance.
- Prevent duplicate posting with idempotency constraints.
- Respect accounting periods and close controls.
- Reconcile subledgers to GL control accounts.
- Do not treat cash receipt as automatic revenue recognition.
- Distinguish tariff, contractual reimbursement, recognized revenue and collectible receivable.
- Keep management costing separate from GL posting unless approved.
- Do not create all finance schemas before their capability is approved.

## First vertical slice
COA + accounting periods + journal header/lines + balanced posting transaction + idempotency + reversal + audit + tests.
