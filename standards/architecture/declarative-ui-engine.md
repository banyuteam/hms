# HMS Declarative UI Engine

## Mission
Enable configurable and versioned web experiences without replacing the existing React application or allowing arbitrary code execution.

## Ownership
- `hms_services`: Python DSL authoring package, compiler, IR validation, Go UI runtime, data-source registry, action registry, publication and authorization.
- `hms_database`: `ui_platform` schema, migrations, immutable definition versions, assignments and publication metadata.
- `hms_workspace/web`: React renderer, component registry, form state, design-system adapters, action dispatcher and UI preview.
- Root workspace: IR contract, compatibility policy, governance and cross-project release coordination.

## Separation of concerns
Python DSL is not a browser runtime. Python definitions are trusted, repository-controlled authoring artifacts compiled into JSON-compatible typed IR. Go is the runtime authority. React renders approved IR. Existing hand-built React screens remain first-class and may be wrapped by workflow adapters.

## Recommended first vertical slice
1. `Screen`
2. `Section`
3. `TextField`
4. `NumberField`
5. `Button`
6. One approved data source (`clinical.patient_summary`)
7. One registered action (`clinical.assessment.save`)
8. One React renderer and one Go endpoint
9. Compile/validate/publish/rollback tests.

Do not start with a general-purpose page builder, arbitrary expressions, user-authored Python or cross-platform native rendering.

## Data and actions
- Data source identifiers map to server-registered query handlers.
- Bindings are typed paths, not SQL.
- Action identifiers map to registered Go handlers.
- The client cannot submit executable code or authorization assertions.
- Server resolves selected resource references and checks organization/facility/resource/purpose policy.
- Assistant-generated UI definitions are proposals only and must pass the same validation, security and publication controls.

## Existing UI preservation
The current Banyumanik 2 React design, screens, branding, design tokens and workflows remain the visual baseline. DSL rendering must reuse existing components/tokens. Introduce DSL screens incrementally; do not rewrite existing screens merely to make them DSL-driven.

## Persistence
Use `ui_platform` schema for definition identity, immutable IR versions, component/action registry metadata, assignments, publication history and active version pointers. Do not store arbitrary executable source as an active runtime artifact. Source definitions remain in controlled source/version control; published IR is a build artifact with integrity metadata.

## Non-goals
- Replacing React with Python.
- Arbitrary browser code execution.
- A no-code builder before the compiler/runtime contract is stable.
- Automatically making web screens available on Android/iOS.
