# Environment and Release Matrix

| Concern | Development | CI/Test | Production |
|---|---|---|---|
| Images | Local build/tag | Clean reproducible build | Immutable version/digest |
| Data | Synthetic/de-identified | Ephemeral fixtures | Approved protected data |
| PostgreSQL | Local container acceptable | Ephemeral service | Prefer managed HA database |
| Secrets | Local ignored env or dev secret | CI secret store | Approved secret manager |
| Logs | Developer-friendly | Captured test logs | Structured, redacted |
| Network | Local bridge | Isolated ephemeral network | Private service network + controlled ingress |
| TLS | Local dev option | Test certificates | Approved certificate lifecycle |
| Migrations | Explicit developer command | Controlled pipeline step | Reviewed one-shot release job |
| Backups | Optional local snapshot | Test restore if relevant | Scheduled, encrypted, restore-tested |
| Monitoring | Local health checks | Test reports | Metrics, logs, traces and alerts |
| Security scan | Recommended | Required | Required before release |
| Rollback | Rebuild/revert | Re-run pipeline | Documented image and schema rollback/forward plan |

## Native apps
Android/iOS are built and signed using platform-appropriate pipelines. Containerized build agents may be used where supported, but final signing keys and provisioning material must remain in secure CI secret storage. iOS signing generally requires Apple-compatible build infrastructure.
