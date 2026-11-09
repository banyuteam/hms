# Schema `audit`

`0019_privacy_and_audit_anchoring.sql` adds `chain_anchors`, `chain_head()`, `check_anchor()` and
`verify_anchors()` (see External anchoring below).

- Migration: `0002_audit_events.sql`
- Writer: `hms_services` audit integration (`hms_audit_append`: INSERT of descriptive columns, SELECT of `event_id`)
- Readers: audit reviewers (`hms_audit_read`: SELECT, `verify_chain`)
- Classification: restricted. Rows hold identifiers and outcomes, never record contents, field values, tokens or
  passwords. `resource_id` may identify a patient.

## `audit_events`
Append-only. UPDATE, DELETE and TRUNCATE are refused by triggers for every role, including the owner.

The `BEFORE INSERT` trigger (`audit_events_chain`, SECURITY DEFINER) assigns:
- `seq`: contiguous chain position from 1;
- `recorded_at`: database clock (writers cannot supply or backdate it);
- `prev_hash`: `hash` of row `seq - 1` (32 zero bytes for the first row);
- `hash`: SHA-256 over the canonical row content (`audit.audit_event_hash`, version 1) including `prev_hash`.

Writers:
- supply `event_id` and retry with `INSERT ... ON CONFLICT (event_id) DO NOTHING`;
- must use READ COMMITTED (other isolation levels are refused);
- are serialized by a transaction-level advisory lock (key `7208431001`) held until commit, so keep audit inserts in
  short transactions. Verified with 8 concurrent writers x 100 inserts: contiguous chain, no errors.

Categories: `authentication`, `authorization`, `data_access`, `data_change`, `administration`, `security`, `system`.
Outcomes: `success`, `denied`, `failure`. `detail` is a JSON object of at most 8 KiB with non-PHI context.

## Verification
```sql
SELECT * FROM audit.verify_chain();            -- whole chain: (rows_checked, NULL, NULL) when intact
SELECT * FROM audit.verify_chain(10000, 20000); -- a range, anchored on row 9999
```
Detects edited rows, removed rows inside the chain and broken links. It cannot detect removal of the newest rows or a
rebuilt chain by someone with owner/superuser rights: that needs the latest `(seq, hash)` exported periodically to
storage outside this database (anchoring, below; the export job itself runs in hms_services/ops).

## Not decided yet
Retention period (legal/compliance input required), partitioning by `recorded_at`, the anchoring job's schedule and
external target, and export to the security monitoring stack.

## External anchoring (0019)
1. The anchoring job (`hms_audit_append`) calls `audit.chain_head()` (SECURITY DEFINER, since it cannot read the
   trail).
2. It stores `(seq, hash)` outside the database: object-lock/WORM storage, an RFC 3161 time-stamp authority, or an
   off-site log.
3. It inserts a row into `audit.chain_anchors`. The insert is refused unless `(seq, hash)` matches the chain.

`SELECT * FROM audit.verify_anchors();` (auditor) lists anchors that no longer match: an anchored row was rewritten or
removed. Together with `verify_chain()` and the external copy, this detects truncation of the newest rows as well.
