# `RelocateEntity` is the un-gated, world-scoped forced-move leaf — no `place_edge` required, unlike `JoinSession`/`LeaveSession` it never touches a session

A consequence that must move an actor somewhere it did NOT choose to walk
(flood knockback, a shove, a trap drop) authors a `RelocateEntity` frame-write
leaf, not a fabricated `place_edge` + `r_move` call:

```toml
[consequence_frame_writes.frame_write.RelocateEntity]
target_ref = "TargetActor"

[consequence_frame_writes.frame_write.RelocateEntity.destination]
kind = "place_node"
id = "triboar_trail/cave_mouth"
```

`target_ref` resolves the same way `JoinSession`/`LeaveSession` do (`Actor`,
`TargetActor`, or a literal numeric entity id) — a self-eligible act that
targets itself (the common case: a save-or-suffer hazard) uses `TargetActor`
since the acting entity IS its own target. `destination` is validated for
**kind + existence only** — the write does NOT check a `place_edge` from the
entity's current node, on purpose: a forced move is the involuntary
counterpart to `r_move`'s voluntary edge-gated traversal, and requiring an
edge would make "shove someone through a wall" inexpressible. Unlike
`JoinSession`/`LeaveSession`, `RelocateEntity` reads no
`turn_state.scope_session_id` and touches no `session_participant` row — it
works identically in and out of a session, and the target does not need one
open (#1706 leg 4, ADR-0079).

---

## Known misuse / anti-pattern

Do **not** fabricate a `place_edge` + `r_move` call to force a move the
actor did not choose. That smuggles an involuntary relocation through the
voluntary traversal gate and teaches the next author that "every move needs
an edge". Prefer `RelocateEntity`. Conversely, do **not** reach for
`RelocateEntity` when the actor *is* walking a known edge — that is `r_move`.

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
Checklist before filing a kernel gap:
[`patterns/before-filing-a-kernel-gap.md`](../patterns/before-filing-a-kernel-gap.md).

## Misuse / anti-pattern

- Filing teleport / Misty Step as a missing kernel primitive: **use this leaf**.
  Teleport spells are `RelocateEntity`, not a movement-default or fabricated
  `place_edge` + `r_move`. Destination may be a concrete `place_node` id or a
  spatial binding (`TargetSpatialRef`) for player-chosen landings.
