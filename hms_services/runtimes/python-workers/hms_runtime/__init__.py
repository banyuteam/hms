"""HMS worker adapter (ADR-SVC-011). Capability code written against this package runs unchanged in both engines that
hms_services supervises: an external CPython child process, or CPython embedded in hms-services through go-python.

    from hms_runtime import capability, schema

    @capability("clinical_rules.bmi", version="1",
                input={"weight_kg": schema.Float(min=1, max=500), "height_m": schema.Float(min=0.3, max=3)},
                output={"bmi": schema.Float()})
    def bmi(inp):
        return {"bmi": round(inp["weight_kg"] / inp["height_m"] ** 2, 1)}

The adapter checks the input against the schema before the function runs and the output after it returns, turns
failures into protocol errors that never quote the input, and speaks protocol pyworker/1 for either engine. Go still
allowlists, bounds and validates every call; these checks catch mistakes early and keep error messages data-free.

Standard library only. It must also run on the embedded build (CPython 3.14 on WASI), whose standard library is
trimmed: zoneinfo, sqlite3, ssl, ctypes, zlib, lzma and bz2 are missing, and there is no network or host filesystem.
"""

from . import schema
from .errors import CapabilityError
from .registry import capabilities, capability

__all__ = ["CapabilityError", "capabilities", "capability", "schema"]
