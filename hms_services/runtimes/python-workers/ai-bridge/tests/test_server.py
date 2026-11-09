"""Tests of the AI bridge skeleton: configuration, authentication, limits, readiness, logging (standard library only).

Run from runtimes/python-workers/ai-bridge:  python -m unittest discover -s tests -v
"""

from __future__ import annotations

import http.client
import io
import json
import logging
import os
import tempfile
import threading
import time
import unittest

from ai_bridge import config
from ai_bridge.server import MAX_BODY, build_server, log

SECRET = "s" * 40


class ConfigTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def secret_file(self, value: str) -> str:
        path = os.path.join(self.dir.name, "secret")
        with open(path, "w", encoding="utf-8") as f:
            f.write(value + "\n")
        return path

    def test_secrets_only_from_files(self) -> None:
        with self.assertRaisesRegex(config.ConfigError, "BRIDGE_SECRET_FILE is required"):
            config.load({"BRIDGE_SECRET": SECRET})
        with self.assertRaisesRegex(config.ConfigError, "at least 32"):
            config.load({"BRIDGE_SECRET_FILE": self.secret_file("short")})
        cfg = config.load({"BRIDGE_SECRET_FILE": self.secret_file(SECRET)})
        self.assertEqual(cfg.bridge_secret, SECRET)
        self.assertFalse(cfg.provider_key_configured)
        self.assertEqual((cfg.port, cfg.slots, cfg.deadline_seconds), (8090, 4, 120))

    def test_errors_never_contain_secret_values(self) -> None:
        with self.assertRaises(config.ConfigError) as ctx:
            config.load({"BRIDGE_SECRET_FILE": self.secret_file("tiny-secret-value")})
        self.assertNotIn("tiny-secret-value", str(ctx.exception))

    def test_bounds(self) -> None:
        env = {"BRIDGE_SECRET_FILE": self.secret_file(SECRET), "BRIDGE_SLOTS": "0"}
        with self.assertRaisesRegex(config.ConfigError, "BRIDGE_SLOTS"):
            config.load(env)


class ServerTest(unittest.TestCase):
    def start(self, provider_key: bool = False, slots: int = 2) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        secret = os.path.join(tmp.name, "secret")
        with open(secret, "w", encoding="utf-8") as f:
            f.write(SECRET)
        env = {"BRIDGE_ADDR": "127.0.0.1:0", "BRIDGE_SECRET_FILE": secret, "DOCUMENTS_DIR": tmp.name,
               "BRIDGE_SLOTS": str(slots)}
        if provider_key:
            key = os.path.join(tmp.name, "key")
            with open(key, "w", encoding="utf-8") as f:
                f.write("synthetic-test-key")
            env["ANTHROPIC_API_KEY_FILE"] = key
        cfg = config.load(env)
        self.server = build_server(cfg)
        self.port = self.server.server_address[1]
        t = threading.Thread(target=self.server.serve_forever, daemon=True)
        t.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        self.addCleanup(conn.close)
        conn.request(method, path, body=body, headers=headers or {})
        res = conn.getresponse()
        return res.status, json.loads(res.read() or b"{}")

    def read(self, body: bytes = b'{"request_id":"x"}', **headers: str):
        h = {"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"}
        h.update(headers)
        return self.request("POST", "/v1/read", body, h)

    def test_health_and_readiness(self) -> None:
        self.start()
        self.assertEqual(self.request("GET", "/healthz"), (200, {"status": "ok", "version": "0.1.0"}))
        status, body = self.request("GET", "/readyz")
        self.assertEqual(status, 503)
        self.assertEqual(body["checks"], {"provider_key": "missing", "documents": "ok"})

    def test_ready_with_a_provider_key(self) -> None:
        self.start(provider_key=True)
        self.assertEqual(self.request("GET", "/readyz")[0], 200)

    def test_only_the_caller_with_the_secret_is_served(self) -> None:
        self.start(provider_key=True)
        for auth in ["", "Bearer wrong", f"Basic {SECRET}", f"Bearer {SECRET}x"]:
            status, body = self.read(Authorization=auth)
            self.assertEqual((status, body["error"]["code"]), (401, "unauthorized"), auth)

    def test_limits_and_shape(self) -> None:
        self.start(provider_key=True)
        self.assertEqual(self.read(b"x" * (MAX_BODY + 1))[0], 413)
        self.assertEqual(self.read(b"not json")[1]["error"]["code"], "invalid_request")
        self.assertEqual(self.read(**{"Content-Type": "text/plain"})[0], 400)
        self.assertEqual(self.request("GET", "/v1/read")[0], 404)

    def test_skeleton_reads_nothing_yet(self) -> None:
        self.start()
        self.assertEqual(self.read(), (503, {"error": {"code": "not_configured"}}))
        self.server.shutdown()
        self.start(provider_key=True)
        self.assertEqual(self.read(), (503, {"error": {"code": "not_implemented"}}))

    def test_busy_when_all_slots_are_taken(self) -> None:
        self.start(provider_key=True, slots=1)
        # Take the only slot as an in-flight request would; the next request is turned away at once, not queued.
        self.assertTrue(self.server.bridge.slots.acquire(blocking=False))
        self.assertEqual(self.read(), (429, {"error": {"code": "busy"}}))
        self.server.bridge.slots.release()
        self.assertEqual(self.read()[0], 503)

    def test_logs_carry_no_content(self) -> None:
        self.start(provider_key=True)
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        self.addCleanup(log.removeHandler, handler)
        self.read(b'{"question":"Pasien Budi Santoso, NIK 3374012345678901?"}')
        # The access log is written after the response is sent: wait for it.
        for _ in range(100):
            if "/v1/read" in stream.getvalue():
                break
            time.sleep(0.01)
        out = stream.getvalue()
        self.assertIn('"path": "/v1/read"', out)
        for leak in ["Budi", "3374012345678901", SECRET, "question"]:
            self.assertNotIn(leak, out)


if __name__ == "__main__":
    unittest.main()
