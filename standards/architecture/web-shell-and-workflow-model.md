# HMS Workspace Web — AppShell and Workflow Model

## Product decision
Preserve the existing Banyumanik 2 HMS web UI as the visual and functional baseline. Introduce the new shell around existing screens incrementally. Do not perform an unsolicited full redesign.

## Shell composition
1. `AppShell`: persistent web application container.
2. `TopNavigation`: hospital identity, global search, notifications, user profile and global actions.
3. `AppLauncher`: opens authorized modules/applications.
4. `WorkspaceCanvas`: renders the active workflow.
5. `WorkflowDock`: bottom dock showing opened workflow instances.
6. `AssistantPanel`: persistent shell-level assistant.
7. `AssistantContextManager`: explicit reference selection and display.

## Bottom dock semantics
The dock is a workflow/window switcher, not static module navigation.
- Each item represents an opened workflow instance.
- A module can open multiple instances, e.g. Patient PT-001 and Patient PT-002.
- Dock supports switch, close, reorder, focus and safe restore.
- Dirty forms require save/discard/cancel handling.
- Dock labels should be concise and distinguish multiple instances.
- A dock item is not an authorization grant or assistant context.

## Workflow instance model
```ts
type WorkflowStatus = "active" | "inactive" | "dirty" | "loading" | "error";

interface WorkflowInstance {
  workflowInstanceId: string;
  workflowType: string;
  title: string;
  resourceReferences: Array<{
    resourceType: string;
    resourceId: string;
    version?: string;
  }>;
  status: WorkflowStatus;
  createdAt: string;
}
```
This is a conceptual client model. Do not persist sensitive clinical payloads in workflow metadata.

## Existing screen integration
- Inventory existing routes and screen components before creating new ones.
- Build workflow adapters around existing screens where possible.
- Preserve form behavior, validation, keyboard shortcuts, data tables and role-based visibility.
- Avoid duplicating module logic to satisfy the shell.
- Migrate one module/workflow at a time.
- Do not make every workflow a separate browser window or independent browser tab.

## Design preservation
The existing prototype establishes a blue-and-white visual direction. Confirm exact tokens from the actual current code before changing them. Known prototype values include:
- Primary `#0878F9`
- Primary dark `#075EC4`
- Ink `#102344`
- Muted `#647A9D`
- Border `#DCE6F5`
- Pale `#F3F8FF`
- Surface `#FFFFFF`

Treat these as a starting reference, not a license to overwrite a more current repository token system.

## Responsive behavior
Web remains a web application. On narrower viewports, dock and shell may adapt responsively, but do not inherit native mobile app navigation requirements. Native Android/iOS are separate applications.

## Assistant placement
Assistant is a persistent shell-level capability, not a dock workflow. It may collapse into a side panel or overlay, but conversation context is independent from active workflow.
