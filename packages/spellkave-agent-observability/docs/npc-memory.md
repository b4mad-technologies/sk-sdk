# NPC host memory diagnosis

The worker-thread host samples memory independently of gameplay completion.
Host samples are taken every ten seconds with at most one pending read. A
failed read omits unavailable cgroup fields; it does not report zero bytes.
The host stops sampling on close and discards a pending result after close.
The implementation is `src/node-memory.ts`; lifecycle and projection checks
are in `src/__tests__/node-memory.test.ts`.

Metrics use the `spellkave.world_actor.` prefix, world/revision resource
attributes, and bytes (`By`) unless stated otherwise:

| Suffix | Scope and interpretation |
| --- | --- |
| `process_rss_bytes` | Whole Node process, including all worker threads. Never sum this per worker. |
| `main_heap_used_bytes`, `main_heap_total_bytes` | Calling main isolate, not total process memory. |
| `main_external_bytes`, `main_array_buffers_bytes` | Main-isolate external allocations; array buffers are included in external, not additive. |
| `cgroup_current_bytes`, `cgroup_peak_bytes`, `cgroup_limit_bytes` | Container cgroup v2, when available. `max`, missing files, and invalid values are omitted. |
| `worker_heap_bytes`, `worker_heap_total_bytes` | Per-seat worker isolate; existing used-heap name is preserved. |
| `worker_external_bytes`, `worker_array_buffers_bytes` | Per-seat external allocations with the same subset relationship as above. |
| `worker_memory_sample_age_ms` | Age since the parent received the worker sample. A blocked worker can leave old values; check this age before interpreting them. |

Worker samples arrive at boot, cycle completion, and every ten seconds while
the worker event loop runs. The npc-host exports the latest sample every
30 seconds (`DEFAULT_METRICS_FLUSH_INTERVAL_MS`, sk-rax8.21), so
`worker_memory_sample_age_ms` (computed at export) includes up to 30 seconds
of export wait. The timer cannot sample a synchronously blocked
worker. Sample age exposes that limitation; it does not diagnose the blockage.
Host samples are emitted once per received snapshot, not refreshed forever by
exporting the same value. Query timestamps and exporter heartbeat alongside
these gauges. Worker restart replaces its latest sample when the new worker
reports; old samples may remain until then and must be judged by age.

For an OOM investigation, retain a bounded UTC window and exact deployment
revision. Compare cgroup use/limit with process RSS, then main and worker
heap/external values. These categories do not sum exactly: allocator overhead,
native memory, stacks and cgroup accounting differ. Compare Kubernetes
termination reason and restart time; counters in a new container do not prove
the previous container avoided OOM. A low post-restart snapshot is not a peak.

This instrumentation arose from `sk-jay0.6.15.48`: World4 repeatedly reached a
3 GiB limit while its old worker-used-heap gauges stayed near 50–71 MB per
seat. That evidence established a measurement gap, not a particular leak.
The separately observed unbounded OTLP log request mechanism is a candidate,
not a proven cause of that incident. New measurements require a separately
coordinated deployment and live verification before making a production claim.

No gameplay reducers, content, world state or credentials are changed by this
sampler. Missing telemetry remains missing evidence. Package-only tests prove
sampling and projection contracts, not sustained hosted memory stability.

## Log transport pressure

The log sink admits at most 64 concurrent requests by default (configurable
with `maxPendingExports`). While a slot is free and nothing is buffered, a
record is sent at once. When admission is full, records are buffered and sent in
batches of up to `maxBatchRecords` (100) when a slot frees or after
`flushIntervalMs` (2 s). Only at `maxBufferedRecords` (10 000) are records
dropped, with one non-fatal error callback ("OTLP logs export queue is
saturated") per saturation period (`src/otel.ts`). A failed request is not
retried. This changes overload delivery behavior, not actor outcomes.
Every admitted request receives an abort signal after ten seconds by default
(`requestTimeoutMs`); response bodies are cancelled before releasing admission.

An injected transport that ignores abort remains charged against the limit
until it settles. Releasing that slot merely because time elapsed would permit
unbounded underlying work. Consequently `close()` still drains actual requests:
it is not an unconditional shutdown deadline for a non-cooperative transport.
Existing host-level bounded shutdown remains necessary. Tests in
`src/__tests__/otel-backpressure.test.ts` cover overload, response release,
abort/recovery and non-cooperative transport admission. These tests do not prove
that stalled log transport caused the public memory incident.

The metrics and trace exporters (`src/metrics.ts`, `src/traces.ts`) take the
same `requestTimeoutMs` (default ten seconds) since bead sk-jay0.6.15.56.21.
Before that a metrics request that never settled held one of its 64 slots for
the life of the process, and 64 such requests turned every later export into
"OTLP metrics export queue is saturated". Tests: `metrics.test.ts` and
`traces.test.ts` "aborts a hung export".

Export failures reach the console through `describeExportError`
(`src/node-resource.ts`): name and message, plus the cause's `code` in
brackets when it is a bare error-code token, for example
`TypeError: fetch failed [UND_ERR_CONNECT_TIMEOUT]`. `TypeError: fetch failed`
is Node's report for any network-level failure, not a code defect; the code
says which one. The cause message and the stack are never printed, because they
can carry a request URL. Exporter requests can time out while a busy host starts multiple seats.

The adventure host supplies the log sink snapshot to its separate metrics
exporter. Each flush emits `spellkave.world_actor.log_export_pending`,
`log_export_dropped`, `log_export_timed_out` and `log_export_failed` gauges.
Pending is current work; the other values are cumulative for that sink lifetime
and reset with the host. Timeout and failure overlap when an aborted request
rejects; do not sum them as distinct requests. No actor label is added. Metrics
delivery can itself fail, so absence remains unknown, not zero pressure.
