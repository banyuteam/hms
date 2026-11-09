---
name: python-extension-runtime
description: >
  Designs isolated Python worker processes for approved extensions, including RPC contracts, resource limits, security and lifecycle.
---


# Python Extension Runtime
Use separate worker processes/containers only when declarative IR is insufficient. Use typed RPC with deadlines and scoped inputs. No unrestricted production DB access. Enforce CPU, memory, wall-clock, concurrency and output-size limits. Restrict filesystem/network. Validate outputs in Go. Worker failure must not crash or deadlock core. A container alone is not a complete sandbox.

Justify extension -> define I/O -> threat model -> resource/network policy -> lifecycle/timeouts -> output validation -> hostile-input/resource-exhaustion tests -> audit worker version.
