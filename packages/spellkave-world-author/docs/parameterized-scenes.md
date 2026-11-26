# Parameterized scenes

Use a scene package to start a named run from an existing empty place blueprint
and existing figure definitions. Each run gets its own graph, node IDs and
figure keys; the rules and catalog definitions remain shared. This prepares
starting state. Play can change it permanently.

## Inspect, render, then explicitly stage

First choose the caller and world with the normal connection context. The
caller needs complete Internal source read authority, and apply authority over
the destination rows. The destination needs admitted placement authority as well as its owner Bundle
claim. Existing graph ownership or a PlaceGraph binding covering the anchor
and generated descendant supplies that placement scope. Its owner header
must match the destination bundle when no header edit is authorized. The owning publisher can prepare
that bundle and grant its ordinary author binding. A changed header is an
ordinary bundle write and can be refused independently of the scene geometry.

The package is JSON data, not a template program:

```json
{
  "format": "spellkave-scene/v1",
  "id": "target-room",
  "version": "1.0.0",
  "bundle_id": "trials",
  "blueprint_id": "catalog/room",
  "dependencies": ["catalog"],
  "figures": [{
    "key": "targets", "entity_def_id": "catalog/target",
    "node_local_id": "entry", "kind": "npc", "name": "Target",
    "default_count": 1, "max_count": 4
  }]
}
```

Supply `values` such as `{"anchor_id":"catalog/room/entry","counts":{"targets":2},"bearing_deg":90}`,
`setup_name` such as `trial-b`, and `dependencies` containing resolved TOML
payloads. Include the dependency closure required by the existing manifest
validator, including dependent bundle headers. Setup names use 1–64 lowercase
letters, digits, dot, underscore or hyphen. Count groups are declared by the
package, with at most 128 figures in total. Unknown package/value fields,
unresolved references and dependency collisions refuse before mutation.

`sk render_scene --json '<payload>'` renders and validates without connecting.
Use `sk --live render_scene --json '<payload>'` for an admitted live source
preview. The returned `details.plan` includes the package and dependency
digests, normalized values, generated references, ordinary TOML phases and
validation closure. Connected preview also pins the caller, endpoint,
world-instance identity and exact empty-source snapshot. Offline validation
is not source admission and cannot authorize staging.

Review the plan, then call:

```bash
sk --live stage_scene --json '{"plan": <the unmodified details.plan>, "expected_world_instance_id": "<reviewed world instance>"}'
```

Replace the placeholders with the returned JSON object and world identity.
The same AUTHOR payloads are `spellkave_render_scene` and
`spellkave_stage_scene` over a supporting MCP caller connection. Supply
payloads directly; these tools do not accept gateway filesystem paths. CLI
`--json` avoids shell list parsing for TOML dependency arrays. The server must
support source projection protocol 1; unavailable or incomplete source reads
refuse without a publisher credential fallback. `MF-APPLY-052` is the allocated
scene-source precondition refusal: the source is unavailable, incomplete,
changed or inhabited; the instance name is used; or the graph-only envelope is
unsupported. Inspect current state and preview again before deciding to retry.
Earlier authority, seal and world-instance failures keep their existing codes.
`MF-APPLY-050` and `MF-APPLY-051` remain unassigned.

## Read the receipt before doing anything else

Graph creation and explicit population are separate admitted phases. The graph
phase rechecks the reviewed digest and absence of inhabitants atomically with
all graph clone writes. A source containing any entity or positioned actor is
ineligible, including a player carrying an identity. Nodes, edges, gates,
movement defaults, authored traces, spatial niches and the source seal are
pinned. The bounded projection fails closed rather than certifying a truncated
source. Both phases carry the reviewed world-instance identity through enqueue
and drain; a reset invalidates queued work and previews.

A receipt lists each phase as `committed`, `refused` or `unknown`, preserves
the generated graph/node/figure keys and never reports partial success as full
success. Runtime figure IDs are included when subsequent authorized inspection
can observe them; unavailable inspection is explicit. It reports
`controllable: false`: placing an entity definition does not assign an actor,
identity, driver, consent offer or role. Use your already controlled actor or
an existing explicitly admitted controller association to exercise targets.

Inspect with existing `sk --live get --kind entities --key <figure-key>` and
`sk --live describe --kind entities --key <figure-key>` before retrying. A
repeated setup name refuses while its graph exists; it does not reset or
reconcile the run. After a disconnect, inspect current graph and figures before
making another decision. Automatic retries of a non-idempotent graph phase
are unsafe even when its response was lost.

## Exercise and cleanup

Select your existing actor normally, inspect its available actions, and act
against the observed typed target using `sk manipulate`. Inspect its act record
with `sk self_states --kind evaluation`, as described in [rule-bench](rule-bench.md).
Scene tools do not heal, respawn or monitor defeated figures. A new setup name
starts a new run; it does not change a previous figure's runtime state.

Cleanup needs current authority and inspection of references and occupants.
Existing graph Despawn, where its surviving anchor and authorization admit it,
updates occupants' entity locations to that anchor. Inspect those entities afterward and report
them as survivors; graph absence is not body absence. Before removing a scene
graph, inspect its current anchor: a cloned entry node belongs to the graph and
will be removed with it. An admitted ordinary author edit can select a surviving
external node first. The cleanup proof explicitly makes that choice, executes
the existing authored Despawn primitive and checks the surviving bodies. The
live proof also found that an occupant's `actor_spatial_location` can retain its
deleted node after this entity-location update. That existing cleanup defect is
tracked in `sk-jay0.3.24.169`; spatial cleanup is incomplete, so inspect both
location components and avoid treating graph removal as a coherent reset.
Runtime spawns, carried
loot, events and graph satellites may remain outside applyset memory. Existing
entity retractions and other admitted acts apply their own live-reference
checks. A receipt supplies references, never deletion authority; a matching
name prefix is not cleanup ownership. The receipt always reports cleanup
coverage as unknown and complete teardown as false. There is no one-shot
uninstall, automatic reset or recorded-proof replay in this workflow.

The installed CLI and HTTP MCP caller-daemon scenarios are verified in the
AUTH-50-01/02 captures, with
[reproduction and limits](../../../sandbox/parameterized-scene-setups/README.md).
Queued source drift, late player arrival and a real world reset have separate
live proofs. CLI/MCP captures use synthetic local worlds; external client
authentication and unaided discovery remain unverified. Final portable evidence
publication belongs to `portable-persona-guidance` (`sk-jay0.3.24.56`).
