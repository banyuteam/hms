"""HMS Python worker, started and supervised by hms_services (Go package runtimes/go-runtime/pyworker,
ADR-SVC-011). Python 3.10+, standard library only. Go runs it in one of two engines:

  process   python -I -B hms_worker.py: serve() speaks the protocol on stdin/stdout.
  embedded  go-python loads this directory's .py files, imports this file as the module hms_worker and calls
            hello_line() once, then call_line() per request.

Capabilities are written against the adapter package hms_runtime (decorator, schemas, errors; see its docstring) in
modules under capabilities/. This file lists the approved modules; a request can reach nothing else. Go allowlists
the names again, bounds every call and validates the output.
"""

import os
import sys

# python -I leaves the script's directory off sys.path; the adapter and the capability modules live there.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hms_runtime.process import serve  # noqa: E402
from hms_runtime.protocol import call_line, encode, handle, hello_line  # noqa: E402,F401 - engine entry points

# Approved capability modules. Adding one is a reviewed change (ADR-SVC-011 Rollout step 2,
# plugin-capability-governance).
import capabilities.runtime  # noqa: E402,F401

if __name__ == "__main__":
    sys.exit(serve(sys.argv[1:]))
