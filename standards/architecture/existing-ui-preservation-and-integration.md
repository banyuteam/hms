# Existing HMS Web UI Preservation and Integration Standard

## Goal
Merge the current HMS web development into the new `hms_workspace/web` architecture without discarding its existing UI investment.

## Before changes
- Inspect current branch and repository.
- Read package manifests, routing, design tokens, CSS variables, component library and screenshots.
- Identify login/SSO flow and post-login landing page.
- Inventory every existing module route and reusable screen.
- Identify mock data versus live API integration.
- Capture baseline screenshots and tests where available.

## Preserve
- Hospital branding and identity.
- Existing color palette and typography where coherent.
- Working authentication and identity-provider integration.
- Existing module screens, business workflows and validation.
- Reusable components, tables, forms and responsive behavior.
- Existing accessibility and keyboard interaction.

## Change only with reason
- Add the AppShell as a composition layer.
- Move global actions into top navigation.
- Introduce AppLauncher for opening modules.
- Introduce WorkflowDock for opened workflow instances.
- Render existing module pages inside WorkspaceCanvas.
- Add persistent AssistantPanel and explicit context selection.
- Remove permanent left navigation only after its functions have been mapped to the new shell and no needed route is lost.

## Anti-patterns
- Replacing the whole UI with a generic dashboard template.
- Rewriting every module just to change navigation.
- Changing the established palette without design review.
- Building duplicate versions of existing module components.
- Assuming the login prototype is the production authentication implementation.
- Replacing real data integration with mock data.
- Treating the dock as a list of static module shortcuts.

## Acceptance
- Existing routes and workflows remain reachable.
- User permissions still control module availability.
- A module can open one or more workflow instances.
- Dock switching preserves each instance's state.
- Active workflow changes do not change assistant references.
- Existing design tokens remain authoritative unless an approved design-system ADR changes them.
