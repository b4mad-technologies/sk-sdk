# Behavior composition — the `ActorBehavior` layer

The composition layer in `@spellkave/world-author` turns **one declarative
`ActorBehavior` object into the full behavior chain** — `capability_definitions`,
`outcome_templates`, `affordance_templates`, `action_definitions`,
`consequence_templates`, `consequence_frame_writes`, plus the live-wiring rows
(`actor_capabilities`, `spatial_niche_attachments`) that let it fire. It is the
canonical way to author a spell, monster attack, zone, or condition effect
programmatically (ADR-0072 D-1; promoted from the old `scripts/srd/behavior-cluster.ts`
in #1526; that file's re-export shim was retired with the `spellkave-srd` package).
Everything renders through `renderSchemaManifestJson` and the same
wasm validator crate the server runs at admission — the manifest stays the only
admission contract (ADR-0025).

## When to use it (ADR-0072's boundary)

- **A behavior chain** (spell / attack / zone / summon / condition effect) →
  this layer. One typed declaration, one render, one validate.
- **A mechanical one-row edit** ("grant this actor that capability", a tag, a
  placement, a state seed) → an `sk patch` op instead.
- **One spell's identity core only** (capability + cast action + tags bound to
  one `…/spell/<slug>` identity, no effect chain) → `emitSpell` (see
  `spell-authoring-best-practices.md`).

## Entry points

```ts
import {
  type ActorBehavior,
  type BehaviorConfig,
  authorBehaviorFragment, // top-level: reads the manifest header, renders + guards, writes the fragment file
  clusterRows,            // the engine: ActorBehavior[] -> row tables (pure, no fs)
  mergeRowTables,         // concat-merge row-table maps
  renderFragmentFromRows, // rows -> header-stripped [[include]] fragment TOML
  renderCompleteManifest, // rows -> standalone manifest TOML (headers kept)
  INSTANCE_ROW_TABLES,    // the definitions-vs-instances partition set
} from "@spellkave/world-author";
```

Most drivers call only `authorBehaviorFragment({ behaviors, cfg, out })`. The
`shape` field picks where the to-hit / save roll sits: `aoe`, `single-target`,
`zone`, `scheduled-zone`, `env-state`, `summon`, `outcome-graph` — each expands
to generic kernel primitives (`ForEachActorInRadius`, `ModifyResource`,
`ApplyStatus`, `Inscribe`, `Spawn`, outcome graphs); the kernel never learns
"spell" vs "monster attack". The authoritative field-by-field reference is the
doc comments on the `ActorBehavior` interface in
`packages/spellkave-world-author/src/compose.ts`.

## Minimal example

```ts
const strike: ActorBehavior = {
  key: "goblin-scimitar",
  displayName: "Goblin Scimitar",
  emitCapability: true,
  actionTags: ["srd", "monster-action"],
  shape: "single-target",
  predicateSource: "", // OFFER: deterministic eligibility only — no die here (#1891)
  deltaSource: "0 - (1d6 + 2)", // negative = damage; positive would heal (max_value clamps)
  resolutionMode: "Stochastic", // ACT-TIME resolution: r_manipulate rolls for real
  resolutionPredicateSource: "d20 >= 15", // the to-hit roll now lives here
  onFailure: "srd/goblin-scimitar/miss", // a MISS applies this consequence instead of on_success
};
```

> **Where the die goes.** For `shape: "single-target"` (and `clock`),
> `predicateSource` compiles to `affordance_templates.predicate_source`.
> Disclosure never evaluates that predicate (the materialiser offers by
> `capability_id`), but `r_manipulate` evaluates it at act time with live
> draws — so a die left there turns a miss into a rejected attempt with no
> `onFailure` consequence (see
> [`offer-vs-resolution-roll`](./patterns/offer-vs-resolution-roll.md)).
> Put the roll in `resolutionPredicateSource` with `resolutionMode:
> "Stochastic"` and an `onFailure` consequence, as the example above does.
> These fields map 1:1 onto `action_definitions.resolution_mode` /
> `.resolution_predicate_source` / `.on_failure` and are optional; `aoe` /
> `outcome-graph` / `zone` / `scheduled-zone` branch on a roll inside their
> own body or graph and do not use them (field doc comments on
> `ActorBehavior` in `compose.ts`). Unlike `on_success` (always
> auto-derived and emitted by this composer), `onFailure` is a bare
> `consequence_templates` id the composer does **not** create — author the
> miss consequence separately (e.g. `spellkave_define_consequence`) and pass
> its id through.

Render it with `authorBehaviorFragment` from a driver run via
a `just srd-cc-author-<driver>` recipe (e.g. `just srd-cc-author-dm`,
`just srd-cc-author-kavemouth`; `just/authoring.just`) (freeze rule: prefer a data entry in an existing
driver over a new `author-*.ts` file — ADR-0072 D-3).

## Node-only

`authorBehaviorFragment` reads and writes files; the layer is exported from the
package root (Node entry) and deliberately **not** from `./browser`. Browser
authoring surfaces compose rows themselves and render via the browser wasm
path.

## Bounded place-seal transition

A consequence may author the unit string `"BreakPlaceSeal"` in its ordered
`frame_writes` list. This unit operation takes the normal place-node target and
existing `dispatch_text` argument; it has no graph-id or reason field of its own.
Its privileged lane must be `frontier.break_seal`, backed by a live PlaceGraph
binding covering the resolved sealing ancestor. It stages the transition until
the enclosing ApplyConsequence event exists, then writes the break and Public
trace together. A later prepare failure drops the staged transition. Other writes
keep the same lane and independently check their own landing; a break grants no
seal exemption for remaining ancestors or outside targets. See
[prepared-boundary authoring](roles.md#break-a-prepared-boundary-through-an-authored-act).
