# Legacy Read Polling Architecture

Flow: Legacy MySQL (SELECT-only) -> LRPA scheduler/connector -> checkpoint and snapshot storage in new PostgreSQL -> change detection -> canonical mapping -> observed or verified event -> event distribution.

No legacy writes, DDL, triggers, stored procedure changes, index changes or application changes. Query load must be bounded. Choose strategy per entity based on actual schema evidence.

Polling sees states at observation intervals; it cannot guarantee every intermediate transition. Poll time is not business occurrence time. Hard deletes require existing source evidence or reconciliation.
