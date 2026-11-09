# hms-services container image (root CLAUDE.md §13). Build context: hms_services/.
#
#   docker build -t local/hms-services:dev hms_services
#
# Multi-stage: a static, CGO-free binary on distroless "nonroot" (no shell, no package manager, uid 65532).
# No configuration or secrets are baked in: everything comes from the environment or *_FILE secret mounts at run time.
# Production: pin both base images by digest in the release pipeline and scan the image before publishing.

ARG GO_IMAGE=golang:1.27.3
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot

FROM ${GO_IMAGE} AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOOS=linux GOFLAGS=-mod=readonly
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download && go mod verify
COPY . .
# -buildvcs=false: .git is not in the build context; the revision is recorded as an image label instead.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/hms-services ./cmd/hms-services

FROM ${RUNTIME_IMAGE} AS runtime
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="hms-services" \
      org.opencontainers.image.description="HMS backend runtime (Go modular monolith)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
COPY --from=build /out/hms-services /app/hms-services
USER nonroot:nonroot
ENV HTTP_ADDR=:8080
EXPOSE 8080
# Liveness only (GET /healthz on this process). Readiness (/readyz: PostgreSQL and legacy HMS) is for the orchestrator.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD ["/app/hms-services", "healthcheck"]
ENTRYPOINT ["/app/hms-services"]
CMD ["serve"]
