"""Process engine: python -I -B hms_worker.py serves the protocol on stdin/stdout, one request at a time, and exits
when stdin closes. print() goes to stderr, which hms_services discards; only the protocol is written to stdout."""

import argparse
import json
import sys

from .protocol import encode, handle, hello


def apply_memory_limit(mb):
    """Caps the address space (POSIX). Returns applied | unsupported | failed | none."""
    if mb <= 0:
        return "none"
    try:
        import resource
    except ImportError:  # Windows: rely on the container or job object instead
        return "unsupported"
    try:
        limit = mb * 1024 * 1024
        _, hard = resource.getrlimit(resource.RLIMIT_AS)
        if hard != resource.RLIM_INFINITY:
            limit = min(limit, hard)
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    except (ValueError, OSError):
        return "failed"
    return "applied"


def serve(argv):
    p = argparse.ArgumentParser(prog="hms_worker")
    p.add_argument("--max-line-bytes", type=int, default=1 << 20)
    p.add_argument("--max-memory-mb", type=int, default=0)
    args = p.parse_args(argv)

    out = sys.stdout.buffer
    sys.stdout = sys.stderr  # stray print() must not corrupt the protocol
    memory = apply_memory_limit(args.max_memory_mb)
    out.write(json.dumps(hello(memory), separators=(",", ":")).encode("utf-8") + b"\n")
    out.flush()

    stdin = sys.stdin.buffer
    while True:
        line = stdin.readline(args.max_line_bytes + 1)
        if not line:
            return 0
        if len(line) > args.max_line_bytes:
            return 2  # framing is lost; Go never sends this, so stop and let it restart the worker
        try:
            req = json.loads(line)
        except ValueError:
            req = None
        out.write(encode(handle(req), args.max_line_bytes))
        out.flush()
