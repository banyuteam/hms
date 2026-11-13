"""Declarative schemas for capability input and output (JSON values). Standard library only.

A schema is a Field. Object refuses unknown keys and fills declared defaults; every check returns a clean copy of the
value. An error names the field's path in the schema and the rule it broke, never the value (it may be patient data).
"""

import copy
import math

_MISSING = object()


class SchemaError(Exception):
    def __init__(self, path, rule):
        super().__init__(f"{path}: {rule}")
        self.path = path
        self.rule = rule


class Field:
    def __init__(self, *, required=True, default=_MISSING, nullable=False):
        self.required = required and default is _MISSING
        self.default = default
        self.nullable = nullable

    def check(self, value, path="value"):
        if value is None:
            if self.nullable:
                return None
            raise SchemaError(path, "must not be null")
        return self._check(value, path)

    def _check(self, value, path):
        raise NotImplementedError


class Str(Field):
    def __init__(self, *, min_len=0, max_len=None, choices=None, **kw):
        super().__init__(**kw)
        self.min_len, self.max_len = min_len, max_len
        self.choices = frozenset(choices) if choices is not None else None

    def _check(self, value, path):
        if not isinstance(value, str):
            raise SchemaError(path, "must be a string")
        if len(value) < self.min_len:
            raise SchemaError(path, f"must have at least {self.min_len} characters")
        if self.max_len is not None and len(value) > self.max_len:
            raise SchemaError(path, f"must have at most {self.max_len} characters")
        if self.choices is not None and value not in self.choices:
            raise SchemaError(path, "is not an allowed value")
        return value


class _Number(Field):
    def __init__(self, *, min=None, max=None, **kw):
        super().__init__(**kw)
        self.min, self.max = min, max

    def _bounds(self, value, path):
        if self.min is not None and value < self.min:
            raise SchemaError(path, f"must be at least {self.min}")
        if self.max is not None and value > self.max:
            raise SchemaError(path, f"must be at most {self.max}")
        return value


class Int(_Number):
    def _check(self, value, path):
        if isinstance(value, bool) or not isinstance(value, int):
            raise SchemaError(path, "must be an integer")
        return self._bounds(value, path)


class Float(_Number):
    """A finite number; JSON integers are accepted and returned as float."""

    def _check(self, value, path):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise SchemaError(path, "must be a number")
        value = float(value)
        if not math.isfinite(value):
            raise SchemaError(path, "must be finite")
        return self._bounds(value, path)


class Bool(Field):
    def _check(self, value, path):
        if not isinstance(value, bool):
            raise SchemaError(path, "must be true or false")
        return value


class List(Field):
    def __init__(self, item, *, min_items=0, max_items=None, **kw):
        super().__init__(**kw)
        self.item, self.min_items, self.max_items = item, min_items, max_items

    def _check(self, value, path):
        if not isinstance(value, list):
            raise SchemaError(path, "must be a list")
        if len(value) < self.min_items:
            raise SchemaError(path, f"must have at least {self.min_items} items")
        if self.max_items is not None and len(value) > self.max_items:
            raise SchemaError(path, f"must have at most {self.max_items} items")
        return [self.item.check(v, f"{path}[{i}]") for i, v in enumerate(value)]


class Object(Field):
    def __init__(self, fields, **kw):
        super().__init__(**kw)
        for name, f in fields.items():
            if not isinstance(name, str) or not isinstance(f, Field):
                raise TypeError("Object fields map names to Field instances")
        self.fields = dict(fields)

    def _check(self, value, path):
        if not isinstance(value, dict):
            raise SchemaError(path, "must be an object")
        unknown = sorted(k for k in value if k not in self.fields)
        if unknown:
            # The key names come from the input, so only their count is reported.
            raise SchemaError(path, f"has {len(unknown)} unknown field(s)")
        out = {}
        for name, f in self.fields.items():
            if name in value:
                out[name] = f.check(value[name], f"{path}.{name}")
            elif f.default is not _MISSING:
                out[name] = copy.deepcopy(f.default)
            elif f.required:
                raise SchemaError(f"{path}.{name}", "is required")
        return out


def as_object(spec):
    """A capability's input or output schema: an Object, or a dict of fields to wrap in one."""
    if isinstance(spec, Object):
        return spec
    if isinstance(spec, dict):
        return Object(spec)
    raise TypeError("a capability schema is an Object or a dict of fields")
