# HMS Desktop Bridge — protocol v1

- Status: Proposed (implemented in `src/bridge/`, 2026-11-09)
- Provider: `hms_desktop` (Rust shell)
- Consumers: `hms_workspace` web app when hosted in HMS Desktop (no adapter yet); the packaged startup page
- Decisions: ADR-DSK-001, ADR-DSK-002

## Purpose
The only channel from WebView content to native code. It grants **native capabilities**, never HMS business
authorization: `hms_services` authorizes every request regardless of what the bridge allows.

## Detecting the desktop
The shell defines `window.hmsDesktop` before page scripts run (main frame only):

```ts
interface HmsDesktop {
  readonly protocol: 1;
  invoke(cmd: string, args?: object): Promise<unknown>; // rejects with Error & { code: string }
}
```

Absence of `window.hmsDesktop` = plain browser. A consumer must treat an absent bridge, an unknown `protocol`, or any
rejection as "native capability unavailable" and keep working; it must never block a clinical workflow on the bridge.

## Wire format
Request (page → native), a JSON string via `window.ipc.postMessage`, at most 16 KiB:

```json
{ "v": 1, "id": "<1-64 chars [A-Za-z0-9_-]>", "cmd": "<command id>", "args": { } }
```

- Unknown fields, wrong types, a bad `id` or oversized messages: dropped without a reply (the client times out).
- `args` omitted = `{}`. Arguments are always a JSON object.

Reply (native → page), delivered only to the document that sent the request:

```json
{ "v": 1, "id": "<same id>", "ok": true,  "result": { } }
{ "v": 1, "id": "<same id>", "ok": false, "error": { "code": "<code>" } }
```

| Error code | Meaning |
|---|---|
| `unsupported_version` | `v` is not 1 |
| `unknown_command` | no such command |
| `not_allowed` | the command exists but not for the sender's origin |
| `invalid_args` | arguments do not match the command's schema |
| `busy` | the command cannot run now; retry later |
| `timeout`, `unavailable` | client-side only: no reply within 10 s, or IPC missing |

## Callers
The sender is identified by the **exact origin** of the sending document, reported by the WebView (not by the
message): `Startup` = the packaged startup page; `Hosted` = the one configured HMS origin. Anything else is dropped.
Messages from subframes do not reach the native handler on WebView2 (verified 2026-11-09) and would be rejected by
the origin check if they did.

## Commands
| Command | Callers | Args | Result | Side effect |
|---|---|---|---|---|
| `runtime.get_info` | Startup, Hosted | `{}` | `{ "protocol": 1, "runtime_version": "0.1.0", "os": "windows" }` | none |
| `startup.retry` | Startup | `{}` | `{}` | shell re-probes the hosted origin; `busy` while a probe runs |

No command returns PHI, credentials, session material, file paths or workstation identity.

## Adding a command
1. Add a row here (ID, callers, typed args, result, errors, side effects, audit needs) and a threat model per
   `.claude/skills/hms-desktop-native-bridge-security`.
2. Accept arguments only as a JSON object with explicit field checks (serde also accepts arrays for structs).
3. Add tests for wrong caller, malformed and oversized args, and the failure path.
4. A breaking change to an existing command needs `v: 2`; v1 stays supported until no deployed web build uses it.
