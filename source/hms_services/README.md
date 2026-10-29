# hms_services — code

Group folder for the backend services. Each sub-project has its own README, CLAUDE.md and a `.claude/skills` link to its design folder.

| Project | Purpose | Plan & design |
|---|---|---|
| [`event-streaming`](event-streaming/) | CDC query polling from Khanza MariaDB → event broker; raw change topics + translation to domain events | [`design/hms_services/event-streaming`](../../design/hms_services/event-streaming/) |
| [`api-gateway`](api-gateway/) | Audit log, webhooks, document log; secured medical-record web service + e-signature | [`design/hms_services/api-gateway`](../../design/hms_services/api-gateway/) |
| [`domain-services`](domain-services/) | Domain microservices (patient, encounter, orders, billing, …) + APIs | [`design/hms_services/domain-services`](../../design/hms_services/domain-services/) |
| [`ai-claim-assistant`](ai-claim-assistant/) | AI chatbot agent for BPJS / insurance claims (medical records, diagnoses, procedures, INA-CBG mitigation) | [`design/hms_services/ai-claim-assistant`](../../design/hms_services/ai-claim-assistant/) |
| [`sso`](sso/) | Single sign-on for doctors, employees and patients | [`design/hms_services/sso`](../../design/hms_services/sso/) |
