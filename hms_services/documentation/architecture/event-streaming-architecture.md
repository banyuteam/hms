# Event Streaming Architecture

Event streaming distributes facts across services; it does not replace authoritative databases.

- Native transactions: transactional outbox.
- Legacy source: read-only polling adapter and change classification.
- Consumers: idempotent, observable and independently scalable where justified.
- Broker: durable distribution/replay subject to retention and security policy.
- Event contracts: centrally versioned.
- Clinical payloads: minimum necessary; prefer identifiers and authorized reads.
