# HMS High-Level Architecture

## Platform view

```text
                  Hospital Users / External Verifiers
                              |
               +--------------+---------------+
               |                              |
         HMS Workspace Web              Native Mobile Clients
         React / TypeScript              Android / Kotlin
         Complete HMS UI                 iOS / Swift
         Workflow Dock                   Approved mobile subsets
         Assistant Panel                 Native mobile assistant
               |                              |
               +---------------+--------------+
                               |
                    Versioned API Contracts
                               |
                        hms_services
                 Go application/runtime authority
       +-----------------------+-------------------------+
       |                       |                         |
  Domain services        Identity & AuthZ        Assistant orchestration
  Commands / Queries     Resource resolution     Retrieval / tool policy
  Workflow runtime       Audit enforcement       Digital signature flows
  Legacy polling         Event integration       External verification
       |                       |                         |
       +-----------------------+-------------------------+
                               |
                    Canonical data contracts
                               |
                        hms_database
                         PostgreSQL 18
       +-----------------------+-------------------------+
       |                       |                         |
  Canonical domain       Clinical Read Models       Audit / Outbox
  schemas & migrations   query projections          checkpoints / mappings
       |
  Legacy MySQL (read-only, unchanged)
       ^
       |
  Legacy Read Polling Adapter in hms_services
```

## Project responsibilities
- Database project defines what data means and how it is persisted.
- Services project defines what operations mean, who may perform them and how they execute.
- Workspace project defines how authorized users interact with those operations on each platform.

## Web versus native mobile
The web application is the comprehensive operating environment. It supports the full approved HMS module set, multi-workflow workspace, bottom dock, advanced reporting and administration.

Native mobile apps are separate native applications with deliberately selected workflows. They share API/domain/security contracts but may have different navigation, screen composition, offline behavior and device integrations.

## Existing web UI preservation
The existing Banyumanik 2 HMS interface is the baseline. Preserve its branding, visual language, tokens, established module screens and working behavior. The AppShell is an architectural integration around existing screens, not a mandate to redesign them.

## Data authority
- New transactional writes: `hms_services` business workflows using `hms_database` persistence (native layer).
- Legacy data into the canonical record: the legacy bridge, per domain until that domain's cutover (ADR-ROOT-002).
- Legacy historical reads: controlled read-only adapters.
- Clinical Read Models: query projections, not independent write authorities.
- Assistant: read/reasoning interface governed by service authorization; not a source of truth.
- Digital signatures: backend-controlled signing workflow and verifiable evidence, not a UI decoration.

## Key flows
### Standard web workflow
User -> AppShell -> Workflow Manager -> module screen -> API client -> hms_services -> authorized domain operation -> hms_database.

### Assistant context workflow
User explicitly selects resource(s) -> Workspace creates context reference manifest -> assistant request -> services authenticates user -> resolves each reference -> authorizes each resource -> retrieves allowed content -> AI orchestration -> response with traceable source references.

### Legacy read workflow
Legacy MySQL -> SELECT-only LRPA in hms_services -> mapping/validation -> persistence/checkpoint in new PostgreSQL -> approved read model/event flow.

### Signature verification
Authorized signer -> signing workflow in hms_services -> identity/authorization and signature evidence -> immutable/versioned record state -> public verification URL or QR -> verification endpoint exposes only approved minimal evidence.
