---
name: hms-desktop-device-integration
description: Build secure, testable hardware adapters for printers, barcode scanners, serial devices, scanners and supported medical equipment.
---
# HMS Desktop Device Integration

## Principle
Hardware support is capability- and device-specific. Never assume every hospital device exposes a public API or standard protocol. Confirm vendor model, interface, protocol, licensing and supported OS before implementation.

## Adapter architecture
Separate:
- device discovery;
- capability and protocol identification;
- connection lifecycle;
- command/data transport;
- normalization;
- validation;
- error recovery;
- health/status reporting.

Use typed adapter interfaces and per-device implementations. Do not place vendor-specific logic in the WebView or general application workflow.

## Initial device classes
- Printers: OS print subsystem first; vendor SDK only when required.
- Barcode scanners: keyboard-wedge/HID first where suitable; use explicit HID/serial adapter when necessary.
- Serial/RS-232: configured port, baud rate, framing and protocol with bounded reads/writes.
- Document scanners: supported OS/vendor scanning APIs.
- Medical analyzers: vendor-approved protocol/interface and validation; integrate through backend-controlled workflows where appropriate.

## Printing
Use explicit printer IDs and validated job metadata. Support queue state, retries only when safe, duplicate-print protection, page/layout settings, completion/error status and audit references. Distinguish job accepted, spooled, printed and physically verified; do not claim paper output was observed unless the device reports it.

## Clinical and regulated equipment
Never infer clinical values from malformed or incomplete device messages. Preserve units, timestamps, device identity, calibration/status metadata and provenance where supplied. Require clinical validation before committing results to the patient record. Do not bypass vendor safety controls.

## Device security
Restrict device access to configured capabilities. Validate device identity where possible. Bound input size/rate, handle malformed data, isolate device failures and avoid exposing raw device channels to JavaScript.

## Tests
Use simulators and recorded synthetic fixtures. Test disconnects, partial frames, malformed data, duplicate messages, timeouts, device replacement and platform-specific drivers.
