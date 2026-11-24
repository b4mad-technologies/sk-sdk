# NPCs need a driver — there is no autonomous NPC behavior

Spellkave's module has a hard rule: **it contains no actor decision
logic**. The world simulates physics, time, scenery, and mechanical
phenomena — it does not decide what any creature wants or does. Every
actor, human or AI, connects from *outside* via a SpacetimeDB SDK
client and submits intents.

What this means for you as a modder:

- You cannot declare "this goblin patrols at night" in a manifest.
  There is no field, predicate, or DSL form that animates an NPC
  from data alone.
- A bundle-authored NPC without an external driver is effectively a
  **statue**: it can be targeted, struck, looted — but it
  will never move, speak, flee, or fight back on its own.
- The in-module autonomy layer is **scenery-only**: weather, decay,
  scheduled phenomena. It deliberately refuses to branch on what an
  entity prefers, fears, or chooses.

You have exactly two paths to make a creature *do something*:

1. **Ship an AI-bridge program.** Write an SDK client (Rust, TS, …)
   that connects to the node, claims the NPC, and submits intents on
   its behalf — exactly the way a human player's client does. The live
   Brief-20 claim-lock gate rejects competing manipulation intents with
   `claim_contended`, so AI-bridge programs must handle that rejection
   path; see [claims][claims]. This is the supported path for anything
   resembling "behavior" (patrols, aggression, dialogue, retreat,
   trade).
2. **Re-express it as a mechanical phenomenon.** If the behavior is
   actually deterministic scenery in disguise, model it as a scheduled
   transformation: *"at midnight, a swarm of bats spawns in cave B and
   despawns at dawn."* This is fine — no preferences, no branching on
   what anything "wants," just clock-driven world change. If your
   description needs the word "decides," "tries," or "wants," it does
   not fit this path; go back to option 1.

**Worked example — a wandering goblin.** You want a goblin that paces
its lair at night and attacks intruders.

- *Manifest only:* not possible. Author the goblin entity, location,
  conditions, and item-entities; it will stand motionless until something
  external acts.
- *Path 1 (driver):* author the goblin row, then run a small bridge
  process that subscribes to the goblin's tile, picks a neighboring
  tile each tick, and submits a `move` intent; on player proximity it
  submits `attack`. This is the observed path for preference-driven NPC behavior (no in-module planner exists; mechanical reframing is the other legal authoring path below).
- *Path 2 (mechanical reframing):* drop the "goblin that patrols" idea
  and author instead a "goblin ambush" phenomenon — at a fixed tick,
  spawn a goblin entity adjacent to any player in the lair. No
  preferences, no pathing. Deterministic. Allowed.

Binding rules:
ADR-0003 D-1
(no actor decision logic in the module) and
ADR-0004 D-1/D-2
(autonomy is scenery-only; NPC behavior is out of scope).

## Host metrics vocabulary is not a manifest field

Cycle-step, error-code, and tool names on `spellkave.world_actor.cycle_failures_total`
and `spellkave.world_actor.requests_total` are declared by the adventure package
that boots the driver — passed as `metricsVocabulary` into `startAdventureHost` —
not as world-manifest rows and not as a generic runtime registry (ADR-0115 D-4).
A missing list is a boot error. An unlisted step, error code, or tool name is
logged once as unmapped; the exporter still collapses the metric attribute to
bound cardinality. First consumer:
`packages/spellkave-adventure-elven-mini/npcs/metrics-vocabulary.ts`. Contract:
`packages/spellkave-adventure-runtime/docs/host-metrics-vocabulary.md`.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
