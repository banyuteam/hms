"""A misbehaving worker for the embedded-engine Go tests. Behaviour is chosen per capability name (and FAKE_HELLO)."""

import json
import os
import sys

CAPS = ["runtime.ping", "test.loop", "test.garbage", "test.wrong_id", "test.huge", "test.raise", "test.exit",
        "test.extra", "test.env", "test.print", "test.hog", "test.escape"]

mode = os.environ.get("FAKE_HELLO", "ok")


def ok(rid, output):
    return json.dumps({"v": 1, "id": rid, "ok": True, "output": output})


def hello_line(memory):
    if mode == "bad_version":
        return json.dumps({"v": 2, "ready": True, "worker": "fake", "version": "0", "capabilities": CAPS,
                           "limits": {"memory": memory}})
    if mode == "not_str":
        return 1
    return json.dumps({"v": 1, "ready": True, "worker": "fake", "version": "0", "capabilities": CAPS,
                       "limits": {"memory": memory}})


def escape():
    """Each way out of the interpreter must fail."""
    seen = {}
    try:
        with open(os.environ["HOST_FILE"], "rb") as f:
            f.read(1)
        seen["file"] = True
    except OSError:
        seen["file"] = False
    try:
        import socket
        socket.create_connection(("127.0.0.1", int(os.environ["HOST_PORT"])), timeout=2).close()
        seen["network"] = True
    except Exception:
        seen["network"] = False
    try:
        import subprocess
        subprocess.run(["python", "-c", "pass"], check=False)
        seen["subprocess"] = True
    except Exception:
        seen["subprocess"] = False
    return seen


def call_line(line, max_line):
    req = json.loads(line)
    cap, rid = req["capability"], req["id"]
    if cap == "runtime.ping":
        return ok(rid, {"echo": req["input"].get("echo", "")})
    if cap == "test.loop":
        while True:
            pass
    if cap == "test.garbage":
        return "not json"
    if cap == "test.wrong_id":
        return ok(rid + "0", {})
    if cap == "test.huge":
        return '{"pad":"' + "a" * (2 << 20) + '"}'
    if cap == "test.raise":
        raise ValueError("patient MRN-0001 failed")
    if cap == "test.exit":
        sys.exit(3)
    if cap == "test.extra":
        return ok(rid, {"echo": "x", "extra": 1})
    if cap == "test.env":
        return ok(rid, {"seen": "HMS_PYWORKER_SENTINEL" in os.environ, "passed": os.environ.get("PASSED", "")})
    if cap == "test.print":
        print("patient MRN-0001")
        print("patient MRN-0001", file=sys.stderr)
        return ok(rid, {"echo": ""})
    if cap == "test.hog":
        try:
            blob = bytearray(256 << 20)
            return ok(rid, {"memory_error": False, "size": len(blob)})
        except MemoryError:
            return ok(rid, {"memory_error": True, "size": 0})
    if cap == "test.escape":
        return ok(rid, escape())
    return ok(rid, {})
