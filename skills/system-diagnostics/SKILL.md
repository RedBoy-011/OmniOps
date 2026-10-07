---
name: system-diagnostics
description: Diagnostic telemetry collection for CPU, RAM, GPU, storage, and network latency across cluster nodes.
version: 1.0.0
author: OmniOps Enterprise
required_capabilities: [chat, tool.read]
---

# System Diagnostics Skill

Provides real-time health inspection across Master, Worker, and Edge nodes.

## Capabilities
1. Query node telemetry (CPU load, Memory percentage, VRAM usage, Disk I/O).
2. Measure network round-trip latency and detect DNS leaks.
3. Inspect active Docker containers and service statuses.
