web-frontend
    1. Web workspace: Web workspace that replicates the Khanza desktop UX
    2. Web datatooling: project for backend developer, DBA and data engineer. Report management, ETL tool, ingest events into staging → modeled warehouse/marts for reporting, accessing developer documentation

services:
    1. event-streaming using CDC query polling approach, CDC from Khanza MariaDB → event broker; raw change topics + translation to domain events.
    2. API gateway: audit log, webhooks, document log, and Secured medical-record web service + e-signature
    3. Domain microservices (patient, encounter, orders, billing, …) + API
    4. CDC query polling
    5. AI chatbot agent for BPJS and insurance claim assistance; related to medical records, diagnose, and procedures, BPJS / INA-CBG claim mitigation
    6. single-sign on service to all users including: doctor, employee, patient

database:
    1. PostgreSQL 18: database for domain microservices, ICD-10 & ICD-9-CM catalogue

shared:
    1. Cross-project contracts: event schemas, OpenAPI specs, code-system