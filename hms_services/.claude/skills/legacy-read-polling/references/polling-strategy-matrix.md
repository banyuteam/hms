# Polling Strategy Matrix

| Strategy | Inserts | Updates | Deletes | Limitation |
|---|---|---|---|---|
| Reliable update timestamp | Yes | Yes | Usually no | Must be reliable and queryable |
| Monotonic key | Yes | No | No | Old rows may change |
| Snapshot comparison | Yes | Yes | Only with complete snapshot/reconciliation | Read load; intermediate states can be missed |
| Existing audit/tombstone | Depends | Depends | Yes if retained | Must already exist; do not add it |

Choose per table. Document evidence that a timestamp/key is reliable and measure query load.
