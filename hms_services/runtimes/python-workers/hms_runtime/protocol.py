"""Protocol pyworker/1, one JSON object per line (UTF-8):

  worker -> {"v":1,"ready":true,"worker":"hms-worker","version":"1","capabilities":[...],"limits":{"memory":"..."}}
  go     -> {"v":1,"id":"7","capability":"runtime.ping","input":{...}}
  worker -> {"v":1,"id":"7","ok":true,"output":{...}}
          | {"v":1,"id":"7","ok":false,"error":{"code":"invalid_input","message":"..."}}

The process engine carries the lines on stdin/stdout (process.serve); the embedded engine calls hello_line once and
call_line per request. Errors never echo the input and tracebacks are not written anywhere.
"""

import json

from .errors import CapabilityError
from .registry import OutputMismatch, capabilities, lookup

PROTOCOL = 1
WORKER = "hms-worker"
VERSION = "1"


def failure(rid, code, message):
    return {"v": PROTOCOL, "id": rid, "ok": False, "error": {"code": code, "message": message}}


def handle(req):
    """Answers one decoded request. Never raises."""
    rid = req.get("id") if isinstance(req, dict) else None
    if not isinstance(rid, str):
        rid = ""
    if not isinstance(req, dict) or req.get("v") != PROTOCOL or set(req) != {"v", "id", "capability", "input"}:
        return failure(rid, "bad_request", "malformed request")
    cap = lookup(req["capability"])
    if cap is None:
        return failure(rid, "unknown_capability", "capability not provided by this worker")
    try:
        output = cap.invoke(req["input"])
    except CapabilityError as e:
        return failure(rid, e.code, e.message)
    except OutputMismatch:
        return failure(rid, "invalid_output", "output does not match the capability schema")
    except Exception:  # noqa: BLE001 - nothing about the failure may leave the worker but its fact
        return failure(rid, "internal", "capability failed")
    return {"v": PROTOCOL, "id": rid, "ok": True, "output": output}


def encode(resp, max_line):
    """One protocol line (bytes, newline included), within max_line bytes."""
    rid = resp["id"]
    try:
        line = json.dumps(resp, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError):
        line = json.dumps(failure(rid, "internal", "output is not JSON")).encode("utf-8")
    if len(line) + 1 > max_line:
        line = json.dumps(failure(rid, "output_too_large", "output exceeds the line limit")).encode("utf-8")
    return line + b"\n"


def hello(memory):
    return {
        "v": PROTOCOL,
        "ready": True,
        "worker": WORKER,
        "version": VERSION,
        "capabilities": sorted(capabilities()),
        "limits": {"memory": memory},
    }


def hello_line(memory):
    """Embedded engine: the handshake line (str, no newline). memory is the status of the limit Go applied."""
    return json.dumps(hello(memory), separators=(",", ":"))


def call_line(line, max_line):
    """Embedded engine: answers one request line (str) with one response line (str, no newline). Never raises."""
    try:
        req = json.loads(line)
    except ValueError:
        req = None
    return encode(handle(req), max_line)[:-1].decode("utf-8")
