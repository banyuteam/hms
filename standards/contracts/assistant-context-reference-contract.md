# HMS Assistant Context Reference Contract (HMS-CRC)

## Purpose
Define a platform-neutral way for web and native clients to tell `hms_services` which resources the user explicitly wants the assistant to consider.

## Non-negotiable rules
1. Every resource context must be explicitly selected by the user or by a clearly user-confirmed action.
2. Active tab, active patient, current screen, global search state or prior conversation context MUST NOT silently add resources.
3. Client references are identifiers, not proof of access.
4. `hms_services` authenticates the requester and independently resolves and authorizes every reference.
5. Tenant, facility, organizational, patient relationship, purpose and resource-level policies apply.
6. Unauthorized or unresolved references must be reported clearly; never substitute a different resource.
7. Context must be scoped to a conversation/request and must not leak into unrelated conversations.
8. Version/time semantics must be explicit when a user selects a versioned or historical record.
9. Minimize PHI in request metadata, logs and traces.
10. A successful authorization check does not authorize arbitrary follow-on resource discovery.

## Conceptual request
```json
{
  "conversation_id": "opaque-conversation-id",
  "message": "Summarize these results.",
  "context": {
    "references": [
      {
        "resource_type": "patient",
        "resource_id": "opaque-resource-id",
        "version": "optional-version"
      },
      {
        "resource_type": "laboratory_result",
        "resource_id": "opaque-resource-id",
        "version": "optional-version"
      }
    ]
  }
}
```

This is illustrative. Final field names, identifiers, limits and error schemas must be defined in the API contract.

## Server processing
1. Authenticate user and tenant.
2. Validate request schema, reference count, resource types and conversation ownership.
3. Resolve each reference through approved domain services.
4. Enforce resource-level authorization and purpose limitation.
5. Apply version, status and temporal constraints.
6. Retrieve minimum necessary content.
7. Build a bounded, provenance-aware assistant context.
8. Record auditable reference IDs and authorization outcome without logging unnecessary clinical content.
9. Invoke only approved assistant tools.
10. Return answer plus traceable source references and any excluded-reference explanations.

## Client responsibilities
- Display attached reference chips with resource type and safe label.
- Allow add/remove before sending.
- Make the scope visible while composing and after sending.
- Do not attach references automatically on tab switch.
- Do not place raw clinical records in local storage or analytics.
- Clear or explicitly confirm context when starting a separate conversation.

## Security tests
- User attempts to attach another tenant's patient.
- User has patient access but not access to a restricted document.
- Stale/deleted resource reference.
- Resource changes after selection.
- Conversation ID belongs to another user.
- Tab switch does not alter attached references.
- New conversation does not inherit previous references.
- AI tool attempts to expand context without authorization.
