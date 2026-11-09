---
name: hms-desktop-native-bridge-security
description: Design and secure the typed, allowlisted communication boundary between the HMS WebView and Rust native runtime.
---
# HMS Desktop Native Bridge Security

## Threat model
Treat WebView content, message payloads, local files, device data, navigation events and IPC callers as untrusted. The bridge is a privileged security boundary.

## Never expose
- arbitrary shell or process execution;
- arbitrary filesystem paths or unrestricted file access;
- SQL or direct database operations;
- arbitrary Rust function names or dynamic invocation;
- unrestricted network requests;
- raw OS handles or secrets;
- generic plugin loading from untrusted sources.

## Command design
Every command must have:
- stable command ID;
- typed request and response DTO;
- schema/version;
- strict input validation and size bounds;
- explicit capability/permission requirement;
- timeout and cancellation behavior;
- structured error codes;
- audit policy where sensitive;
- tests for unauthorized and malformed requests.

Use domain-oriented methods such as `printer.list`, `printer.submit_job`, `workstation.get_status`, not a generic `invoke_anything` API.

## Authorization
The native bridge permission is not HMS business authorization. Go services remain authoritative for user, tenant, facility, resource and workflow permissions. Native commands must not enable a user to bypass backend checks.

For sensitive local actions, verify current session and capability grant. Require explicit user confirmation for irreversible operations. Bind print or device jobs to an authorized backend job/reference when applicable.

## Filesystem and process controls
Use approved directories and file-picker grants. Validate file type, size and destination. Avoid path traversal and symlink escapes. Never pass untrusted input to a shell. If child processes are necessary, use fixed executable paths and structured argument arrays with strict allowlists.

## Secrets and PHI
Use OS credential stores where available. Do not store secrets or PHI in plaintext config, logs, crash dumps or telemetry. Protect local databases/caches with approved encryption and key lifecycle. Minimize data persisted on shared workstations.

## Testing
Threat-model each new command. Test origin checks, malformed payloads, oversized messages, permission denial, replay, path traversal, symlink handling, command injection, secret leakage and session revocation.
