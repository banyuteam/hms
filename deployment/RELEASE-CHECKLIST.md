# HMS Release and Production Readiness Checklist

## Source and build
- [ ] Correct release commit and clean working tree.
- [ ] Reproducible Docker builds for all deployable services.
- [ ] Multi-stage builds and minimal runtime images.
- [ ] Non-root runtime and least-privilege container settings.
- [ ] Image tags immutable; release metadata recorded.
- [ ] SBOM generated and image/dependency scan reviewed.

## Configuration and security
- [ ] No secrets in source, image layers, build args or browser bundles.
- [ ] Production secrets supplied by approved secret manager.
- [ ] TLS ingress and certificate renewal configured.
- [ ] Only required ports exposed.
- [ ] Private service/database networks configured.
- [ ] Container resource limits and restart policies reviewed.
- [ ] Security headers and browser policy reviewed.
- [ ] PHI logging and telemetry redaction reviewed.

## Database
- [ ] Migration reviewed and tested against representative data.
- [ ] One-shot migration procedure defined.
- [ ] Backup completed and restore procedure tested.
- [ ] Retention and recovery objectives documented.
- [ ] Legacy MySQL credentials verified SELECT-only.
- [ ] No legacy schema/application connection changes.

## Application quality
- [ ] Unit, integration, contract and security tests run.
- [ ] Health and readiness probes verified.
- [ ] Graceful shutdown and restart behavior tested.
- [ ] API compatibility with web/mobile clients verified.
- [ ] Assistant context authorization and tenant isolation tested.
- [ ] Signature and public verification disclosure reviewed.
- [ ] Critical workflows smoke-tested.

## Operations
- [ ] Monitoring, logs, traces and alerts configured.
- [ ] Capacity and resource sizing reviewed.
- [ ] Deployment and rollback/forward-fix runbooks available.
- [ ] On-call/ownership and incident escalation defined.
- [ ] Release notes and image digests recorded.

## Native release
- [ ] Android signing and release pipeline verified where applicable.
- [ ] iOS signing/provisioning and Apple-compatible build environment verified where applicable.
- [ ] Mobile capability registry matches shipped features.
