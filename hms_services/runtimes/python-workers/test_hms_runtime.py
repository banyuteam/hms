"""Unit tests for the adapter package hms_runtime: python -m unittest test_hms_runtime (from this directory)."""

import json
import unittest

from hms_runtime import CapabilityError, capabilities, capability, registry, schema
from hms_runtime.schema import SchemaError


class SchemaTest(unittest.TestCase):
    def test_object_fills_defaults_and_refuses_unknown_keys_without_naming_them(self):
        s = schema.Object({"a": schema.Int(), "b": schema.Str(default="x")})
        self.assertEqual(s.check({"a": 1}), {"a": 1, "b": "x"})
        with self.assertRaises(SchemaError) as cm:
            s.check({"a": 1, "MRN-0001": 2})
        self.assertNotIn("MRN", str(cm.exception))
        with self.assertRaises(SchemaError) as cm:
            s.check({})
        self.assertEqual(cm.exception.path, "value.a")

    def test_defaults_are_copied(self):
        s = schema.Object({"tags": schema.List(schema.Str(), default=[])})
        first = s.check({})
        first["tags"].append("changed")
        self.assertEqual(s.check({}), {"tags": []})

    def test_types_and_bounds(self):
        bad = [
            (schema.Int(), True), (schema.Int(), 1.5), (schema.Int(min=0), -1), (schema.Int(max=9), 10),
            (schema.Float(), "1"), (schema.Float(), float("nan")), (schema.Float(), True),
            (schema.Str(), 1), (schema.Str(max_len=2), "abc"), (schema.Str(min_len=1), ""),
            (schema.Str(choices=["a"]), "b"), (schema.Bool(), 0), (schema.List(schema.Int()), (1,)),
            (schema.List(schema.Int(), max_items=1), [1, 2]), (schema.List(schema.Int()), [1, "x"]),
            (schema.Int(), None),
        ]
        for field, value in bad:
            with self.assertRaises(SchemaError, msg=(type(field).__name__, value)):
                field.check(value)
        self.assertEqual(schema.Float().check(2), 2.0)
        self.assertIsNone(schema.Int(nullable=True).check(None))

    def test_error_names_the_path_not_the_value(self):
        s = schema.Object({"items": schema.List(schema.Object({"code": schema.Str(max_len=3)}))})
        with self.assertRaises(SchemaError) as cm:
            s.check({"items": [{"code": "ok"}, {"code": "PATIENT-SECRET"}]}, "input")
        self.assertEqual(str(cm.exception), "input.items[1].code: must have at most 3 characters")


class RegistryTest(unittest.TestCase):
    def tearDown(self):
        for name in [n for n in registry._REGISTRY if n.startswith("test.")]:
            del registry._REGISTRY[name]

    def test_register_and_invoke(self):
        @capability("test.double", version="1.2", input={"n": schema.Int(max=100)}, output={"n": schema.Int()})
        def double(inp):
            return {"n": inp["n"] * 2}
        cap = capabilities()["test.double"]
        self.assertEqual((cap.version, cap.invoke({"n": 21})), ("1.2", {"n": 42}))
        with self.assertRaises(CapabilityError) as cm:
            cap.invoke({"n": 101})
        self.assertEqual((cm.exception.code, cm.exception.message), ("invalid_input", "input.n: must be at most 100"))

    def test_registration_is_checked(self):
        for name in ("Ping", "ping", "a..b", "", None):
            with self.assertRaises(ValueError, msg=name):
                capability(name, input={}, output={})
        with self.assertRaises(ValueError):
            capability("test.v", version="v1", input={}, output={})
        with self.assertRaises(TypeError):
            capability("test.schema", input=[], output={})

        @capability("test.once", input={}, output={})
        def once(_):
            return {}
        with self.assertRaises(ValueError):
            capability("test.once", input={}, output={})(once)

    def test_capability_error_code_format(self):
        with self.assertRaises(ValueError):
            CapabilityError("Bad Code", "x")
        self.assertEqual(CapabilityError("not_found", "x").code, "not_found")

    def test_capabilities_is_a_copy(self):
        capabilities()["test.injected"] = None
        self.assertNotIn("test.injected", capabilities())


class ProtocolTest(unittest.TestCase):
    def test_refusal_from_capability_reaches_the_caller(self):
        from hms_runtime import protocol

        @capability("test.refuse", input={}, output={})
        def refuse(_):
            raise CapabilityError("not_eligible", "patient is not eligible")
        try:
            resp = protocol.handle({"v": 1, "id": "3", "capability": "test.refuse", "input": {}})
        finally:
            del registry._REGISTRY["test.refuse"]
        self.assertEqual(resp["error"], {"code": "not_eligible", "message": "patient is not eligible"})
        self.assertEqual(json.loads(protocol.hello_line("none"))["worker"], "hms-worker")


if __name__ == "__main__":
    unittest.main()
