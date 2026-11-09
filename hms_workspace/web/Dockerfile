# hms-web container image (root CLAUDE.md §13): the built SPA served by unprivileged nginx, which also forwards
# /api to hms-services so the browser stays same-origin (no CORS, the session cookie never crosses origins).
# Build context: hms_workspace/web/.
#
#   docker build -t local/hms-web:dev hms_workspace/web                       # live data (default)
#   docker build --build-arg VITE_DATA_SOURCE=synthetic -t local/hms-web:demo hms_workspace/web
#
# VITE_* values are compiled into the public bundle: never pass secrets as build arguments.
# Production: pin both base images by digest in the release pipeline and scan the image before publishing.

ARG NODE_IMAGE=node:24.13.0-alpine
ARG RUNTIME_IMAGE=nginxinc/nginx-unprivileged:1.28.0-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# Build-time data source: "bff" = real sign-in and data through hms-services; anything else = synthetic demo data.
ARG VITE_DATA_SOURCE=bff
ARG VITE_DEMO_AUTH=false
ARG VITE_IDLE_MINUTES=15
ENV VITE_DATA_SOURCE=${VITE_DATA_SOURCE} VITE_DEMO_AUTH=${VITE_DEMO_AUTH} VITE_IDLE_MINUTES=${VITE_IDLE_MINUTES}
RUN npm run build

FROM ${RUNTIME_IMAGE} AS runtime
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="hms-web" \
      org.opencontainers.image.description="HMS web workspace (static SPA + same-origin /api proxy)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
# The base image runs as uid 101 (nginx) and listens on 8080; pid and temp files live in /tmp.
USER 101
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
