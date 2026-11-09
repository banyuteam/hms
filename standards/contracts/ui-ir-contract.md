# HMS Declarative UI Intermediate Representation Contract

## Purpose
This contract defines the safe interchange format between trusted Python UI authoring/compilation in `hms_services`, Go runtime validation/authorization, and the React renderer in `hms_workspace/web`.

## Architecture
- Python is a trusted authoring and compile-time language for repository-controlled UI definitions.
- The Python DSL compiles to a typed, versioned IR.
- Go validates, publishes, resolves authorized data sources and executes registered actions.
- React renders only supported IR nodes using an allowlisted component registry.
- The browser never executes Python and never receives arbitrary code.
- IR is declarative data, not an executable program.

## Required envelope
Every published definition must include:
- `ir_version`
- `definition_id`
- `definition_version`
- `title`
- `component_tree`
- `data_sources` (optional)
- `actions` (optional)
- `validation` (optional)
- `metadata` (author, timestamps, compatibility requirements)
- integrity/hash and publication status in server-side metadata.

## Component nodes
Each node has a stable `id`, allowlisted `type`, typed `props`, optional `children`, optional data `binding`, and optional registered `action_id`. Component-specific props are validated against the registry schema. Unknown component types or unknown props fail validation unless explicitly allowed by a versioned extension.

## Supported declarative capabilities
- Layout composition: page, section, stack, grid, tabs, panel.
- Input components: text, number, date, select, checkbox, radio, textarea.
- Display: text, badge, metric, table, chart, status.
- Interaction: button, dialog, confirmation, approved navigation.
- Data binding: approved resource identifiers and typed field paths.
- Validation: required, length, numeric range, pattern from a safe subset, domain-specific server validation.
- Conditional display: restricted declarative expressions over explicitly supplied non-sensitive state.
- Actions: registered action IDs with typed input/output contracts.

## Forbidden capabilities
- Arbitrary Python, JavaScript, HTML, CSS or SQL execution.
- Dynamic imports, eval, reflection or arbitrary function names.
- Client-provided authorization decisions.
- Arbitrary API URLs or unrestricted network access.
- Unbounded loops/recursion or unbounded component trees.
- Data bindings that bypass approved backend resources.
- Hidden patient-context inference from active tabs or global selection.

## Data and action semantics
- Client sends identifiers and user input, not trusted records or permission claims.
- Go resolves every resource reference and independently authorizes it.
- Action IDs map to server-registered handlers. The client cannot choose a Go function, SQL query or arbitrary URL.
- Server revalidates all input and domain invariants.
- Clinical writes use normal domain workflows, transaction boundaries, audit and signature rules.
- UI visibility is not authorization.

## Versioning and compatibility
- Published versions are immutable.
- A new change creates a new version.
- IR major versions represent breaking contract changes; minor/patch rules are documented.
- Renderer advertises supported IR and component registry versions.
- Server refuses incompatible definitions or serves a compatible published version.
- Rollback changes the active version pointer; it does not mutate historical versions.

## Publication lifecycle
Draft -> compile -> schema validation -> security/policy validation -> preview/test -> approval -> immutable publish -> assignment/activation -> monitor -> rollback if required.

## Accessibility and design system
IR components reference semantic component types and tokens, not arbitrary style strings. React renderer maps these to the existing Banyumanik 2 design system and established design tokens. New visual patterns require design-system review.

## Required tests
Schema validation, compiler golden tests, renderer contract tests, unknown component rejection, malicious payload tests, binding authorization tests, action authorization tests, version compatibility tests, accessibility tests and clinical workflow regression tests.
