# `@spellkave/tool-node`

Node-only implementations of the narrow filesystem/path, local credential,
raster-output, and host-telemetry ports exported by `@spellkave/tool-runtime`.
It is an opt-in host adapter, never a browser dependency.

Browser hosts compose `@spellkave/tool-runtime` without these ports. A
capability-bound definition is omitted from a role roster; if a host binds one
directly anyway, execution fails before its body runs with
`ToolCapabilityUnavailableError` (`code: "tool_capability_unavailable"`).
No conditional Node import or gameplay fallback is attempted.
