# Transactional Outbox Pattern

1. Begin database transaction.
2. Apply authoritative business write.
3. Insert event envelope into outbox in the same transaction.
4. Commit.
5. Publisher reads unpublished rows.
6. Publish event.
7. Record delivery metadata.
8. Retry safely after failure.

The publisher may send duplicates if it crashes after broker acceptance but before recording acknowledgement. Consumers must be idempotent. Never publish before commit.
