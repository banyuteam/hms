# sso — Instructions

Single sign-on for all users: doctors, employees and patients. Read the root `CLAUDE.md` and
`design/hms_services/sso/PRD.md` first (plans, PRD and skills live in `design/hms_services/sso/`; this folder is the code).

## Rules

- Protocol and identity product are pending an ADR — ask before choosing.
- Credentials and signing keys come from the secret store only; never commit them.
- Every login, logout and failed attempt emits an audit event; never log tokens or full identifiers (mask NIK, phone).
- Patient accounts: identity proofing and consent are hospital decisions — ask.
- Never write to Khanza's user tables.
