# Existing UI Preservation and Integration

## Use when
Integrating current Banyumanik 2 HMS screens into the new AppShell or changing the existing visual design.

## Required audit
Inspect routes, design tokens, CSS variables, component library, module screens, forms, tables, login/SSO and responsive behavior. Capture a baseline if possible.

## Mandatory rules
- Preserve established branding, blue/white design language and current tokens.
- Do not redesign from scratch without explicit approval.
- Do not replace working module screens with generic placeholders.
- Wrap existing pages with adapters where possible.
- Keep validation, keyboard behavior, permissions and data integration intact.
- Introduce shell components incrementally and test regressions.

## Acceptance
Every existing workflow remains reachable; new shell navigation works; no module behavior is silently lost; existing design system remains the source of truth.
