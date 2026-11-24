# Damage-Type Routing Pattern

Damage-type routing is an authoring pattern, not a kernel damage subsystem. A
damage spell still writes HP through `ModifyResource`; the amount is a
DSL-valued `delta_source` that reads target defense tags.

Use the canonical helper when authoring from TypeScript:

```ts
import { routeDamage } from "@spellkave/world-author";

const deltaSource = routeDamage("8d6", "fire");
```

It emits:

```text
let dmg = 8d6; -cond(target.has_tag('damage_immune:fire'), 0, cond(target.has_tag('damage_resist:fire'), dmg / 2, cond(target.has_tag('damage_vulnerable:fire'), dmg * 2, dmg)))
```

## Two helpers: pick by who negates

`routeDamage` emits a **negated** amount, ready to drop straight into a
`ModifyResource.delta_source` that subtracts HP. That is the right helper
when the routing sits AT the write site — a damage spell, a trap, an
environmental effect.

`routeDamageMagnitude` emits the identical routing ladder **un-negated** —
a positive magnitude:

```ts
import { routeDamageMagnitude } from "@spellkave/world-author";

const magnitude = routeDamageMagnitude("1d8 + 3", "piercing");
// let dmg = 1d8 + 3; cond(target.has_tag('damage_immune:piercing'), 0, …)
```

Use it when the routed value is **consumed by something else** rather than
written directly — the case it exists for is an item carrying its own
damage in a DSL slot (`entity_definition_item_dsl_source`), which a shared
attack archetype then reads via `actor.wielded_item.source('<slot>')` and
negates once at ITS write site. Negating in both places would cancel out;
negating in neither would heal the target.

Both take the same `RouteDamageOptions` (`variableName`, `subject`,
`tagPrefix`), so a slot can route off a subject other than `target` if the
consuming expression binds one.

Rule of thumb: **the site that owns the `ModifyResource` owns the sign.**
Everything upstream of it stays positive.

## Defense Tags

Defense tags use this shape:

| Meaning | Tag |
|---|---|
| immunity | `damage_immune:<type>` |
| resistance | `damage_resist:<type>` |
| vulnerability | `damage_vulnerable:<type>` |

Author them on `[[entity_definition_tag]]` for every instance of a creature
definition, or `[[entity_tag]]` for one placed instance. Those are the carriers
that `target.has_tag(...)` reads at apply time.

Do not put defense tags on `[[capability_definition_tag]]`. Capability tags can
describe the spell, such as `damage:fire`, but they are documentary metadata for
this pattern and do not affect a target.

## Composition Idiom

Bind the damage amount once, then route the bound value:

```toml
frame_write = { ModifyResource = {
  actor = "TargetActor",
  resource = "my-bundle/hp",
  delta_source = "let dmg = 8d6; -cond(target.has_tag('damage_immune:fire'), 0, cond(target.has_tag('damage_resist:fire'), dmg / 2, cond(target.has_tag('damage_vulnerable:fire'), dmg * 2, dmg)))"
} }
```

The fixed ladder order is:

1. immune
2. resistant
3. vulnerable
4. normal

The expression negates the routed positive magnitude at the end. For
resistance, `dmg / 2` is integer division on the positive damage amount, so half
damage rounds down: raw `7` becomes HP delta `-3`.

## Lazy Branches

`cond` evaluates the bool, then exactly one int branch — this is the
DSL's own documented laziness, generated from the interpreter's operator
reference (see [`cond`](./dsl-grammar.md#cond)), not a property specific to
this pattern. Binding the raw roll with `let dmg = ...` prevents each branch
from rolling its own dice, and laziness means a resistant target does not
also evaluate the vulnerable or normal branch. That is the "no double
resistance" property of the simple ladder: the first matching defense case
wins.

## Known Boundary

A target that has both `damage_resist:<type>` and
`damage_vulnerable:<type>` for the same type is outside this static tag idiom.
The ladder checks resistance before vulnerability, so the tags do not cancel to
RAW x1 damage. Static authored defense tags should not carry both for one type;
dynamic resistance or vulnerability belongs in a future condition/modifier
mechanism with its own proof.

See the complete worked bundle at
[`examples/damage-type-routing.md`](./examples/damage-type-routing.md).
