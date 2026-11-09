---
name: financial-posting-and-ledger-integrity
description: Specify and validate double-entry posting, immutable journals, idempotency, period controls and subledger reconciliation.
---


# Financial Posting & Ledger Integrity

- A journal is posted atomically: validate source, period, accounts, dimensions, currency, approval, idempotency and debit/credit equality before commit.
- Use a stable source-system/source-entity/source-reference/idempotency key.
- Keep journal header and lines immutable after posting.
- Corrections use reversal and replacement entries with cross-references.
- Separate draft, submitted, approved, posting, posted, rejected and reversed states where the workflow requires them.
- Prevent concurrent duplicate posting with database uniqueness and transaction locking.
- Use NUMERIC, never float, for monetary values.
- Define multi-currency base/transaction currency treatment explicitly.
- Closed periods reject ordinary postings.
- Reconcile subledger balances to GL control accounts and retain variance evidence.
- Test retries, concurrent submissions, partial failure, rollback, rounding, foreign currency and period boundaries.
