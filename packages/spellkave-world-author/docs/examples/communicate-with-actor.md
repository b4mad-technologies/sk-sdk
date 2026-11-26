# Example — communicate with a co-located actor

Teaching: `sk describe entities <herald>` shows the placed actor the speech affordance targets; `sk inspect` shows this example file.

How to make the player able to **address another actor** with a speech act
(the core `core/assert` communicate primitive). The complete manifest form is
[`communicate-with-actor.toml`](./communicate-with-actor.toml). For the
opposite case — a speech act with no addressee at all — see
["The addressee-less case"](#the-addressee-less-case-no-target-at-all) below.

The example declares `depends_on = ["core"]`: `core/communicate` comes from
the mechanics core fixture, rather than the kernel bootstrap vocabulary.
The generator resolves that fixture through a local author target while
keeping only the example's own rows in the output. For file validation,
supply the dependency explicitly:

```bash
sk validate packages/spellkave-world-author/docs/examples/communicate-with-actor.toml \
  --dep packages/spellkave-mechanics/fixtures/core/manifest.toml
```

This example also corrects a common misreading: people conclude
"actor-to-actor communicate is a substrate gap." It is not — the affordance
materialiser already admits any co-located *grounded entity* (item **or**
actor) as a communication target. Two authoring details decide whether it
works, and one query gotcha decides whether you can *see* that it worked.

## The two requirements

### 1. The actor needs its own `entity_definition`

Candidate-target derivation (`candidate_targets` →
`derive_entity_target_niches` in
the world API)
reads the entity's **definition** to build its target niches. An entity whose
`entity_def_id` has no matching `[[entity_definitions]]` row returns `None` and
is **silently dropped** from the candidate set.

A bare `[[entities]]` + `[[actors]]` block with no `entity_def_id` gets an
auto-derived def id (`<bundle>:<entity_key>`) for which no definition exists —
so the actor never becomes a target. Always pair the instance with a definition:

```toml
[[entity_definitions]]
entity_def_id = "communicate_with_actor/herald"
bundle_id = "communicate_with_actor"
display_name = "Village Herald"

[[entities]]
entity_key = "communicate_with_actor/herald"
bundle_id = "communicate_with_actor"
entity_def_id = "communicate_with_actor/herald"   # ← explicit, points at the definition
name = "Village Herald"
kind = "npc"
place_node_id = "communicate_with_actor/green"
```

### 2. The perceiver's affordance cache must be recomputed after the actor exists

Affordances are an opt-in **push cache** recomputed only for *touched* actors.
Applying a bundle re-touches the actors it names (the new NPC) — but **not** a
player who was already standing on that node. So right after seeding this
example the player's cache is still the pre-NPC one.

Any normal game action by the player re-touches the player and its co-located
neighbours and refreshes the cache. Standing on `communicate_with_actor/green`
(the node this example authors) and taking any act is enough; core no longer
ships a village graph to step off and back onto.

> This re-touch-on-bundle-apply asymmetry is the only real substrate nuance
> here, and it is a cache-freshness detail, not a missing capability.

## The query gotcha

A materialised communicate affordance carries **`action_id = ""`** and is keyed
by `interaction_descriptor` (the typed `communication_speech_act_id` wins in
`resolve_typed_descriptor`). Querying `action_id = 'core/assert'` finds only
*manipulate*-stamped rows (carried/equipped items) and **cannot see** a
communicate-against-actor row at all — a false negative. Query the descriptor:

```bash
# WRONG — misses communicate rows
just sql "SELECT target_entity_id FROM affordance
  WHERE perceiver_entity_id = <player_id> AND action_id = 'core/assert'"

# RIGHT — finds co-located item AND actor communicate targets
just sql "SELECT target_entity_id, action_id, interaction_descriptor FROM affordance
  WHERE perceiver_entity_id = <player_id>
    AND interaction_descriptor = 'communication.speech_act=core/assert'"
```

## End-to-end proof

```bash
just spacetime-start && just wipe
just seed packages/spellkave-mechanics/fixtures/core
just seed packages/spellkave-world-author/docs/examples/communicate-with-actor.toml

# resolve ids (herald is the npc this example authors at communicate_with_actor/green)
just sql "SELECT entity_id, name, kind FROM entity WHERE name = 'Village Herald'"   # → e.g. 12, npc

# Put YOUR player on communicate_with_actor/green (core no longer ships a
# default player or village). Any act there refreshes the cache (see requirement 2).

# the player now PERCEIVES a communicate affordance targeting the herald
just sql "SELECT target_entity_id, action_id, interaction_descriptor FROM affordance
  WHERE perceiver_entity_id = <player_id>
    AND interaction_descriptor = 'communication.speech_act=core/assert'"
#  target_entity_id | action_id | interaction_descriptor
# ------------------+-----------+----------------------------------------
#  9                | ""        | "communication.speech_act=core/assert"   ← a co-located item
#  12               | ""        | "communication.speech_act=core/assert"   ← the Village Herald (npc)

# and can EXECUTE the speech act against the actor
spellkave --url http://127.0.0.1:<port> intent manipulate <player_id> 12 core/assert
# {"reducer":"r_manipulate","status":"ok"}
spellkave --url http://127.0.0.1:<port> events 3 --kind layer2
# layer2:apply_consequence  consequence_template 'core/assert/success' Applied
# layer2:frame              frame_action: action_id='core/assert' outcome=Resolved terminal=true
```

The `r_manipulate` call resolves and applies `core/assert/success` against the
NPC — the directed speech act lands and resolves, end to end. (`<port>` is the
per-worktree node port printed by `just spacetime-start`; `just sql` resolves it
automatically, the raw `spellkave` binary needs `--url`.)

## Receiver side — the addressed actor currently perceives nothing

Targeting and executing the speech act works, but `core/assert/success` is a
**no-op consequence**: `effect_refs_csv = ""`, `traces_json = "[]"`, no
`[[consequence_frame_writes]]`. It resolves and emits an out-of-world event
(`layer2:apply_consequence` / `layer2:frame`) but writes **nothing in-world** —
no trace, no knowledge mutation on the target. So the Herald has no perceivable
artifact telling it that it was addressed.

Giving communication a receiver-visible effect is **authoring**, not a substrate
change: have the assert consequence `Inscribe` a trace (the same mechanism
`core/pickup/success` uses for `handled_item`), then let the addressed actor
read it through a trace-gated affordance (the shape of `core/trace/read`, which
materialises only once a trace exists at the node).

For directed speech, anchor that trace at the Herald's current place
(`location_ref = "TargetSpatialRef"`) and name the Herald in the PAYLOAD, via
`carry_addressee` — see "Trace Inscription — Payload Carriage, Anchors, And
How Long A Trace Stays Perceivable" in
[`interaction-dsl-and-world-authoring.md`](../interaction-dsl-and-world-authoring.md).
The anchor says where the utterance is heard, the payload says who it was
aimed at. A shout or room-wide line still uses `ActorSpatialRef`.

An earlier version of this page suggested anchoring the trace to the Herald's
own entity so it "follows the Herald rather than sits at the room". **Don't.**
It never made the trace addressee-only (traces carry no recipient column, only
ADR-0040/ADR-0095's co-location perception, so bystanders overheard it either
way), and it made the trace pile up ON the Herald and travel with him: bead
sk-oj6 caught a hero walking into a tavern and perceiving an entire earlier
conversation, raw internal tokens included, because the NPC it had been
addressed to was standing there. The core `core/assert` primitive ships empty
on purpose — the surface is there; the spoken content is left to authors.

## The addressee-less case: no target at all

Everything above assumes the speech act names *someone* — the affordance
materialiser admits every co-located grounded entity as a candidate target,
exactly like a manipulate action would. That is the right shape whenever the
niche a communicate template authors is **entity-provided** (the default
`niche_definitions` `provider`, or omitted entirely, as `core/assert`'s and
this example's own `communicate_with_actor/herald` niche both are).

It is the *wrong* shape for a plain, addressee-less shout — "just say
something to the room" — where there is no candidate entity to target at all,
only the room itself. `packages/spellkave-srd-cc`'s `srd/speak-aloud` is the
worked example (ADR-0137, amending ADR-0033 §D-2): its niche is authored
`provider = "actor"` instead —

```toml
[[niche_definitions]]
niche_id = "capability:my_bundle/action/communicate/shout"
provider = "actor"
```

— so the acting capability itself carries the verb (the same `provider =
"actor"` shape Dodge/Short Rest/Long Rest use for self-only manipulate
actions). An **actor-provided** communicate niche materialises **exactly one**
candidate: the place sentinel (`target_entity_id = 0`,
`target_ref = "place_node:<the speaker's own node>"`) — never an entity row,
regardless of who else is co-located. An **entity-provided** niche (this
page's whole worked example) never gets that sentinel; it keeps entity
candidates only, exactly as documented above.

Choosing between them is an authoring decision, not a substrate limitation
either way: author `provider = "actor"` when the speech act has no addressee
by design; leave the niche entity-provided (or omit `provider`) when it names
someone. Query the addressee-less case the same way, just filtering on
`target_entity_id = 0` instead of a specific entity id:

```bash
just sql "SELECT target_entity_id, target_ref, interaction_descriptor FROM affordance
  WHERE perceiver_entity_id = <player_id>
    AND interaction_descriptor = 'communication.speech_act=my_bundle/shout'"
#  target_entity_id | target_ref                              | interaction_descriptor
# ------------------+-----------------------------------------+---------------------------------------------
#  0                | "place_node:my_bundle/green"             | "communication.speech_act=my_bundle/shout"
```

## Why this is not a substrate gap

The place-loop materialiser branches on the typed `communication_speech_act_id`
descriptor (ADR-0021 content-neutrality) and treats co-located items and actors
identically as candidate targets. The original
#655 reading missed this on
three counts: the repro queried `action_id` (invisible to communicate rows), the
NPC fixture lacked an `entity_definition` (dropped from candidates), and the
player's cache was never recomputed after the NPC was seeded.
