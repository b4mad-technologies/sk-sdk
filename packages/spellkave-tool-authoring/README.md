# Shared authoring tools

Applyset diff and apply accept exactly one input mode: `dir` for a local host
with a filesystem port, or `source` for an invocation-local payload:

```json
{"source":{"root_path":"scene/manifest.toml","root_toml":"...","fragments":[{"path":"scene/actors.toml","toml":"..."}]}}
```

Fragment paths are logical names relative to the payload map. A root include
`actors.toml` resolves relative to `scene/manifest.toml` to `scene/actors.toml`.
The normalized `root_path` is recorded in applyset memory, so reuse the same name
for later updates. Payloads never consult host files or fetch network includes.
They reject traversal, absolute paths, backslashes, NUL, colon-qualified paths,
duplicate normalized names, omitted includes, more than 128 fragments, and more
than 1 MiB of decoded UTF-8 source and path bytes. Local dependency paths (`dep`)
cannot be combined with payload mode. Hosted callers must supply `source`.

Both modes use the existing parser, classifier and applyset safety checks.
Scoped comparison coverage still limits prospective writes; `force` cannot
supply unreadable state. A successful offline diff is not a server grant.

[Authority surface matrix](docs/authority-surface-matrix.md) lists every registry verb,
capability alternatives, required ports and hosted disposition. Discovery is a
conservative hint; exact role, extent, arguments and fresh authority remain
server decisions. Presentation presets and documentary personas grant nothing.

HTTP MCP regenerates discovery for each request. Clients that cache tool lists
must refresh `tools/list` or reconnect; stale calls still pass current admission.
Local stdio MCP captures discovery when it connects, so reconnect after authority
changes to refresh its advertised list.

Verified caller examples (internal record, not in this repository)
link exact presence-only HTTP/local stdio requests, payload success, server-path
refusal and independent postconditions at a pinned revision. Synthetic aliases
must be replaced with the caller's own admitted binding/source values. Shared
persona-guide publication and discovery remain transitional under
`portable-persona-guidance` (`sk-jay0.3.24.56`).
