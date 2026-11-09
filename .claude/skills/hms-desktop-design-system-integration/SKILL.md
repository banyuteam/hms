---
name: hms-desktop-design-system-integration
description: Reuse the canonical hms_workspace design system in HMS Desktop without duplicating components or visual tokens.
---
# HMS Desktop Design-System Integration

## Source of truth
`hms_workspace` owns canonical design tokens, typography, icons, component primitives, patterns and HMS business UI. Desktop consumes these through the approved package/workspace dependency or hosted web application.

## Rules
- Never copy token values or component implementations into `hms_desktop` as a parallel design system.
- Do not fork screens to make them look native.
- Desktop-only shell chrome may use native components where appropriate, but must align with HMS visual language.
- Use existing responsive layouts and introduce desktop-specific variants only through the canonical design-system process.
- Keep density, spacing, typography, colors, focus states and accessibility consistent.
- Any shared component change belongs in `hms_workspace`, not desktop.

## Desktop adaptations
Support window resizing, high DPI, keyboard navigation, multiple monitors and native window chrome. Do not assume every screen is permanently full-screen. Respect existing workflow state and navigation semantics.

## Dependency governance
Use a versioned package or workspace linkage according to the existing monorepo/package strategy. Avoid fragile relative imports across repositories. Document compatibility between desktop runtime and workspace build.

## Validation
Use visual regression screenshots at supported window sizes and DPI scales. Test dark/light themes if supported by the canonical system, keyboard/focus behavior and accessibility. Compare against existing design-system references.
