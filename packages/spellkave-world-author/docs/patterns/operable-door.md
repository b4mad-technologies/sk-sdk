# An operable door between two places

## Name

`operable-door` — Authored open/locked facts on a two-sided boundary.

## Problem

A player should open and close a door from either side. A closed or locked
door should refuse a step, while the usual movement budget still applies.

## Forces

- `link_places --door` supplies a map tag. Traversal needs a predicate too.
- The two directed edges represent one physical door. Changes at either
  endpoint must affect both directions.
- Spatial-state definitions supply typed facts to location actions and to
  edge predicates (`@from_node` / `@to_node`). The writes are ordinary
  authored `Inscribe` consequences.
- The door adds a gate to the existing movement mode. It retains the
  bundle's SRD step policy, speed budget and long-running movement session.

## Solution

Give this door its own pair of boolean spatial-state IDs, `open` and
`locked`. Attach its operating niche to both endpoints. Each operation
writes the same value to both nodes in one consequence. Both directed
edges read their own `@from_node` values, so either endpoint sees the same
state after an operation.

The worked fixture uses `door_pattern/open` and `door_pattern/locked` for
one door. Give another door distinct IDs, even when the doors share a room.
Missing boolean values are false: this door starts closed and unlocked.

| Open | Locked | Traversal | Open action |
|---|---|---|---|
| false | false | refused | admitted |
| true | false | admitted | admitted |
| false | true | refused | refused |

The fixture's lock action requires `open == false`. Its unlock action
writes `locked = false`. All four operations require the authored
`door_pattern/operate` capability. A game with keys can give lock/unlock a
separate capability and grant that only to the appropriate player.

## Authoring shape

The complete, CLI-authored example is
[`behaviour/doors/fixtures/manifest.toml`](../../../spellkave-cli/behaviour/doors/fixtures/manifest.toml).
It places a player, Ada, in a two-room indoor graph and depends on `srd`.
The local proof seeds core mechanics and SRD before that root.

Declare each state through `write_rows --kind spatial_state_definitions`:

```toml
[[spatial_state_definitions]]
bundle_id = "door_pattern"
state_id = "door_pattern/open"
description = "Whether the cellar door is open."
value_type = "bool"
writer_policy = "world_interaction"
merge_rule = "replace"
lod_policy = "retain_latest"
freshness_rule = "expires_after_ticks:1000000000"
```

Declare `door_pattern/locked` with the same carrier. Use `define_niche`
with `attachments: [{node: <hall>}, {node: <room>}]`, and grant the operating
capability to the player. Each `define_action_verb` uses that niche. The
open action's eligibility predicate is:

```text
target.state('door_pattern/locked') == false
```

Its consequence has two `Inscribe` frame writes. One writes the hall:

```toml
[[consequence_frame_writes]]
template_id = "door_pattern/act/open/success"
ordinal = 0

[consequence_frame_writes.frame_write.Inscribe]
kind = "spatial_environment_state"
location_kind = "place_node"
location_ref = "door_pattern/cellar/hall"
payload_json = '{"state_id":"door_pattern/open","value":true,"visibility":"Public"}'
```

The second, at ordinal 1, writes `door_pattern/cellar/room` with the same
payload. Close writes `open = false` at both endpoints. Lock and unlock
write the corresponding `locked` value at both endpoints. These cooperative
world-state actions are unmetered and declare `non_steering = true`.

The edge gate has its own affordance template, using the existing
`srd/capability/walk`, `srd/niche/traversable-square` and `srd/outcome/step`:

```text
target.state('door_pattern/open@from_node') == true && target.state('door_pattern/locked@from_node') == false
```

Keep the bundle's `set_movement_default` pointing at `srd/affordance/step`
with the normal speed and long-running-move bindings. Attach the extra gate
to both directions:

```bash
sk bind_edge_affordance --from door_pattern/cellar/hall --to door_pattern/cellar/room --affordance-template-id door_pattern/door-gate --bidirectional
```

Rows in the same default movement mode AND-join. Leave
`inherit_movement_default` enabled. The
[`bundle-movement-default`](bundle-movement-default.md) pattern explains the
composition rule.

## Player loop and proof

Read `scene`, then copy the exit's own `handle` and `rev` into `move`.
Operate the door by manipulating the current place node, for example:

```bash
sk --profile door-proof-ada manipulate --target-id place_node:door_pattern/cellar/hall --action-id door_pattern/act/open
```

Inspect the action receipt; a successful CLI invocation alone does not prove
that the world accepted the action. Re-read the scene after a step to check
the player's location.

The live scenario in
[`behaviour/doors/doors.feature`](../../../spellkave-cli/behaviour/doors/doors.feature)
checks the initially refused step, accepted open and traversal, close from
the room, refused return, and locked-door refusals. Run it with:

```bash
SPELLKAVE_PLAYTEST_LIVE=1 pnpm --filter @spellkave/cli run test:behaviour:doors
pnpm --filter @spellkave/cli run guide:doors
```

It owns a disposable local world and uses a separate player credential.
Supply a current prebuilt server module with `SPELLKAVE_SERVER_WASM_BIN`;
the default is the checkout's release Wasm under `server/target/`. The
suite starts the node and publishes that module once.
The generated [guide](../../../spellkave-cli/docs/doors-guide.md) and
[evidence](../../../spellkave-cli/docs/doors-scenarios.md) contain the full
CLI run.

## Known misuse

- Reusing one door's state IDs for a different door sharing an endpoint.
- Updating only one endpoint: the reverse direction would retain old facts.
- Putting the gate in another movement mode: alternatives OR-join and can
  leave a passing route around the door.
- Disabling the inherited movement default and accidentally discarding the
  SRD movement budget.
- Expecting a baseline reapply to reset played state. Runtime spatial-state
  overrides survive reapply (ADR-0154); use the authored operations to reset
  this door.

## Related

[Runtime ambient state on incident edges](../interaction-dsl-and-world-authoring.md#runtime-ambient-state-on-incident-edges),
[place graphs and occupancy](../place-graph-occupancy.md),
[bundle movement defaults](bundle-movement-default.md).
