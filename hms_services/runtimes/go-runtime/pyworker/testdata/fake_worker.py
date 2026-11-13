"""A misbehaving pyworker/1 worker for the Go tests. Behaviour is chosen per capability name (and FAKE_HELLO)."""

import json
import os
import sys
import time

out = sys.stdout.buffer
CAPS = ["runtime.ping", "test.sleep", "test.garbage", "test.wrong_id", "test.huge", "test.crash",
        "test.extra", "test.env", "test.stall_read"]


def send(obj):
    out.write(json.dumps(obj).encode() + b"\n")
    out.flush()


mode = os.environ.get("FAKE_HELLO", "ok")
if mode == "silent":
    time.sleep(60)
send({"v": 2 if mode == "bad_version" else 1, "ready": True, "worker": "fake", "version": "0",
      "capabilities": CAPS, "limits": {"memory": "none"}})

for line in sys.stdin.buffer:
    req = json.loads(line)
    cap, rid = req["capability"], req["id"]
    if cap == "runtime.ping":
        send({"v": 1, "id": rid, "ok": True, "output": {"echo": req["input"].get("echo", "")}})
    elif cap == "test.sleep":
        time.sleep(60)
    elif cap == "test.garbage":
        out.write(b"not json\n")
        out.flush()
    elif cap == "test.wrong_id":
        send({"v": 1, "id": rid + "0", "ok": True, "output": {}})
    elif cap == "test.huge":
        out.write(b'{"pad":"' + b"a" * (2 << 20) + b'"}\n')
        out.flush()
    elif cap == "test.crash":
        sys.exit(3)
    elif cap == "test.extra":
        send({"v": 1, "id": rid, "ok": True, "output": {"echo": "x", "extra": 1}})
    elif cap == "test.env":
        send({"v": 1, "id": rid, "ok": True,
              "output": {"seen": "HMS_PYWORKER_SENTINEL" in os.environ, "passed": os.environ.get("PASSED", "")}})
    elif cap == "test.stall_read":
        time.sleep(60)
