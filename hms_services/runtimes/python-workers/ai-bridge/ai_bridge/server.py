"""HTTP server of the AI bridge (contract hms_services/contracts/internal/ai-bridge-v1.openapi.yaml).

Skeleton (ADR-SVC-009 step 2): health and readiness, caller authentication, request limits and busy slots are in place;
POST /v1/read answers 503 not_implemented until the model call is added (step 4). Standard library only.

Logging rule: method, path, status and duration only. Never a request or response body, header values, document
content, the question, visit facts or an answer.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__
from .config import Config, ConfigError, load

MAX_BODY = 64 * 1024

log = logging.getLogger("ai_bridge")


class Bridge:
    """State shared by the request handlers."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.slots = threading.BoundedSemaphore(cfg.slots)

    def readiness(self) -> dict[str, str]:
        checks = {
            "provider_key": "ok" if self.cfg.provider_key_configured else "missing",
            "documents": "ok" if os.access(self.cfg.documents_dir, os.R_OK | os.X_OK) else "unreadable",
        }
        return checks


def make_handler(bridge: Bridge) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "hms-ai-bridge"
        sys_version = ""
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: object) -> None:  # replaced by structured access logs
            pass

        def _send(self, status: int, body: dict) -> None:
            data = json.dumps(body, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            self._status = status

        def _error(self, status: int, code: str) -> None:
            # The body may be unread (401, 413, 429): close so it cannot be taken for the next request.
            self.close_connection = True
            self._send(status, {"error": {"code": code}})

        def _access_log(self, started: float) -> None:
            log.info(
                json.dumps(
                    {
                        "msg": "request",
                        "method": self.command,
                        "path": self.path.split("?", 1)[0],
                        "status": getattr(self, "_status", 0),
                        "duration_ms": int((time.monotonic() - started) * 1000),
                    }
                )
            )

        def do_GET(self) -> None:  # noqa: N802 (http.server naming)
            started = time.monotonic()
            try:
                if self.path == "/healthz":
                    self._send(200, {"status": "ok", "version": __version__})
                elif self.path == "/readyz":
                    checks = bridge.readiness()
                    ready = all(v == "ok" for v in checks.values())
                    self._send(200 if ready else 503, {"status": "ready" if ready else "not_ready", "checks": checks})
                else:
                    self._error(404, "not_found")
            finally:
                self._access_log(started)

        def do_POST(self) -> None:  # noqa: N802
            started = time.monotonic()
            try:
                if self.path != "/v1/read":
                    self._error(404, "not_found")
                    return
                if not self._authorized():
                    self._error(401, "unauthorized")
                    return
                if not self.headers.get("Content-Type", "").startswith("application/json"):
                    self._error(400, "invalid_request")
                    return
                length = self.headers.get("Content-Length")
                if length is None or not length.isdigit():
                    self._error(400, "invalid_request")
                    return
                if int(length) > MAX_BODY:
                    self._error(413, "too_large")
                    return
                if not bridge.slots.acquire(blocking=False):
                    self._error(429, "busy")
                    return
                try:
                    body = self.rfile.read(int(length))
                    try:
                        json.loads(body)
                    except ValueError:
                        self._error(400, "invalid_request")
                        return
                    if not bridge.cfg.provider_key_configured:
                        self._error(503, "not_configured")
                        return
                    # Step 4 adds validation against ai-bridge-v1, document reads and the model call here.
                    self._error(503, "not_implemented")
                finally:
                    bridge.slots.release()
            finally:
                self._access_log(started)

        def _authorized(self) -> bool:
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return False
            return hmac.compare_digest(auth[len("Bearer ") :].encode(), bridge.cfg.bridge_secret.encode())

    return Handler


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, cfg: Config):
        self.bridge = Bridge(cfg)
        super().__init__((cfg.host, cfg.port), make_handler(self.bridge))


def build_server(cfg: Config) -> BridgeServer:
    return BridgeServer(cfg)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    try:
        cfg = load()
    except ConfigError as e:
        log.error(json.dumps({"msg": "invalid configuration", "error": str(e)}))
        return 2
    server = build_server(cfg)

    def stop(signum: int, _frame: object) -> None:
        log.info(json.dumps({"msg": "shutting down", "signal": signum}))
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log.info(json.dumps({"msg": "hms-ai-bridge listening", "port": cfg.port, "version": __version__,
                         "provider_key": cfg.provider_key_configured}))
    server.serve_forever()
    server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
