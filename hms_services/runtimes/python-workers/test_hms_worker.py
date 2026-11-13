"""Unit tests for hms_worker.py: python -m unittest test_hms_worker (from this directory)."""

import json
import unittest

import hms_worker
from hms_runtime import capability, registry, schema


def req(capability, inp, rid="1"):
    return {"v": 1, "id": rid, "capability": capability, "input": inp}


class HandleTest(unittest.TestCase):
    def test_ping_echoes(self):
        self.assertEqual(hms_worker.handle(req("runtime.ping", {"echo": "hi"})),
                         {"v": 1, "id": "1", "ok": True, "output": {"echo": "hi"}})

    def test_ping_refuses_bad_input_without_echoing_it(self):
        secret = "x" * 65
        resp = hms_worker.handle(req("runtime.ping", {"echo": secret}))
        self.assertFalse(resp["ok"])
        self.assertEqual(resp["error"]["code"], "invalid_input")
        self.assertNotIn(secret, json.dumps(resp))
        self.assertEqual(hms_worker.handle(req("runtime.ping", {"other": 1}))["error"]["code"], "invalid_input")

    def test_unlisted_capability_is_refused(self):
        for name in ("os.system", "__import__", "", None):
            resp = hms_worker.handle(req(name, {}))
            self.assertEqual(resp["error"]["code"], "unknown_capability", name)

    def test_malformed_requests(self):
        for r in (None, [], {"v": 2, "id": "1", "capability": "runtime.ping", "input": {}},
                  {"v": 1, "id": "1", "capability": "runtime.ping"},
                  {"v": 1, "id": "1", "capability": "runtime.ping", "input": {}, "extra": 1}):
            self.assertEqual(hms_worker.handle(r)["error"]["code"], "bad_request", r)

    def test_unexpected_exception_is_reported_without_detail(self):
        @capability("test.boom", input={}, output={})
        def boom(_):
            raise RuntimeError("patient 123")
        try:
            resp = hms_worker.handle(req("test.boom", {}))
        finally:
            del registry._REGISTRY["test.boom"]
        self.assertEqual(resp["error"], {"code": "internal", "message": "capability failed"})

    def test_output_outside_its_schema_is_refused(self):
        @capability("test.bad_output", input={}, output={"n": schema.Int()})
        def bad(_):
            return {"n": "patient 123"}
        try:
            resp = hms_worker.handle(req("test.bad_output", {}))
        finally:
            del registry._REGISTRY["test.bad_output"]
        self.assertEqual(resp["error"]["code"], "invalid_output")
        self.assertNotIn("patient", json.dumps(resp))

    def test_encode_bounds_the_line(self):
        resp = {"v": 1, "id": "1", "ok": True, "output": {"pad": "a" * 100}}
        self.assertEqual(json.loads(hms_worker.encode(resp, 64))["error"]["code"], "output_too_large")
        nan = {"v": 1, "id": "1", "ok": True, "output": {"n": float("nan")}}
        self.assertEqual(json.loads(hms_worker.encode(nan, 1024))["error"]["code"], "internal")


class EmbeddedEntryTest(unittest.TestCase):
    def test_hello_line_is_one_line(self):
        line = hms_worker.hello_line("applied")
        self.assertNotIn("\n", line)
        hello = json.loads(line)
        self.assertEqual((hello["v"], hello["ready"], hello["limits"]), (1, True, {"memory": "applied"}))
        self.assertEqual(hello["capabilities"], sorted(registry.capabilities()))

    def test_call_line_answers_one_line(self):
        line = hms_worker.call_line(json.dumps(req("runtime.ping", {"echo": "hi"}, "7")), 1024)
        self.assertNotIn("\n", line)
        self.assertEqual(json.loads(line), {"v": 1, "id": "7", "ok": True, "output": {"echo": "hi"}})

    def test_call_line_never_raises(self):
        for line in ("not json", "", "[]", '{"v":1}'):
            self.assertEqual(json.loads(hms_worker.call_line(line, 1024))["error"]["code"], "bad_request", line)
        big = json.dumps(req("runtime.ping", {"echo": "a" * 60}))
        self.assertEqual(json.loads(hms_worker.call_line(big, 64))["error"]["code"], "output_too_large")


if __name__ == "__main__":
    unittest.main()
