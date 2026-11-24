# Condition-derived extent (reach activated by an authored act)

## Name

`dm-applied-extent-grant` — retained lookup name for the retired runtime delta
pattern. Authored condition activation replaces that workaround
(sk-jay0.3.24.187; ADR-0155's no-grant-leaf decision stands).

## Problem

A gift or agreement should activate cross-graph reach at a story moment.
Seeding that reach can disclose a remote companion's location and knowledge
before the bond. The carried item must independently matter at command time.

## Forces

- The extent describes reachable targets; possession and bond predicates
  govern whether a command is admitted.
- `grants_capability_while_active` carries plain IDs. The authored satellite
  `condition_capability_extent_grants` carries extent references.
- A Party extent resolves instance tags, blueprint tags and existing session
  peers through the shared resolver. A membership tag alone does not activate
  a condition-derived grant.
- `actor.has_item('<item definition>')` reads directly carried items at offer
  and dispatch. Carrying the stone needs no equipment slot.
- Raw condition gates cannot depend on effective capabilities or caller scope.
  The bridge uses the Hidden observation floor; stored grants retain their
  authored ceilings.

## Solution

1. Author an ordinary command capability and a bond condition.
2. Author one extent rule naming that condition, capability and Party tag.
3. Place the companion with the membership tag. Leave the hero without the
   activating condition.
4. Have the DM's fixed authored act apply the condition and record the hero's
   marker in one atomic consequence. Record the companion marker after its
   own successful act receipt. The watch resumes from durable markers.
5. Require the command capability on action and affordance. Gate the stone
   channel on possession and both channels on sender/recipient bond markers.
   Removing a condition source withdraws reach only when no other admitted
   source remains.

## TOML example

Given admitted condition and capability definitions in `demo`:

```toml
[[condition_capability_extent_grants]]
bundle_id = "demo"
condition_definition_id = "demo/bond-active"
capability_id = "demo/command-bond"
extent_kind_ref = "party"
extent_ref = "demo.companion.bond"
```

The activation consequence uses the existing leaf:

```toml
[[consequence_frame_writes]]
template_id = "demo/record-bond/success"
ordinal = 0

[consequence_frame_writes.frame_write.ApplyStatus]
target_kind = "entity"
target_ref = "TargetActor"
condition_definition_id = "demo/bond-active"
```

## Proof

- the world API: raw gates, suppression,
  independent sources, exclusive expiry and fail-closed behavior.
- `crates/spellkave-validate/src/refs/condition_extents/tests.rs`: references,
  dependency closure, owner locking and reserved-capability refusal.
- Elven-mini's unchanged Chapter 1 story assertions protect prebond fog.
- `author/dm-acts.ts` and `dm/watches/companion-bond-watch.ts` author and
  execute receipt-ordered bond activation; Hesper retains her placed identity.

## Gotchas

Marker seeds follow placement: actor placement can reseed its state.
The bond tag remains separate from the shared party sight tag. Extent rules
cannot name `frontier.*`. Inspect rules with
`spellkave capability condition-extents`; Doctor checks their references.
Exact export covers this satellite, while parent condition hook source remains
an existing export coverage gap.

## Related

[Conditions](../../../../docs/data-model-concepts/conditions.md#condition-derived-extents),
[Party extent](./party-extent-grant.md),
[Directed speech](./directed-speech-anchor.md).

## Known misuse / anti-pattern

Seeding command reach before the bond, using an item capability as a possession
predicate, mutating a protected Party authority tag through an act, or using a
per-play manifest apply to activate a fixed authored bond.
