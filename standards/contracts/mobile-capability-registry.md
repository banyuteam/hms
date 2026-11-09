# HMS Mobile Capability Registry

## Purpose
Declare which workflow capabilities are intentionally supported by Android and iOS. The registry is not an authorization system; backend policy remains authoritative.

## Principles
- Web is the complete HMS operating environment.
- Android and iOS are native, focused clients for selected mobile workflows.
- Do not hide every web feature in a mobile wrapper and call it a mobile strategy.
- Mobile screens, navigation and interactions should be designed for the device and task.
- The same domain rules and API contracts apply across platforms.
- A capability can be supported on one mobile platform and unavailable on another, with documented rationale.

## Capability metadata
Each capability entry should define:
- Stable capability key and version.
- Business/domain owner.
- Supported platforms: web, android, ios.
- Minimum supported OS version.
- Required device features (camera, biometric, barcode, NFC, secure storage, etc.).
- Network and offline behavior.
- Data synchronization/conflict strategy.
- Authentication and step-up requirements.
- Backend permissions and API dependencies.
- PHI storage/cache policy.
- Audit requirements.
- Test and release status.

## Example (illustrative)
```yaml
capabilities:
  patient.assigned-list:
    platforms: [web, android, ios]
    offline: limited-read-only
    requires:
      - authenticated-user
      - assigned-patient-access

  clinical.observation-entry:
    platforms: [web, android, ios]
    offline: draft-only
    requires:
      - clinical-observation-write
      - encounter-access

  finance.advanced-reporting:
    platforms: [web]
    offline: false
    requires:
      - finance-reporting-access

  system.role-administration:
    platforms: [web]
    offline: false
    requires:
      - iam-administrator
```

## Enforcement
The client uses the registry to shape navigation and avoid offering unsupported actions. `hms_services` must still enforce authorization and capability availability on every request.
