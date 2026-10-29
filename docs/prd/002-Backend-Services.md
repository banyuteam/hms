## Goals and Objectives
1. Always put the consideration priority about the risk of data reliability, low-latency, time limits, timeouts, retries, and avoid the table lock crash.
2. Protocols to workaround: HTTP/HTTPS, Websocket, JSON-RPC 2.0, MCP.
3. External integration services: Bank, Insurance, Government, eSign log.
4. Ready-integration for internal services: patients records privately, webhook, AI agent services (for testing purpose: Claude and OpenAI), existing monolith database records read-only, microservices-ready.
5. Keep consistent on the enterprise endpoints rules.
6. Endpoints documentation always using SwaggerUI
7. Database for workaround: PostgreSQL 18
8. Always stick around with event-sourcing database when plan and design

## Backend services for the event-streaming project
### Rules