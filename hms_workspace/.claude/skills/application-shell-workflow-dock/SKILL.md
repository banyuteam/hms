# Application Shell and Workflow Dock Engineering

## Use when
Implementing web AppShell, global navigation, app launcher, bottom dock, workspace canvas or workflow switching.

## Required model
The shell is persistent. Top navigation contains global controls and AppLauncher. WorkspaceCanvas displays the active workflow. Bottom WorkflowDock contains opened workflow instances. AssistantPanel is persistent and independent.

## Dock rules
- Dock items are workflow instances, not static module categories.
- One module may have multiple open instances.
- Each instance has a stable `workflowInstanceId`.
- Switching tabs preserves independent state.
- Closing dirty workflows requires explicit save/discard/cancel handling.
- Support keyboard navigation and accessible labels.
- Do not treat active dock item as assistant context or authorization.

## Avoid
- Reintroducing permanent left navigation as the primary workflow switcher.
- Treating browser tabs as the workflow model.
- Storing clinical payloads in dock metadata.
- Coupling dock selection to assistant reference selection.
