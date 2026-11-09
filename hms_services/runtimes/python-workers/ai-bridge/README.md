# hms-ai-bridge

The only HMS component that talks to the external AI model (ADR-SVC-009 D-4). hms-services (Go) calls it on the
private network through the internal contract `hms_services/contracts/internal/ai-bridge-v1.openapi.yaml`; it is never
reachable from browsers or the ingress.

**Status: skeleton (step 2).** Health, readiness, caller authentication, body limit and busy slots work;
`POST /v1/read` answers `503 not_configured` without a provider key and `503 not_implemented` with one. The model call
(Anthropic Python SDK, `claude-opus-5-5`, documents inline, no Files API, no server-side fallback — D-2, D-3) is step 4.

## Boundaries
- Holds the provider key (mounted file) and the bridge secret (mounted file, shared with hms-services). Nothing else.
- No database credentials and no route to PostgreSQL or the legacy HMS. Reads documents from a **read-only** mount by
  storage key only. Outbound network: the provider API only (enforced outside the container; see `deployment/README.md`).
- Logs method, path, status and duration only: never a body, a header value, document content, the question, visit
  facts or an answer.
- Non-root (uid 65532), read-only root filesystem, CPU/memory limits, one slot per in-flight request (429 when full).

## Configuration
| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_ADDR` | `0.0.0.0:8090` | listen address (container) |
| `BRIDGE_SECRET_FILE` | required | file with the shared secret (at least 32 characters) |
| `ANTHROPIC_API_KEY_FILE` | unset | file with the provider key; unset or empty = not configured (readiness fails) |
| `DOCUMENTS_DIR` | `/data/assistant-documents` | read-only document mount |
| `BRIDGE_SLOTS` | `4` | concurrent reads (1-32) |
| `BRIDGE_DEADLINE_SECONDS` | `120` | per-request deadline (10-600) |

## Develop and test
```bash
cd hms_services/runtimes/python-workers/ai-bridge
python -m unittest discover -s tests -v      # Python 3.13, standard library only
docker build -t local/hms-ai-bridge:dev .
```
Tests never call the provider. Development and CI use synthetic documents only (ADR-SVC-009).
