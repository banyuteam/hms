# Workflow Instance Engineering

## Use when
Creating workflow registry, lifecycle, persistence, tab state or multiple instances of modules.

## Model
A workflow instance has stable ID, workflow type, safe title, resource references, status, created time and client state. Sensitive clinical payloads do not belong in generic persistence metadata.

## Lifecycle
Open -> loading -> active/inactive -> dirty (optional) -> close/restore. Define transitions and invalid states explicitly.

## Rules
- Distinguish workflow type from workflow instance.
- Do not use URL alone as the identity of an instance.
- Switching instance must not reset another instance.
- Persist only safe state; apply session/user scoping and expiry.
- Restore must revalidate current permissions and resource availability.
- Prevent stale data from being presented as current.
