# A milestone gate composing over a prior beat's terminal flags only needs the ONE action each flag's own predicate requires — not a full re-derivation of that beat

(The ADV4/CC5 worked examples are from the retired Phandelver bundle, deleted in `fd2288bdea` — recover via `git show`, see `archive/README.md`; the rule still holds.)

A milestone/advancement beat that gates on flags a much larger prior beat
already sets (ADV4 gating on CC5's `castle_broken` + `cc5/wec_location_known`,
a 3-monster hostage-standoff terminal) does not need to replay that prior
beat's full narrative content to prove its own gate honestly. Read each
composed flag's OWN consequence predicate: `rouse_gundren`'s predicate had no
combat prerequisite at all (`target.has_tag(...) && actor.stat('gundren_rescued')
< 1`); `take_grol_map`'s predicate needed only the ONE named target's
`srd/hp <= 0` (Grol's), not the other two monsters in the room. Composing a
strict subset of the prior beat's own already-proven session (same
`session_definition`, participants trimmed to just the entities each
predicate actually reads) is a real, non-vacuous replay — every flag still
flips through genuine action execution against a live node, not a seeded
shortcut — while skipping content (hostage stand-off, extra combatants,
unrelated reveals) the new beat's own claim never depends on. Check each
composed flag's predicate before assuming "replay the whole prior beat" is
the only honest path.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
