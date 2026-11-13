"""runtime.*: built into every worker."""

from hms_runtime import capability, schema


@capability("runtime.ping", input={"echo": schema.Str(max_len=64, default="")}, output={"echo": schema.Str()})
def ping(inp):
    """Liveness. Echoes a short string."""
    return {"echo": inp["echo"]}
