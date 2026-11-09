# hms-ai-bridge image (ADR-SVC-009, contract ai-bridge-v1). Build context: hms_services/runtimes/python-workers/ai-bridge/.
#
#   docker build -t local/hms-ai-bridge:dev hms_services/runtimes/python-workers/ai-bridge
#
# Non-root (uid 65532, the same user as hms-services so it can read the documents hms-services writes), no secrets in
# the image: the bridge secret and the provider key are mounted files at run time. Standard library only in the
# skeleton; the provider SDK is added with the model call (step 4) as a pinned, hashed requirement.
# Production: pin the base image by digest in the release pipeline and scan the image before publishing.

ARG PYTHON_IMAGE=python:3.13.11-slim

FROM ${PYTHON_IMAGE}
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="hms-ai-bridge" \
      org.opencontainers.image.description="HMS bridge to the external AI model (internal only)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BRIDGE_ADDR=0.0.0.0:8090 DOCUMENTS_DIR=/data/assistant-documents
WORKDIR /app
COPY ai_bridge ./ai_bridge
# The document volume is mounted read-only here; the directory exists so a fresh named volume gets the right owner.
RUN mkdir -p /data/assistant-documents && chown 65532:65532 /data/assistant-documents
USER 65532:65532
EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/healthz', timeout=2).status == 200 else 1)"]
ENTRYPOINT ["python", "-m", "ai_bridge"]
