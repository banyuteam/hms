# Workspace Platform and Shell Decisions

## Decision 1 — Preserve existing web UI
Existing Banyumanik 2 web application is the visual baseline. New shell architecture wraps and incrementally integrates existing module screens. No wholesale redesign.

## Decision 2 — Web workflow dock
Bottom dock is a dynamic switcher for opened workflow instances. It is not static module navigation. Top navigation owns global controls and AppLauncher.

## Decision 3 — Persistent assistant
Assistant lives at shell level and is independent of dock state. Context is explicitly selected by the user and sent as references.

## Decision 4 — Native mobile is selective
Android and iOS are independent native clients with approved mobile workflows only. They are not expected to reproduce the entire web application or its dock model.

## Decision 5 — Shared domain, different presentation
All clients share API/domain/security contracts. Navigation and UI may differ by platform.
