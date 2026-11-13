# Python workers

Python code that hms_services runs for approved capabilities (ADR-SVC-011). Go supervises the worker in one of two
engines, and the same code runs in both:

| Engine | How it runs | Use it when |
|---|---|---|
| `embedded` | CPython 3.14 inside hms-services through go-python. In-memory filesystem, no network, no subprocesses, memory cap on any OS | The capability needs only the standard library (or, later, reviewed pure-Python packages) |
| `process` | `python -I -B hms_worker.py` as a child process | The capability needs something the embedded build lacks (compiled packages, `zoneinfo`, `sqlite3`, ...) |

## Layout

| Path | What it is |
|---|---|
| `hms_worker.py` | Entry point for both engines. Lists the approved capability modules |
| `hms_runtime/` | The adapter: `capability` decorator, `schema` fields, `CapabilityError`, the protocol for both engines |
| `capabilities/` | Capability modules, one per area (`runtime.py` holds `runtime.ping`) |
| `test_*.py` | Unit tests. They run on the host Python and inside the embedded interpreter |

## Writing a capability

```python
# capabilities/clinical_rules.py
from hms_runtime import CapabilityError, capability, schema


@capability(
    "clinical_rules.bmi",
    version="1",
    input={"weight_kg": schema.Float(min=1, max=500), "height_m": schema.Float(min=0.3, max=3.0)},
    output={"bmi": schema.Float(), "category": schema.Str(choices=["under", "normal", "over", "obese"])},
)
def bmi(inp):
    value = inp["weight_kg"] / inp["height_m"] ** 2
    if value > 200:
        raise CapabilityError("implausible", "the result is outside the plausible range")
    category = "under" if value < 18.5 else "normal" if value < 25 else "over" if value < 30 else "obese"
    return {"bmi": round(value, 1), "category": category}
```

Then import the module in `hms_worker.py` (`import capabilities.clinical_rules`) and allow the name on the Go side
(`pyworker.Capability{Name: "clinical_rules.bmi", ...}`). Both are reviewed changes: a real capability first needs
the approval described in ADR-SVC-011 Rollout step 2 (owner, threat model, Go caller with its authorization and audit).

What the adapter does for you:

- **Input check.** The input is checked against `input` before your function runs. Your function gets a clean dict
  with defaults filled in. Unknown fields, wrong types and out-of-range values become the refusal `invalid_input`.
- **Output check.** Your return value is checked against `output`. A mismatch becomes `invalid_output`.
- **Errors.** Raise `CapabilityError(code, message)` to refuse with a code the caller may see. Any other exception
  becomes `internal`, with no detail.
- **No data in errors.** Error messages name the field path (`input.items[1].code`), never the value. Write your own
  `CapabilityError` messages the same way: never put input values in them, because the input may hold patient data.

Schema fields: `Str(min_len, max_len, choices)`, `Int(min, max)`, `Float(min, max)` (finite), `Bool()`,
`List(item, min_items, max_items)`, `Object({...})`. Every field also takes `required`, `default` and `nullable`.

Rules:

- **Standard library only.** The embedded build has no `zoneinfo`, `sqlite3`, `ssl`, `ctypes`, `zlib`, `lzma` or
  `bz2`. Have Go pass times already converted to the facility time zone.
- **No I/O.** No files, no network, no subprocesses, no environment variables for secrets. Everything a capability
  needs comes in its input.
- **Stay deterministic and bounded.** Go enforces a timeout, input and output size limits, and memory.

## Testing

```powershell
# Host Python, from this directory
python -m unittest

# Inside the embedded interpreter, from hms_services
go test ./runtimes/go-runtime/pyworker -run 'TestEmbeddedPythonUnitTests$' -v

# Any other test file or folder in the embedded interpreter (absolute path)
go test ./runtimes/go-runtime/pyworker -run 'TestEmbeddedPythonUnitTests$' -v -args -py=D:/path/to/test_x.py
```

`TestEnginesAgree` checks that both engines give the same answer to the same requests.
