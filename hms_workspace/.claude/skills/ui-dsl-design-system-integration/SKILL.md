---
name: ui-dsl-design-system-integration
description: Connect declarative UI components to the existing Banyumanik 2 design system without visual drift or wholesale redesign.
---
# UI DSL Design System Integration

## Principle
The declarative UI engine is a composition mechanism, not a new visual design system. Existing Banyumanik 2 branding, components, typography, spacing, color tokens, interaction patterns and screen workflows remain the baseline.

## Method
1. Inspect the actual token and component implementation.
2. Map each IR semantic component to an existing React component.
3. Define missing components only when there is a real gap.
4. Keep styling tokens internal to the renderer; IR should express semantic intent, not arbitrary CSS.
5. Test visual parity, keyboard interaction, accessibility, responsive behavior and clinical workflow regression.
6. Version component capabilities and document renderer compatibility.

## Forbidden
- Replacing existing screens without an approved migration.
- Introducing a second competing token system.
- Arbitrary style strings or user-supplied CSS in IR.
- Making all native mobile screens mirror the web renderer.
