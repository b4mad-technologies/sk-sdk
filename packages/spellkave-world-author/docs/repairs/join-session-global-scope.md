# `JoinSession`/`LeaveSession` read a GLOBAL `turn_state.scope_session_id` — the acting entity does not need to be a participant, but the room-alarm gate it often pairs with is a `spatial_environment_state`, not an `object_state`

A `JoinSession { participant_ref: "Actor" }` frame-write (mid-combat
reinforcement) and `LeaveSession { participant_ref: "TargetActor" }` (mid-combat
flee) both resolve their target session from `turn_state.scope_session_id` — a
**singleton**, not a per-actor field. It is set by session-open/`r_advance_turn`
and cleared only when that session closes. The world-tick heartbeat of a
promoted travel session does not take the scope from another live session, so
`JoinSession`/`LeaveSession` fired while somebody travels beside a fight still
resolve to the fight. Consequence: an off-grid,
non-participant entity can perform a self-eligible act that fires `JoinSession`
on itself and land correctly in whichever session is currently live — you do
NOT need to pre-enroll it as an initial participant (every initial participant
gets seated on the grid at session-open; there is no authored "enrolled but
off-grid" state), and you do NOT need a `TargetActor` ref from an on-grid
combatant (cross-graph targeting rejects a grid cell targeting a room node, and
vice versa — `place_graph_id` must match). The joiner must currently sit on a
non-ephemeral node: leftover positions on any ephemeral tactical-grid instance
(`place_graph_definition.is_ephemeral_instance`) are rejected at join ("already
seated on this session's grid" / "already seated on an ephemeral grid").
Session-open is the reseat path — it ignores those leftover cells and
row-major-seats from the new grid, restoring later to the new grid's
`anchor_node_id` (BL-76). `participant_ref` only ever
resolves to `Actor`, `TargetActor`, or a literal numeric entity id (never
authorable, since entities are runtime-minted) — so the joiner/leaver must
always be the acting entity or its target, never a third named NPC.

Separately: an alarm-style room flag an outsider act needs to read (`raise the
alarm` → `rush to reinforce once alarmed`) is authored as a
`spatial_environment_state` (topology-scoped, keyed by `place_node_id`, written
via the `ActorReachableNodes:<n>` Inscribe binding) — NOT an entity `object_state`.
Read it with `readSpatialNodeStateBool({ placeNodeId, stateId })`
(`@spellkave/sdk`), never `readObjectStateInt` keyed by the entity: the two
tables are disjoint, and a probe that reads the wrong one silently returns
`null`/`0` forever without ever failing loudly.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
