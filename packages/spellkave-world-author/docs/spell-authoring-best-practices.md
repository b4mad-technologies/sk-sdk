# Spell authoring best practices

How to add a spell to a Spellkave world without hand-wiring a dozen rows or
drifting into the duplication the author-time lint flags. This is the prose
companion to the worked example
[spell-identity-minimal](./examples/spell-identity-minimal.md) and the `emitSpell`
primitive in `@spellkave/world-author`.

The guiding maxim: **one spell is one identity, declared once, rendered by a
primitive.** Everything below follows from that.

## 1. One identity, three agreeing rows (#835)

A spell shows up across several row-kinds, but it has a single identity. Three rows
must carry the *same* id:

- the catalog `entity_definitions.entity_def_id` — the spell as a thing in the world,
- the `capability_definitions.capability_id` — "an actor can cast it",
- the cast `action_definitions.required_capability` — the verb binds back to it.

In the SRD bundle that id is `srd/spell/<slug>` (e.g. `srd/spell/fire-bolt`). The
cast **action** keeps its own verb id (`srd/cast_fire_bolt`) — only the *identity*
is unified, never the verb. Binding the three lets the validator's **MF-VAL-264**
(a `srd/spell/*` capability with no matching catalog entity) and **MF-VAL-265** (a
`required_capability` with no `capability_definition`) catch a broken spell at seed,
and lets the author-time lint catch it earlier still.

## 2. Let the primitive emit the rows — don't hand-wire them

Use `emitSpell({ capabilityId, actionId, bundleId, displayName, tags })` from
`@spellkave/world-author` (or, in the SRD sweep, a `behavior-cluster.ts` shape). It
builds the capability, the cast action, the outcome template, and their tags from
**one declaration**, all bound to the same identity, so the three-row agreement
above is structural rather than something you keep consistent by hand. Pass
`catalogEntityIds` and it asserts the catalog entity exists (the author-time form of
MF-VAL-264) before it emits.

Hand-authoring the same rows in TOML is where drift creeps in: a mistyped
`required_capability`, an underscore in one slug and a hyphen in another, a
copy-pasted action.

## 3. The four duplication smells (and the lint that finds them)

Run the author-time checker over a bundle:

```
sk lint <manifest.toml> [--bundle [--dep <dep-manifest>]...] --strict
# SRD bundle: sk lint packages/spellkave-srd-cc/fixtures/manifest.toml --bundle --strict
```

It emits **non-fatal warnings** — it never fails the run. It is deliberately
distinct from two neighbours: `sk validate` (which *fatals*, exit 2, on broken
refs) and the runtime `just doctor` (which checks a *live world's* health). The lint
reasons over manifest *rows* at author time. Its rules:

- **`twin-action`** — two `action_definitions` byte-identical except their id (the
  classic `cast_X` ↔ `cast_X/affordance` copy). Emit **one** canonical action and
  point the affordance template at it; don't duplicate the action.
- **`tag-repetition`** — the catalog identity's tag set re-carried verbatim on the
  behavior capability/action rows. Put taxonomy tags on the **identity**
  (`entity_definition_tag`); the capability/action carry only behavior-specific tags,
  if any. (Tagging the capability **and** the action from one `emitSpell` call is
  fine — that is the primitive's single-sourced output, not a smell.)
- **`spell-delimiter-drift`** — an underscore in a `srd/spell/<slug>` identity. The
  catalog convention is hyphen-delimited; mixed delimiters orphan the binding
  (`srd/spell/magic_missile` vs the catalog's `srd/spell/magic-missile`).
- **`orphan-spell-capability`** / **`dangling-required-capability`** — the
  author-time mirror of MF-VAL-264/265: a `srd/spell/*` capability with no catalog
  entity, or a `required_capability` with no `capability_definition`.

## 4. DRY via the substrate's own reuse points — not a new "base spell" row

The data model already gives you reuse primitives; lean on them instead of
copy-paste:

- **id-references** — point at a shared `outcome_template` / `consequence_template`
  rather than re-authoring it.
- **definition seeds** — `entity_definition_initial_state` /
  `…_initial_capability` / `…_initial_condition` give every instance of a definition
  its stats/capabilities/conditions (see
  [definition-seed-statblock](./examples/definition-seed-statblock.md)); you don't
  re-author them per instance.
- **`affordance_templates.composes`** and **`condition_definitions.implies`** —
  compose affordances and chain conditions instead of duplicating them.

⚠️ **Guardrail.** Reuse stays in the **authoring layer** that renders flat rows. Do
**not** ask for a substrate-level "base spell" row-kind that other spells inherit
from — that breaks the content-neutral substrate (ADR-0021, Gibson discipline). The
blessed reuse points above already exist; spell authoring uses them, it does not add
new ones.

## 5. Omit-the-default

Prefer authoring only the fields that differ from a row-kind's schema default.
Template rows carry constant boilerplate (`outcome_bool = true`,
`discovery_validated = false`, empty csv/json fields); when a field equals its
default, leaving it out keeps the manifest readable and the diff honest. (The schema
default omission is tracked under #836-A; `emitSpell` already emits the lean form.)

## Where this lives

- Primitive: `emitSpell` / `assertSpellCatalogBinding` in
  `packages/spellkave-world-author/src/spell.ts`.
- Lint: `lintManifest` in `packages/spellkave-world-author/src/lint.ts`; CLI
  `sk lint`.
- Worked example: [spell-identity-minimal](./examples/spell-identity-minimal.md).
- Identity unification rationale: issue #835; render-discipline + lint: issue #836.
