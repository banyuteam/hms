---
name: react-ui-ir-renderer
description: Build a safe, typed React renderer for approved HMS UI IR using the existing design system.
---
# React UI IR Renderer

## Responsibilities
- Parse and validate server-delivered IR against the supported contract.
- Render only allowlisted component types from a typed registry.
- Map semantic component types to existing Banyumanik 2 design-system components and tokens.
- Handle loading, empty, stale, error, unsupported-version and permission-denied states.
- Manage form state and client-side validation as usability assistance.
- Dispatch registered action IDs through approved API clients.
- Preserve accessibility, responsive behavior and workflow-instance state.

## Hard rules
- Never evaluate Python, JavaScript, HTML, CSS or SQL from IR.
- Never dynamically import arbitrary component paths.
- Never trust client-side visibility or permission flags.
- Never access PostgreSQL from the browser.
- Never infer assistant context from active workflow or global state.
- Do not rebuild existing screens solely to make them DSL-driven.
- Unknown components must fail safely with diagnostics; do not silently render arbitrary content.

## Engineering
Use discriminated TypeScript unions, component-specific prop schemas, exhaustive switch/registry checks, stable keys, bounded trees, error boundaries, contract tests and accessibility tests.
