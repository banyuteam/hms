# hms_services — plan & design

Group folder for the backend services. Each sub-project has its own PRD, README and skills.

| Project | Purpose | Code |
|---|---|---|
| [`event-streaming`](event-streaming/) | CDC query polling from Khanza MariaDB → event broker; raw change topics + translation to domain events | [`source/hms_services/event-streaming`](../../source/hms_services/event-streaming/) |
| [`api-gateway`](api-gateway/) | Audit log, webhooks, document log; secured medical-record web service + e-signature | [`source/hms_services/api-gateway`](../../source/hms_services/api-gateway/) |
| [`domain-services`](domain-services/) | Domain microservices (patient, encounter, orders, billing, …) + APIs | [`source/hms_services/domain-services`](../../source/hms_services/domain-services/) |
| [`ai-claim-assistant`](ai-claim-assistant/) | AI chatbot agent for BPJS / insurance claims (medical records, diagnoses, procedures, INA-CBG mitigation) | [`source/hms_services/ai-claim-assistant`](../../source/hms_services/ai-claim-assistant/) |
| [`sso`](sso/) | Single sign-on for doctors, employees and patients | [`source/hms_services/sso`](../../source/hms_services/sso/) |
