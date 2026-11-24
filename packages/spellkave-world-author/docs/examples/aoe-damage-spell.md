# Worked example — an area-of-effect damage spell

Companion to [`aoe-damage-spell.toml`](./aoe-damage-spell.toml). The TOML is a
complete, self-contained bundle that validates clean
(`spellkave validate` / `check-refs` → `0 fatal`). This note explains the two
kernel primitives it chains and — just as importantly — what it deliberately
does **not** express.

## What it builds

A caster (`aoe_blast/mage`) with one action, `cast_firebloom`, that subtracts
HP from **every actor standing on the same node**. Two goblins share the
caster's node and are hit; a bystander one node away is not.

The whole effect is one `consequence_frame_writes` row:

```toml
frame_write = { ForEachActorInRadius = {
  center_ref       = "ActorSpatialRef",          # centre on the caster's node
  shape_id         = "core/area/node_ball",      # topological AoE shape
  shape_params_json = '{"ball_radius": 0}',      # 0 = same node only
  predicate_source = "d20 < 13",                  # per-target DEX save DC 13
  body = [ { ModifyResource = {                   # run once per FAILED-save actor
    actor        = "Actor",                       # the PER-ACTOR binding
    resource     = "aoe_blast/hp",
    delta_source = "-d6"                          # roll 1d6 of damage
  } } ]
} }
```

Both `predicate_source` and `delta_source` are authored DSL expressions
(ADR-0045): the predicate is a per-target **Bool** evaluated once per selected
actor, and the delta is an **Int** expression evaluated per target. Each actor
rolls its own `d20` save and its own `d6` damage from a distinct draw chunk.

### The two primitives

| Primitive | Role | Lives in |
|---|---|---|
| `ForEachActorInRadius` | Selects actors an authored area shape covers, then runs `body` once per actor. | `FrameWriteOp::ForEachActorInRadius` (kernel) |
| `ModifyResource` | Per-target read-modify-write of a resource by `delta_source`, an authored DSL Int expression. | `FrameWriteOp::ModifyResource` (kernel) |

Both landed for AoE use via **CR-8 / ADR-0042** (the apply-path wiring) and the
`MF-VAL-217` resource lint. Before that, an AoE damage row admitted but did
nothing — the original motivation for [#266](https://github.com/b4arena/spellkave/issues/266).

### The bindings that matter

- **`center_ref = "ActorSpatialRef"`** centres the shape on the *caster's*
  node. `TargetSpatialRef` also resolves if you want to centre on a chosen
  target instead.
- **`actor = "Actor"` inside the body** is *not* the caster — the selector
  rebinds `Actor` (and `ActorSpatialRef`) to each selected actor before running
  the body. That is why each goblin rolls its *own* `d6` damage independently. If
  you wrote the caster's key there, every iteration would hit the caster.

### Two area shapes

- **`core/area/node_ball`** (used here) is *topological*: centre node plus all
  nodes within `ball_radius` graph-edges. `ball_radius: 0` means "same node".
  Works on any graph, metric or not — the safe default.
- **`core/area/sphere`** is *metric*: `{"radius_m": 5.0}` reads each node's
  `pos_x`/`pos_y`. Use it only when your nodes carry real positions (as in the
  SRD Acid Splash row, `world-fixtures/srd/base/spell-actions.toml`).

The full shape vocabulary (`sphere`, `cone`, `line`, `cube`, `node_ball`) is
authored in `world-fixtures/core/base/spatial.toml` as `area_shape_definition`
rows.

## The resource lint — why `resource_definitions` is mandatory

The `ModifyResource` body names `resource = "aoe_blast/hp"`. That string **must**
match a `resource_definitions` row or the lint rejects the bundle
(`MF-VAL-217 Fatal`). This is the guard that closed the worst silent-no-op class
from #266: a typo'd or undefined resource no longer admits-then-does-nothing —
it fails loudly at validate time.

Note `initial_value = 30`: an un-instantiated pool seeds at `min_value` (0), so
without an explicit full-HP start, every `-7` clamps to 0 on first hit.

## What this does NOT express — open #266 axes

This example is honest scaffolding. The AoE *selection* and flat *application*
work; a faithful 5e spell still cannot be authored. Each gap below is a live
[#266](https://github.com/b4arena/spellkave/issues/266) axis:

| Axis | Status | Why |
|---|---|---|
| AoE selection + apply-path | ✅ **works** | CR-8 / ADR-0042 |
| Resource-existence guard | ✅ **works** | MF-VAL-217 |
| **Dice damage** (`1d6`) | ✅ **works** | `delta_source = "-d6"` rolls 1d6 (ADR-0045 D-1). Arithmetic (`+ - * /`), grouping, and `cond(..)` compose — save-for-half is `delta_source = "cond(d20 >= 13, 0 - d6 / 2, 0 - d6)"`. |
| **Saving throws** | ✅ **works** | `predicate_source` is a per-target DSL Bool (ADR-0045 D-2). Here `"d20 < 13"` is a flat DEX save; a stat-modified save reads `actor.stat('..')` once the target carries that stat. |
| **Damage type** | ❌ open | `resource` says "subtract HP", not "as fire damage"; no resistance/immunity routing (ADR-0045 G-3). |
| **Target-count cap** | ❌ open | "one or two creatures" — the selector hits *all* in radius. |
| **Level scaling** | ❌ open | No level-indexed dice / tier table. |
| **Range gate (placement)** | ✅ **works** | The affordance's `range_m` (ADR-0053) lets the cast act on a distant cell/entity within metric range; `0.0` = touch. Per-caster range *modifiers* (folding a caster bonus into `range_m`) are still deferred. |

Saving throws were deliberately *never* a kernel primitive — ADR-0045 made them
a **composition** of the generic DSL (`d20`/`roll`, arithmetic, comparison,
`cond`) carried on `predicate_source`/`delta_source`, exactly as planned. The
kernel gained one content-neutral `cond` op and no save/damage concept.

## Apply it against a live node

```bash
just wipe && just seed                       # core baseline
just seed world-fixtures/<copy-of-this>      # layer the bundle on top
```

Each goblin that fails its `d20 < 13` save loses `1d6` HP (its own roll) when the
mage casts; a goblin that rolls 13+ takes nothing, and the bystander one node
away is never selected.
