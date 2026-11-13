import re

from .errors import CapabilityError
from .schema import SchemaError, as_object

_NAME = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")  # dotted lower-case, as Go requires
_VERSION = re.compile(r"^[0-9]+(\.[0-9]+){0,2}$")

_REGISTRY = {}


class OutputMismatch(Exception):
    """The capability returned something its own output schema does not allow (a bug in the capability)."""


class Capability:
    __slots__ = ("name", "version", "fn", "input", "output")

    def __init__(self, name, version, fn, input_schema, output_schema):
        self.name, self.version, self.fn = name, version, fn
        self.input, self.output = input_schema, output_schema

    def invoke(self, raw):
        try:
            inp = self.input.check(raw, "input")
        except SchemaError as e:
            raise CapabilityError("invalid_input", str(e)) from None
        out = self.fn(inp)
        try:
            return self.output.check(out, "output")
        except SchemaError as e:
            raise OutputMismatch(str(e)) from None


def capability(name, *, input, output, version="1"):
    """Registers the decorated function as capability name. The function receives the checked input (a dict, with
    defaults filled) and returns a dict that must match output. Raise CapabilityError to refuse with a code the caller
    may see; any other exception becomes the code "internal" with no detail.

    Registration happens when the module is imported; hms_worker.py imports the approved modules explicitly."""
    if not isinstance(name, str) or not _NAME.match(name):
        raise ValueError("capability name must be dotted lower-case, e.g. clinical_rules.bmi")
    if not isinstance(version, str) or not _VERSION.match(version):
        raise ValueError("capability version must look like 1, 1.2 or 1.2.3")
    in_schema, out_schema = as_object(input), as_object(output)

    def register(fn):
        if name in _REGISTRY:
            raise ValueError(f"capability {name} is registered twice")
        _REGISTRY[name] = Capability(name, version, fn, in_schema, out_schema)
        return fn

    return register


def lookup(name):
    return _REGISTRY.get(name) if isinstance(name, str) else None


def capabilities():
    """The registered capabilities by name (a copy)."""
    return dict(_REGISTRY)
