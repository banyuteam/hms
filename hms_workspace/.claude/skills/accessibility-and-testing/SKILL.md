# Accessibility and Testing

## Use when
Building or reviewing components, workflows, shell navigation or platform features.

## Accessibility
- Semantic controls and labels.
- Keyboard navigation and visible focus.
- Screen-reader announcements for workflow changes and async status.
- Contrast and non-color status cues.
- Responsive behavior and scalable text.
- Touch target sizing on mobile.

## Testing
- Unit tests for state transitions and components.
- Integration tests for workflow and API behavior.
- Contract tests against versioned APIs.
- E2E tests for critical clinical/financial workflows.
- Security tests for unauthorized resource references and tenant boundaries.
- Regression tests for existing module screens during shell migration.
- Native lifecycle, offline and secure-storage tests on mobile.

Never report tests as passing unless they were executed.
