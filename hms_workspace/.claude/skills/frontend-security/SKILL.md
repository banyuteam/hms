# HMS Client Security

## Use when
Implementing authentication, session handling, local persistence, permissions, assistant context, signatures or sensitive UI.

## Rules
- Backend authorizes every resource and operation.
- UI route guards are usability controls only.
- Do not persist access tokens or PHI in unsafe browser storage.
- Apply CSP and safe output rendering; avoid unsafe HTML injection.
- Protect against XSS, CSRF where applicable, clickjacking and dependency compromise.
- Do not log credentials, tokens or clinical payloads.
- Clear sensitive client state on logout/session expiry.
- Verify deep links and external verification pages expose only approved fields.
- A digital signature is not a checkbox, typed name or image of a signature.
