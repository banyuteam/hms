# Financial Operations Engine — service ownership

This is a proposed service-domain boundary. Implement incrementally; do not assume all listed modules already exist.

`hms_services` owns:
- Financial workflow orchestration and authoritative posting.
- COA/accounting policy API behavior and validation.
- Posting-rule evaluation and version selection.
- Approval and maker-checker enforcement.
- Journal generation, posting transaction, idempotency and reversals.
- Subledger/GL reconciliation execution.
- Period close controls and financial audit events.
- Integrations with billing, pharmacy, inventory, procurement, payroll and payment services.

`hms_database` owns schema/migration definitions and persistence integrity. `hms_workspace` owns screens and client state. No client connects directly to PostgreSQL.

Recommended packages: `accounting`, `general_ledger`, `receivables`, `payables`, `cash_management`, `billing_integration`, `costing`, `budgeting`, `reconciliation`, `posting_rules`, `period_closing`.

## Database namespace
All finance tables use the single PostgreSQL schema `finance`, separated by table prefixes and foreign-key relationships. Go packages may remain modular; application package boundaries do not require separate PostgreSQL schemas.
