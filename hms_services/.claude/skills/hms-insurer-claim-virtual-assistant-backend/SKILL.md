---
name: hms-insurer-claim-virtual-assistant-backend
description: Design and implement the HMS insurer-claim virtual assistant as a secure, extensible backend capability combining button-based guidance, deterministic rule-based workflows, healthcare terminology catalogues, and optional AI-agent orchestration. Use when building or changing assistant services, claim guidance, claim validation, insurer workflows, or future LLM integrations in hms_services.
---

# HMS Insurer Claim Virtual Assistant — Backend Skill

> **Current phase: deterministic only (owner decision 2026-11-09, ADR-SVC-006 O-8).** The AI-agent mode, the AI
> provider gateway, prompts, model selection and every other LLM-related section below are **deferred**. Do not
> implement them until the owner changes scope through a new ADR. Until then `hms-assistant-workspace-governance`,
> `hms-assistant-rule-engine`, `hms-assistant-api` and `hms-assistant-domain-validation` govern assistant work; the
> button-based and rule-based parts of this skill still apply.

## 1. Mission

Build a reliable insurer-claim virtual assistant for the Hospital Management System (HMS). The assistant helps authorized hospital users understand requirements, prepare claims, validate information, navigate workflows, and retrieve approved reference information.

The assistant combines three interaction and reasoning modes:

1. **Button-based guidance** for predictable, discoverable workflows.
2. **Rule-based assistance** for deterministic validation, eligibility checks, completeness checks, and policy-driven decisions.
3. **AI-agent assistance** for natural-language understanding, explanation, summarization, and controlled tool orchestration when an approved model provider is configured.

These modes must coexist. AI is an optional reasoning layer, not a replacement for deterministic business rules, authorization, clinical judgment, or the authoritative claim workflow.

## 2. Project ownership and boundaries

This skill applies primarily to `hms_services` and must preserve the three-project architecture.

### `hms_services` — runtime authority

Owns:
- Assistant APIs, conversation orchestration, session lifecycle, and backend context resolution.
- Button/menu definitions delivered as safe declarative data.
- Deterministic rule execution and claim validation.
- Catalogue lookup services and terminology mapping.
- AI provider gateway, model selection, prompt assembly, tool registry, and agent orchestration.
- Authentication, authorization, tenant/facility scoping, audit, rate limits, and safety controls.
- Integration with the HMS Interoperability Gateway for approved claim operations.

### `hms_database` — persistence authority

Owns database schemas, migrations, constraints, indexes, reference-data structures, catalogue versions, audit persistence definitions, and data dictionary. The backend owns runtime database access and business transactions.

### `hms_workspace` — user experience

Owns the assistant panel, conversation UI, guided buttons, forms, progress feedback, citations/source presentation, and explicit context selection. It must not own claim rules, authorization decisions, model secrets, or direct database access.

Do not move backend logic into React or create a second assistant-specific database ownership model in the workspace.

## 3. Core architecture

Use a layered design. Keep transport, application orchestration, domain decisions, catalogue access, AI providers, and external integrations separate.

```text
HMS Workspace (React)
  ├── Assistant Panel
  ├── Guided Buttons / Forms
  ├── Conversation Timeline
  └── Explicit Context Selector
          │ HTTPS / SSE
          ▼
HMS Services (Go)
  ├── Assistant API
  ├── Conversation Orchestrator
  ├── Mode Router
  │    ├── Guided Flow Engine
  │    ├── Deterministic Rule Engine
  │    └── AI Agent Orchestrator (optional)
  ├── Catalogue / Terminology Services
  ├── Authorized Tool Registry
  ├── Claim Domain Services
  ├── Interoperability Gateway
  ├── Authorization / Policy Enforcement
  └── Audit / Observability
          │
          ├── PostgreSQL (assistant metadata, rules, versions, audit)
          ├── Approved catalogue/reference data
          ├── Approved AI provider API (optional)
          └── External insurer adapters through Interoperability Gateway
```

The assistant must call domain services through registered backend tools. It must never connect directly to PostgreSQL, insurer websites, or external APIs from the model runtime.

## 4. Interaction modes

### 4.1 Button-based assistant

Use guided interaction for common and high-confidence tasks, including:
- Start a new claim preparation workflow.
- Check required claim documents.
- Check claim completeness.
- Explain a claim status.
- Find a diagnosis or procedure catalogue entry.
- Review missing or inconsistent information.
- Ask for an authorized human review.

Guided flows should be represented as versioned, declarative definitions. A flow can contain prompts, choices, typed inputs, validation references, and registered action IDs.

Example conceptual flow:

```yaml
flow: insurance_claim_assistance
version: 1
steps:
  - id: choose_task
    type: choice
    options:
      - prepare_claim
      - validate_claim
      - check_documents
      - explain_status
  - id: select_claim
    type: authorized_resource_selection
  - id: run_validation
    type: registered_action
    action: claim.validate
```

The YAML is an authoring example, not an executable script. The runtime must validate it against a strict schema and resolve only registered actions.

### 4.2 Rule-based assistant

Use deterministic rules for:
- Required-field checks.
- Document completeness.
- Diagnosis and procedure code format/validity checks.
- Claim amount and date consistency checks.
- Provider-specific prerequisites.
- Workflow-state transitions.
- Warnings, blocking errors, and escalation conditions.

Rules must be:
- Versioned and traceable to an owner/source.
- Deterministic for the same input and rule version.
- Testable without an LLM.
- Explainable, with a machine-readable result and user-readable explanation.
- Scoped by provider, facility, claim type, and effective date where applicable.

Do not encode insurer rules as scattered `if` statements across HTTP handlers or UI components. Centralize them behind a rule service and use explicit rule identifiers.

Example result:

```json
{
  "ruleId": "CLAIM.DOCUMENT.DISCHARGE_SUMMARY.REQUIRED",
  "severity": "blocking",
  "status": "failed",
  "message": "A discharge summary is required for this claim type.",
  "source": {
    "type": "provider_requirement",
    "providerCode": "INSURER_A",
    "version": "2026-01"
  },
  "nextAction": "document.attach_discharge_summary"
}
```

The rule engine reports findings; the claim domain service remains responsible for enforcing state changes and authorization.

### 4.3 AI-agent assistant

AI may be used for:
- Understanding free-text questions.
- Explaining deterministic validation results in plain language.
- Summarizing approved claim information.
- Helping users locate relevant catalogue entries.
- Suggesting the next permitted workflow action.
- Extracting candidate fields from documents for human verification.

AI must not independently:
- Decide clinical diagnoses or replace a clinician.
- Invent ICD, ICD-9-CM, INA-CBG, or iDRG codes.
- Determine final claim eligibility or guarantee reimbursement.
- Approve, sign, or submit claims without the required backend authorization and user approval.
- Change claim, patient, billing, or clinical records by directly generating SQL or arbitrary code.
- Bypass provider rules, hospital policy, or access control.

The agent may propose an action using a registered tool. Go must validate the caller, resource, facility, workflow state, policy, and approval requirements before executing it.

## 5. Mode routing and precedence

Use the following precedence:

1. **Authorization and safety checks** always run first.
2. **Guided flow** is preferred when the user selects a known task or button.
3. **Deterministic rules** are authoritative for validation and policy decisions.
4. **AI** may interpret the request, explain results, or suggest an allowed next step.
5. **Human review** is required for uncertain, conflicting, high-impact, or clinically significant decisions.

An AI response must not override a failed blocking rule. When AI is unavailable, guided and rule-based features must continue to work.

## 6. Healthcare catalogues and terminology

The assistant should support controlled lookup and mapping for:

- **ICD-10** — diagnosis classification.
- **ICD-9-CM** — procedure classification where applicable.
- **INA-CBG** — Indonesian case-based group catalogue and related grouping references, subject to the authoritative version and rules in force.
- **iDRG** — Indonesian diagnosis-related group catalogue and related grouping references, subject to official implementation and versioning.

### Catalogue service requirements

- Store catalogue identity, source, version, effective dates, language, status, and import provenance.
- Preserve original code and description exactly as supplied by the authoritative source.
- Support indexed search by code, exact description, synonyms, and approved aliases.
- Distinguish exact matches, candidate matches, deprecated entries, and no-match results.
- Return version and source metadata with every result.
- Keep historical versions available where needed to explain past claims.
- Never silently replace an older code with a newer code in an existing submitted claim.
- Do not fabricate catalogue entries or infer a code solely from a vague natural-language description.

The assistant may suggest candidate codes, but a qualified user must confirm clinically meaningful coding. Grouping outcomes must be generated by the approved grouping implementation or authoritative provider process, not guessed by an LLM.

## 7. Context, privacy, and authorization

The assistant must follow the HMS Assistant Context Reference Contract (HMS-CRC).

### Explicit context only

- The workspace sends explicit resource references selected by the user.
- Do not infer patient or claim context from the active tab, current route, last opened patient, or unrelated conversation history.
- A new conversation does not inherit prior patient context unless the user explicitly selects it again.
- Send resource identifiers and optional version metadata, not entire clinical records from the browser.
- Go resolves each reference and independently authorizes it against user, tenant, facility, resource, purpose, and action policies.
- Reject or exclude unauthorized references. Never substitute a different patient or claim.

### Minimum necessary data

- Retrieve only the fields required for the requested task.
- Avoid sending PHI to an AI provider unless the hospital has approved the provider, purpose, legal basis, contractual controls, retention settings, and data-processing configuration.
- Prefer de-identified or minimized context where it is sufficient.
- Do not put PHI, access tokens, API keys, or full document contents in application logs or metric labels.
- Apply retention and deletion policies to conversations and extracted content.

### Authorization

Authorization is enforced by Go on every request and every tool execution. UI visibility is not authorization. The assistant is not an authorization authority.

## 8. AI provider gateway

Keep model-provider dependencies behind an internal interface. Claude is a possible provider, not a hard dependency of the assistant domain.

Conceptual interface:

```go
type ModelProvider interface {
    Generate(ctx context.Context, request ModelRequest) (ModelResponse, error)
    Stream(ctx context.Context, request ModelRequest, emit func(ModelChunk) error) error
}
```

Provider implementations should be isolated, for example:

```text
assistant/agent/providers/
  provider.go
  anthropic/
  openai/
  mock/
```

Requirements:
- API keys are held server-side in a secret manager or protected secret store.
- Never expose provider keys to React, mobile clients, logs, prompts, or tool outputs.
- Support provider/model allowlists, timeouts, token limits, request budgets, and rate limits.
- Support a mock provider for deterministic tests.
- Record model/provider/version metadata without storing unnecessary sensitive prompt content.
- Define data-retention and provider-training settings before enabling PHI processing.
- Handle provider outage gracefully; fall back to guided/rule-based capability.
- Do not allow an LLM response to directly invoke arbitrary URLs, shell commands, SQL, filesystem operations, or unregistered functions.

## 9. Tool registry and agent execution

Expose a small set of typed, purpose-specific tools. Examples:

| Tool ID | Purpose | Risk class |
|---|---|---|
| `catalogue.search_icd10` | Search diagnosis catalogue | Read |
| `catalogue.search_icd9cm` | Search procedure catalogue | Read |
| `catalogue.lookup_grouping_reference` | Retrieve approved grouping reference | Read |
| `claim.get_summary` | Retrieve authorized claim summary | Read |
| `claim.validate` | Run deterministic claim validation | Read/compute |
| `claim.get_missing_documents` | Identify missing documents | Read |
| `document.prepare_package` | Prepare a document package | Controlled write |
| `claim.request_approval` | Initiate approval workflow | Controlled write |
| `integration.get_submission_status` | Retrieve external status | Read |
| `integration.submit_claim` | Submit a claim through the gateway | High impact |

Every tool must define:
- Stable ID and version.
- Strict input and output schema.
- Required permissions and resource scope.
- Risk classification.
- Whether user confirmation is required.
- Idempotency behavior where applicable.
- Audit event requirements.
- Timeout and retry policy.

High-impact tools such as signing, final approval, and external claim submission require explicit policy checks and appropriate user confirmation. The LLM cannot grant itself permission or waive a confirmation requirement.

## 10. Interoperability Gateway relationship

The assistant must not implement insurer-specific API clients itself. It should call the existing HMS Interoperability Gateway through application services.

```text
Assistant
   │
   ├── explain claim requirements
   ├── search catalogue
   ├── validate claim
   └── propose submission
          │
          ▼
Claim Domain Service
          │
          ▼
Approval / Signature Workflow
          │
          ▼
HMS Interoperability Gateway
          │
          ├── JRCare adapter
          ├── BPJS adapter
          ├── Private insurer adapters
          └── Other provider adapters
```

The gateway owns provider selection, channel selection (API, approved embedded workflow, assisted automation, or manual handoff), provider credentials, external execution, retries, external references, and reconciliation.

The assistant may explain progress and retrieve status, but must not claim that a submission succeeded merely because a browser click or HTTP request was attempted. Use verified provider acknowledgement or reconciliation evidence.

## 11. Conversation and API contracts

Suggested REST endpoints:

```text
POST   /api/v1/assistant/conversations
GET    /api/v1/assistant/conversations/{conversationId}
POST   /api/v1/assistant/conversations/{conversationId}/messages
GET    /api/v1/assistant/conversations/{conversationId}/events
POST   /api/v1/assistant/conversations/{conversationId}/context
DELETE /api/v1/assistant/conversations/{conversationId}/context/{referenceId}
GET    /api/v1/assistant/guided-flows
POST   /api/v1/assistant/guided-flows/{flowId}/execute
GET    /api/v1/assistant/catalogues/{catalogueCode}/search
```

Example message request:

```json
{
  "message": "What documents are missing for this claim?",
  "mode": "auto",
  "contextReferences": [
    {
      "resourceType": "Claim",
      "resourceId": "opaque-claim-reference",
      "version": 3
    }
  ]
}
```

The server resolves and authorizes references. The `mode` is a user preference, not a privilege. The server may choose a safer mode or refuse an unsupported operation.

Example response structure:

```json
{
  "conversationId": "conversation-reference",
  "messageId": "message-reference",
  "modeUsed": "rule_based",
  "content": "Two required documents are missing.",
  "findings": [
    {
      "code": "DOCUMENT_MISSING",
      "severity": "blocking",
      "resourceType": "Claim",
      "message": "Discharge summary is missing."
    }
  ],
  "suggestedActions": [
    {
      "actionId": "document.attach_discharge_summary",
      "label": "Attach discharge summary",
      "requiresConfirmation": true
    }
  ],
  "sources": []
}
```

Do not trust client-supplied `modeUsed`, permissions, rule results, source citations, or action outcomes. Those are server-generated response fields.

## 12. Persistence model

Use the existing database ownership standards. Assistant persistence should be designed in `hms_database` and executed by Go services. If a dedicated schema is approved, use the existing `ai_platform` schema rather than scattering assistant tables across domain schemas.

Potential tables:

- `ai_platform.assistant_conversations`
- `ai_platform.assistant_messages`
- `ai_platform.assistant_context_references`
- `ai_platform.guided_flow_definitions`
- `ai_platform.guided_flow_versions`
- `ai_platform.rule_definitions`
- `ai_platform.rule_versions`
- `ai_platform.rule_execution_records`
- `ai_platform.agent_tool_registry`
- `ai_platform.agent_execution_records`
- `ai_platform.catalogue_sources`
- `ai_platform.catalogue_versions`
- `ai_platform.catalogue_imports`

Catalogue master data may belong in an appropriate terminology/domain schema if that is already the established owner. Avoid duplicating canonical ICD or grouping catalogues solely because the assistant uses them. Keep source, version, effective date, and provenance explicit.

Do not store raw model prompts or full clinical documents indefinitely by default. Apply purpose-based retention, access controls, encryption, and audit requirements.

## 13. Failure handling and safety

The assistant must handle:
- AI provider timeout or outage.
- Catalogue version unavailable.
- No exact catalogue match.
- Conflicting or incomplete source data.
- Expired or unauthorized context references.
- Rule-engine failure.
- Provider API failure.
- Ambiguous external submission outcome.
- Unsupported workflow operation.

Expected behavior:
- Continue with deterministic and guided functionality when AI is unavailable.
- Report uncertainty clearly.
- Do not fabricate missing facts or code values.
- Do not silently downgrade a blocking validation to a warning.
- Escalate clinical coding ambiguity to a qualified user.
- Treat external submission timeout as `outcome_unknown` until reconciled; do not blindly resubmit.
- Preserve the original provider response and normalized status separately.

## 14. Testing requirements

### Unit tests
- Rule determinism and effective-date selection.
- Catalogue exact and fuzzy search behavior.
- Provider/model routing.
- Tool schema validation.
- Permission and resource-scope checks.
- Workflow state transitions.

### Integration tests
- Assistant to claim domain service.
- Assistant to catalogue service.
- Assistant to Interoperability Gateway.
- AI provider mock integration.
- PostgreSQL persistence and migrations.
- SSE streaming and reconnect behavior.

### Security tests
- Cross-facility access attempts.
- Unauthorized patient/claim references.
- Prompt injection in user text and uploaded documents.
- Tool argument tampering.
- Attempts to invoke unregistered tools.
- Attempts to expose API keys or secrets.
- PHI leakage in logs and telemetry.
- Repeated submission and idempotency scenarios.

### Evaluation tests
- Correctness of claim requirement explanations.
- Correct handling of missing/ambiguous catalogue matches.
- AI adherence to deterministic rule results.
- Safe refusal for unsupported clinical or financial decisions.
- Consistency between guided and natural-language routes.

Use synthetic or properly de-identified data in development and test environments.

## 15. Observability

Integrate with the existing HMS observability stack (Prometheus, Grafana, Loki, and OpenTelemetry where configured).

Useful metrics include:
- `assistant_requests_total`
- `assistant_request_duration_seconds`
- `assistant_mode_selected_total`
- `assistant_rule_evaluations_total`
- `assistant_rule_failures_total`
- `assistant_catalogue_search_total`
- `assistant_tool_calls_total`
- `assistant_tool_denials_total`
- `assistant_ai_provider_errors_total`
- `assistant_escalations_total`

Use bounded labels such as mode, provider, operation, and outcome. Never use patient IDs, claim IDs, medical record numbers, or free-text prompts as metric labels.

## 16. Implementation sequence

Build in small vertical slices.

### Stage 1 — Deterministic foundation
- Assistant API and conversation lifecycle.
- Explicit context reference contract.
- Guided button flows.
- Catalogue search service.
- Rule engine and validation result model.
- Audit and tests.

### Stage 2 — Claim assistant
- Claim summary tool.
- Missing-document checks.
- Claim validation flow.
- Provider-specific requirement configuration.
- Human review and approval handoff.

### Stage 3 — AI provider gateway
- Model provider interface and mock provider.
- One approved provider implementation (Claude may be used through a server-side API key).
- Natural-language intent routing.
- Safe tool calling.
- Streaming responses and usage limits.
- AI outage fallback.

### Stage 4 — Interoperability integration
- Assistant tools call claim domain services.
- Claim domain services invoke the Interoperability Gateway.
- Submission approval and signature controls.
- External status and reconciliation explanations.

### Stage 5 — Controlled expansion
- Additional provider adapters.
- Additional catalogues and versioned references.
- Document extraction with human verification.
- Evaluation datasets and quality monitoring.

## 17. Definition of done

A feature is not complete unless:

- The correct project owns the code and data contract.
- Go enforces authentication, authorization, and resource scope.
- Guided and rule-based functionality works without an AI provider.
- AI cannot bypass rules, permissions, approvals, or workflow state.
- Catalogue results include source and version provenance.
- No arbitrary SQL, code execution, URL fetching, or unregistered tool invocation is possible.
- PHI is minimized and protected throughout the workflow.
- High-impact actions require the configured approval and confirmation controls.
- External submissions are idempotent where supported and reconciled when uncertain.
- Audit and observability are implemented without leaking PHI.
- Unit, integration, security, and evaluation tests pass.
- Existing HMS UI, AppShell, design tokens, and working workflows remain intact.

## 18. Non-negotiable engineering rules

1. Go backend is the runtime authority for business rules, authorization, tools, and external actions.
2. React is a presentation client and must never connect directly to PostgreSQL or provider credentials.
3. Button-based and rule-based assistance must remain useful without AI.
4. AI is advisory and may only invoke registered, typed, authorized tools.
5. Clinical coding suggestions require qualified human confirmation where clinically meaningful.
6. ICD-10, ICD-9-CM, INA-CBG, and iDRG references must be versioned and traceable to authoritative sources.
7. The assistant must use explicit HMS-CRC context references and must not infer patient context from navigation state.
8. External submissions must go through the HMS Interoperability Gateway.
9. Never claim an external transaction is complete without verified evidence.
10. Preserve the existing three-project ownership architecture and HMS UI; implement incrementally.
