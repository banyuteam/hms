# CLAUDE.md — Hospital Information System Web Application

> Project-level instructions for Claude Code and other AI coding assistants.
> Follow applicable workspace-level security, privacy, quality, and governance requirements. These project instructions specialize the application architecture but do not override mandatory safeguards.

## 1. Project identity and context

This repository contains a browser-based hospital management system single-page application (SPA) with multi-window and workspace-clear screen as the top UI feature.

With top-level routes:

- `/` : Home
- `/login` : sign-in (demo accounts, or the Khanza login with live data)
- `/{workflow}` : a workflow window (`profile`, `records`, `encounter`, `diagnostics`, `lab`, `radiology`, `billing`, `prescription`, `access`, `tariffs`) — kind only, never an identifier

This project (`hms_workspace/web`) is the existing Banyumanik 2 workspace (EMR remodel on the stack in §2), connected to the v4 `hms_services`. This workspace is self-contained: do not reference, link to or depend on projects outside `hms`. See `README.md` and `docs/adr/0001-replatform-react18-tailwind3.md`. Workspace-level rules (`../CLAUDE.md`, root `CLAUDE.md`) also apply.

The hospital management system, a digital platform that automates and connects clinical, administrative, financial, and operational tasks across a healthcare facility. Currently we have database medical records operated from other Java GUI application. This is the upgraded-level of the old ones. This application is the hospital management system described as the collection workflows by multiple departments and units. Our main focus is to collect:

- Patient Management: View patient profiles, background, blood type, identity, NIK, registered providers in this hospital, default provider, emergency contact, list of medical records history in this hospital.
- Insurance claim workflows: Review the patient medical records, review each of supporting diagnose, the medical history from admission to discharge, break into detail of prescription given, laboratory, radiology, all of occurrences during the medication (PRE/POST/ONGOING). All the data coming from source database (MySQL)
- Finance operation workflows: Filing/Submit/Track medication claim to provider, request/tracking/executing internal payment from other unit (in advance or reimbursement or direct payment) and from finance unit (payment collection from bills received), process/execute salary for employee and doctor, collecting bills received,.

Before add new a feature, inspect the actual repository, `package.json`, lockfile, source files, and configuration. The repository is the source of truth for implementation status. If code and this document conflict, report the discrepancy; do not silently invent facts.

## 2. Required technology stack

| Area              | Required technology                       |
| ----------------- | ----------------------------------------- |
| Language          | TypeScript 5.7                            |
| UI                | React 18.3                                |
| Build tool        | Vite 6                                    |
| React integration | `@vitejs/plugin-react`                    |
| Package manager   | npm                                       |
| Build command     | `npm run build`                           |
| Build pipeline    | `tsc -b && vite build`                    |
| Routing           | React Router 6                            |
| Styling           | Tailwind CSS 3.4                          |
| CSS processing    | PostCSS and Autoprefixer                  |
| Class composition | `clsx` and `tailwind-merge`               |
| Forms             | React Hook Form                           |
| Validation        | Zod                                       |
| Form resolver     | `@hookform/resolvers`                     |
| Icons             | `lucide-react`                            |
| State             | React Context and in-memory reducers      |
| Localization      | Custom resources in `src/locales/{id,en}` |

Do not introduce React 19, TypeScript 6, Vite 8, Tailwind CSS 4, React Aria Components, Zustand, TanStack Query, FormatJS/react-intl, or pnpm as part of the default architecture.

DO NOT add dependencies merely because they are familiar or already in use (In case cannot be replaced). First check whether the current stack already provides the capability. Add or upgrade packages only when justified by a concrete requirement and compatible with the pinned versions.

### Package and build rules

- Use npm and respect the repository's existing lockfile.
- Do not mix npm, pnpm, and Yarn lockfiles.
- `npm run build` is the canonical production build and must execute `tsc -b && vite build`.
- Do not bypass TypeScript errors to make a build pass.
- Do not change major dependency versions without explaining compatibility and migration impact.
- Keep runtime dependencies and development dependencies correctly classified.

## 3. Application architecture

The application is a browser-only SPA. Maintain clear separation of concerns.

Suggested responsibilities (adapt to the existing repository rather than reorganizing it without reason):

- `src/pages/` — route-level page composition.
- `src/components/` — reusable UI components.
- `src/features/` — feature-oriented modules where appropriate.
- `src/state/` — React Context providers and reducers.
- `src/data/` — demo and fixture data.
- `src/locales/` — Indonesian and English resources.
- `src/styles/` — global styles, Tailwind directives, and design tokens.
- `src/lib/` — small shared utilities.
- `src/types/` — genuinely shared TypeScript types.
- `src/assets/` — local static assets.

### Component rules

- Keep it workspace-clearer and few clicks to operate.
- Multi-window appears
- Prefer small, composable, single-responsibility components.
- Separate route/page composition from reusable UI primitives.
- Keep business rules out of presentational components.
- Use explicit, strongly typed props.
- Avoid premature abstraction and oversized generic component frameworks.
- Keep state local unless it must be shared.
- Reuse existing components before creating duplicates.
- Avoid unnecessary prop drilling; use feature-level context or composition where appropriate.

### Routing rules

Use React Router 6 for top-level routes only.

| Path          | Purpose          |
| ------------- | ---------------- |
| `/`           | Home             |
| `/{workflow}` | Workflow Modules |

- Centralize route definitions in the existing router entry point.
- Use APIs supported by the installed React Router 6 version.
- Do not put sensitive identifiers, credentials, tokens, or personal/payment data in URLs.
- Do not use query strings or route parameters as a substitute for sensitive application state.
- Provide not-found handling.
- Preserve browser navigation and configure deployment fallback for SPA deep links.
- Do not add nested routes or loaders unless a concrete requirement needs them.

## 4. Styling and design system

Use Tailwind CSS 3.4 with PostCSS and Autoprefixer. Do not use Tailwind v4 syntax, configuration, or Vite plugin conventions.

### Strict token theme

Design tokens already specified in design-tokens skill.
The primary brand color is **`#264f78`**.

Maintain semantic tokens for:

- Primary and primary foreground.
- Secondary and secondary foreground.
- Background and surface.
- Elevated surface.
- Primary, secondary, and muted text.
- Border and divider.
- Success, warning, danger, and information.
- Focus ring.
- Disabled, hover, and active states.

Use CSS custom properties as the source of truth and reference them through the Tailwind 3.4 theme configuration. Do not scatter raw hexadecimal values through JSX or arbitrary Tailwind classes. If a token is missing, add it centrally and use its semantic name.

### Tailwind conventions

- Configure Tailwind 3.4 through `tailwind.config.*`.
- Configure PostCSS through the project's PostCSS configuration.
- Include Tailwind base, components, and utilities directives in the main stylesheet.
- Use utility classes for layout and styling.
- Use `clsx` for conditional class composition and `tailwind-merge` to resolve conflicting Tailwind classes.
- Prefer a shared `cn()` helper if the repository uses or adopts that convention.
- Avoid inline styles unless values are genuinely dynamic and cannot reasonably be represented by tokens/utilities.
- Do not introduce CSS Modules or a second styling system.

Example helper:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Responsive and accessible UI

- Design for only web and desktop sizes and input methods.
- Ensure keyboard navigation and visible focus states.
- Use semantic HTML and accessible names.
- Associate labels, descriptions, and validation messages with controls.
- Do not communicate status through color alone.
- Maintain adequate contrast and usable target sizes.
- Use `lucide-react` consistently; do not substitute emoji for interface icons.

## 5. State management

Use React Context and in-memory reducers. Do not introduce Zustand, Redux, MobX, or another state library unless the project owner explicitly approves an architectural change.

Established state modules:

- `src/state/home.tsx` — window manager (Home workspace: windows, layout, dock order).
- `src/state/auth.tsx` — session user (demo, or live from hms_services with its permission codes), in memory; the server session itself is an HttpOnly cookie. `usePermission(code)` shapes the UI only.
- `src/state/assistant.tsx` — AI assistant panel, tags, chat (in memory).
- `src/state/session.ts` — `useEndSession()`: wipes all of the above + the data cache on sign-out / idle lock / 401, and ends the server session (not after a 401).
- `src/lib/resource.ts` — in-memory data cache for `src/api` repository functions (replaces TanStack Query).

Preserve these boundaries unless repository inspection shows a deliberate newer structure.

### Reducer conventions

- Use typed state, action, and dispatch definitions.
- Keep reducers pure and deterministic.
- Do not perform network calls, localStorage access, timers, or other side effects inside reducers.
- Use action names that describe domain events or requested state transitions.
- Keep related state and actions together.
- Avoid one global context for unrelated state.
- Split contexts when unrelated updates cause unnecessary re-renders.
- Memoize provider values when there is a real structural or measured need.
- Derive values instead of storing redundant state where practical.

### Persistence policy

The application is in-memory by default.

**The only permitted localStorage persistence by default is the enrolled demo device record.**

- Do not persist appshell states, window contents, authentication state, data, transaction data, or other application state to localStorage.
- Do not introduce sessionStorage, IndexedDB, cookies, browser databases, or service-worker caches for application data without explicit approval.
- Never store secrets, credentials, tokens, personal data, or payment data in browser storage.
- Keep the demo device record minimal and non-sensitive.
- Validate and version the record when reading it; handle malformed, missing, or outdated values safely.
- Encapsulate permitted localStorage access in a dedicated helper/module.
- Do not access localStorage inside reducers.
- Do not treat demo device enrollment as proof of secure device identity or production authentication.

If persistence becomes a requirement, first propose a data-classification, threat, lifecycle, and storage design.

## 6. Demo data and API boundaries

Demo data is located in `src/data/`.

- Clearly distinguish fixtures/demo data from production API data.
- Do not embed demo records directly in UI components.
- Keep demo data deterministic and typed.
- Never represent synthetic data as real customer or transaction data.
- Avoid realistic personal or payment data that could be mistaken for real records.
- Keep data access behind small service/repository functions where that improves testability.
- The only backend clients are `src/api/liveApi.ts` (data; `liveGet`, `liveSend`) + `src/auth/authApi.ts` (sign-in/session/sign-out), and they talk only to hms_services on the same origin (`/api/v1`, contracts in `hms_services/contracts/api/`). Feature clients such as `src/features/iam/iamApi.ts` build on `liveApi` and validate every answer with Zod. Enabled by the build choice `VITE_DATA_SOURCE=bff` (historical name); never guess the data source at runtime.
- Do not introduce another backend client or remote API integration unless requested and specified.
- Do not assume any other backend, API gateway, or database exists without repository evidence.

When a real API is introduced, define its contract, authentication, error handling, loading states, timeout behavior, and data ownership before connecting it to UI components.

## 7. Forms and validation

Use React Hook Form with Zod through `@hookform/resolvers`.

- Define schemas close to the feature that owns the form unless they are shared contracts.
- Infer TypeScript types from Zod schemas where practical.
- Use `zodResolver` to connect schemas to React Hook Form.
- Display clear, localized validation messages.
- Keep validation rules out of presentational components.
- Validate again at the trusted server boundary when a backend exists; client validation is not a security control.
- Reuse canonical schemas where appropriate rather than duplicating definitions.

Example:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
});

type FormValues = z.infer<typeof schema>;

const form = useForm<FormValues>({
  resolver: zodResolver(schema),
  defaultValues: { name: '' },
});
```

## 8. Localization

Use custom locale resources under:

- `src/locales/id/`
- `src/locales/en/`

Indonesian (`id`) is the default locale; English (`en`) is secondary.

- Do not introduce FormatJS/react-intl or another localization framework unless approved.
- Follow the existing locale loader and message-access pattern.
- Do not hardcode user-facing text in components when it should be localized.
- Keep message keys consistent between Indonesian and English.
- Use Indonesian as fallback when a translation is missing, unless product requirements say otherwise.
- Format currency, numbers, and dates with locale-aware APIs and explicit locale settings.
- Avoid concatenating translated fragments when a complete localized message is more appropriate.
- Keep internal identifiers and machine-readable enums independent from translated labels.
- Do not translate provider codes or canonical domain values.
- When adding user-visible text, update both locale resource sets in the same change.

## 9. Authentication and security

The current `auth` state module supports the application's demo behavior. Do not imply that demo authentication is production-grade security.

- Never hardcode credentials, API keys, private keys, or secrets.
- Never put secrets in `VITE_` environment variables; Vite exposes these values to browser code.
- Treat browser input and client state as untrusted.
- Do not store authentication tokens or credentials in localStorage under the current persistence policy.
- Do not expose sensitive information in URLs, logs, source maps, error messages, or demo fixtures.
- Do not rely on hidden UI elements or client-side route guards as authorization.
- Clearly label demo-only authentication and device enrollment.
- If production authentication/authorization is requested, design a trusted server-side boundary and obtain approval before changing the demo model.
- Live sign-in is hms_services auth-v1 (ADR-SVC-001): the person's own Khanza user ID and password; the browser never holds a token; the session is an HttpOnly, SameSite=Strict cookie; state-changing requests are protected by the server's Origin check (no CSRF token in the browser). There is no PIN or dev sign-in (owner decision 2026-11-08: no stored credentials). IAM administration (`/access`) uses iam-admin-v1 (ADR-SVC-002); the server enforces every permission and guard (self-change, last administrator, system role).

## 10. Accessibility

Accessibility is a default engineering requirement.

- Use semantic landmarks and headings.
- Ensure controls have accessible names.
- Associate labels, descriptions, and errors with form fields.
- Support keyboard operation and visible focus.
- Manage focus correctly in dialogs and overlays.
- Provide accessible feedback for appshell and window state changes.
- Each open window equal to open virtual workflow.
- Respect reduced-motion preferences.
- Prefer native HTML semantics over unnecessary ARIA.
- Test important flows with keyboard navigation and automated accessibility checks when tooling is available.

Do not add React Aria Components under the current stack decision.

## 11. Testing and quality

Use tools already present in the repository. Inspect `package.json` and configuration before adding test dependencies.

Quality checks may include, as configured:

- TypeScript build/type checking.
- Vite production build.
- Unit and component tests.
- React Testing Library.
- `@testing-library/user-event`.
- Playwright end-to-end tests.
- axe-core accessibility checks.
- ESLint.
- Prettier.

Do not claim a tool is installed unless verified.

Test at least:

- Route rendering and navigation.
- Window manager transitions (open, tile, maximise, minimise, retarget) and workflow routes.
- Reducer transitions.
- Settings behavior.
- Demo device enrollment and malformed stored data (when enrollment is implemented — not built yet).
- Form validation and localized errors.
- Locale fallback and message completeness.
- Keyboard and accessibility behavior.
- Empty, loading, error, and success states where applicable.

Do not weaken TypeScript, lint, or test settings to make a build pass. Report checks that could not be run.

## 12. Performance and maintainability

- Avoid unnecessary dependencies and global state.
- Keep components focused and render work predictable.
- Use memoization only when justified by structure or measurement.
- Avoid premature optimization.
- Consider bundle size and import only the icons/features needed.
- Use route-level lazy loading for substantial features when appropriate.
- Keep demo data separate from UI components.
- Prefer readable code over clever abstractions.

## 13. Environment and configuration

- Only non-secret public configuration may use the `VITE_` prefix.
- Never put secrets in client-side environment variables.
- Validate required configuration at startup.
- Keep environment-specific configuration explicit.
- Do not commit `.env` files containing secrets.
- Provide `.env.example` with placeholders only.

## 14. Change and migration rules

When changing architecture or dependencies:

1. Inspect `package.json`, lockfile, Vite config, TypeScript config, Tailwind config, PostCSS config, and relevant source usage.
2. Identify current versus target versions.
3. Check peer dependency and plugin compatibility.
4. Identify affected files and behavior.
5. Propose a staged migration for broad changes.
6. Update configuration and source code consistently.
7. Run type checking and the production build.
8. Run relevant tests and linting if configured.
9. Review bundle and runtime implications.
10. Update this file and project documentation when architecture changes.

Do not leave an accidental hybrid architecture with obsolete dependencies, conflicting CSS systems, multiple routers, or duplicate state-management approaches.

## 15. Task execution protocol

For every substantial task:

1. **Contextualize:** Read this file, `package.json`, lockfile, application entry point, relevant source files, and documentation. Inspect actual code before assuming a feature exists.
2. **Analyze:** Identify the requested outcome, affected routes/components/state, data flow, accessibility, localization, security, and test impact.
3. **Plan:** Propose a small implementation plan. Ask a concise question only if an unresolved decision materially blocks correct work.
4. **Implement:** Follow the existing architecture and design tokens. Avoid unrelated refactoring.
5. **Verify:** Run relevant tests and checks available in the repository. Record actual command results.
6. **Review:** Check type safety, responsive behavior, accessibility, localization, state boundaries, storage policy, and dependency impact.
7. **Document:** Update relevant documentation and this instruction file when an architectural decision changes.
8. **Report:** Summarize changes, affected files/modules, dependencies, state/storage impact, commands and actual test results, limitations, and follow-up work.

## 16. Definition of done

- [ ] Acceptance criteria are met.
- [ ] Existing architecture is respected.
- [ ] TypeScript types are correct.
- [ ] UI follows the strict token theme.
- [ ] Indonesian and English messages are updated.
- [ ] Forms use the approved validation approach.
- [ ] State remains in memory unless explicitly approved otherwise.
- [ ] No prohibited browser persistence was introduced.
- [ ] Sensitive data is not exposed in URLs, storage, logs, or bundles.
- [ ] Accessibility and responsive behavior are addressed.
- [ ] Relevant tests/checks were run and reported accurately.
- [ ] Documentation is updated where necessary.
- [ ] No unrelated dependencies or architectural patterns were introduced.

## 17. Final project rule

Build a workspace-clear space, multi-window focused, accessible, maintainable hms workflow SPA using the approved React 18.3, TypeScript 5.7, Vite 6, Tailwind CSS 3.4, React Router 6, React Hook Form, Zod, React Context/reducers, and custom Indonesian/English localization architecture.

When uncertain, inspect the repository, preserve established behavior, and ask before making a material architectural change.
