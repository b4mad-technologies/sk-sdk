# Worked example - damage-type routing

Companion to [`damage-type-routing.toml`](./damage-type-routing.toml). The TOML
is a complete bundle that validates clean through the same wasm validator used
by `spellkave-author`.

## What it builds

The bundle creates a caster, one fire spell, and four targets:

| Target | Tag carrier | Result |
|---|---|---|
| Fire Immune Target | `damage_immune:fire` | 0 damage |
| Fire Resistant Target | `damage_resist:fire` | half damage |
| Fire Vulnerable Target | `damage_vulnerable:fire` | double damage |
| Normal Fire Target | no fire defense tag | full damage |

The routing lives entirely in the `ModifyResource.delta_source` expression:

```toml
delta_source = "let dmg = 8d6; -cond(target.has_tag('damage_immune:fire'), 0, cond(target.has_tag('damage_resist:fire'), dmg / 2, cond(target.has_tag('damage_vulnerable:fire'), dmg * 2, dmg)))"
```

`let dmg = 8d6` binds the raw roll once, so the branches do not reroll. The
whole `cond` result is negated because `ModifyResource` applies HP loss as a
negative delta.

## Tag carrier

Defense tags must be carried by `[[entity_definition_tag]]` or `[[entity_tag]]`.
Those are the rows that `target.has_tag(...)` reads during apply-time
manipulation. Capability tags such as `damage:fire` are useful documentary
metadata for the spell, but they do not make a target resistant or immune.

## Ladder order

The example uses this fixed order:

1. `damage_immune:<type>`
2. `damage_resist:<type>`
3. `damage_vulnerable:<type>`
4. normal

Resistance halves the positive damage magnitude before negation. Integer
division rounds down, so raw `7` becomes HP delta `-3`.

The helper exported by `@spellkave/world-author` emits this same string:

```ts
routeDamage("8d6", "fire")
```

## Known boundary

A target statically carrying both `damage_resist:fire` and
`damage_vulnerable:fire` is out of scope for this simple authored-tag idiom. The
first matching branch wins. RAW cancellation from dynamic resistance is a
separate condition/modifier mechanism, not part of this static defense-tag
pattern.
