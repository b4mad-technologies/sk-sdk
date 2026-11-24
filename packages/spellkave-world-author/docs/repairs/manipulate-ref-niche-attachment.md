# An item-scoped place niche needs a `spatial_niche_attachment` (or `provider = "entity"`), however the manipulate ref is built

(The RH*/WE*/CC* worked examples on this page come from the retired
Phandelver bundle and its walkthrough, deleted 2026-08-14 — recoverable only
via `git log`/`git show`, see `archive/README.md`; the rules still hold.)

**Gotcha — an item-scoped niche on the default `place` provider needs its
own `spatial_niche_attachment`** (`niche_id` = the item's own
`niche_definitions` row, predicate `target.has_niche(...)`, no
`on_consume_consequence_id` link — RH7's `study_journal` shape). A
`niche_definitions` row with an empty `provider` resolves to `place`, and
`r_manipulate` then requires an attachment binding the niche at the hosting
node — the SAME per-niche opt-in as `srd/niche/strikeable_target` and CC2's
custom-capability niches. Without it the act rejects
`r_manipulate: no authored affordance_template selected action_definition '…'
— niche_unresolved: … no spatial_niche_attachment binds any of this action's
niches to the actor's current node …`
(the world API). Two fixes: add
the attachment row (CC3's `augury_statuette` shape), or author the item
niche with `provider = "entity"` so the item's own tags/state are the gate
(see [`affordance-needs-niche-attachment`](./affordance-needs-niche-attachment.md)).

Do not hand-roll the target ref either: read it from the caller-scoped
manipulation context — `spellkave manipulation-context targets
<perceiver_entity_id>` (CLI, `client/src/cli/manipulation_context.rs`), the
player tool `spellkave_manipulation_context`, or
`readManipulationContext(db, perceiverEntityId).targets[].target_ref` in
`@spellkave/sdk` (`packages/spellkave-sdk/src/core/readers/manipulation_context.ts`).
Those targets are disclosed references, not a claim that any action is legal
against them; the reducer revalidates at act time. RH7's walkthrough
originally escaped the attachment by resolving its ref through the per-actor
affordance cache (`readAffordances`), whose materialiser found co-located
items by a direct `entity_location` scan; that cache is retired (see
[`interaction-dsl-and-world-authoring`](../interaction-dsl-and-world-authoring.md)),
so that route no longer exists.

**Gotcha — a `combat_grid` session's participants are spatially UNREACHABLE
by a non-participant** (WE9). Opening a session relocates every seated
actor into an ephemeral session-scoped sub-graph
(`session_grid_<N>/c_<x>_<y>`) with NO `place_edge` back to the room
graph. A third-party actor's targeted action against a seated participant
rejects — `range_m = 0.0` (exact-node match) fails outright, and
`range_m > 0` does a real graph BFS (`place_node_ids_within_range`) that
never crosses into the disconnected sub-graph either. There is no
workaround short of NOT putting the reacting NPC in the session: let the
session run its course, then act strictly BETWEEN sessions once its
participants have reverted to the real room node (the SAME reversion
WE6's own after-session loot already depends on). For a story that needs
a third party to react mid-fight (e.g. "flee once 3 of 4 allies fall"),
split the encounter into SEPARATE sequential 1v1 sessions (WE7's
solo-combat shape, reused N times against one shared `session_def_id`)
rather than one combined multi-enemy session — the reacting NPC gets a
real, in-range window after each individual defeat.

**Gotcha — a SECOND `combat_grid` session opened while an actor from the
FIRST session is still seated still yields two disconnected grids**
(#1814 ISS1814 / BL-76). `session_grid_<N>` is keyed by the OPENING session's
own numeric id (`r_session_open.rs`, `format!("session_grid_{session_id}")`),
so two DIFFERENT sessions get two DIFFERENT grid graphs even when they share
the same `session_def_id`. Session-open no longer treats a leftover ephemeral
grid cell as an authored declared seat: any current node whose
`place_graph_definition.is_ephemeral_instance` is set (this session's grid or
a foreign leftover — never a `session_grid_*` name sniff) is ignored, the
participant is row-major-seated on the NEW grid, and
`pre_session_place_node_id` falls back to that new grid's `anchor_node_id`
instead of recording the leftover cell. `JoinSession` rejects a joiner already
seated on any ephemeral grid (leave or close first; join is not the reseat
path). Workaround: still don't open a second concurrent session while any of
its participants are seated in an earlier one — either reuse the FIRST
session for the new interaction (add the new actor to its ORIGINAL
participant CSV) or let the first session close first. Two live sessions still
mean two graphs with no `place_edge` between them, so range checks cannot
cross.

**Gotcha — outside an active session, an actor's `action_budget_state` for
a given action class does not refill from world-clock ticks alone** (WE9;
`r_advance_turn.rs` + lazy window reset in `budget_gate.rs`): session turn
advance is the practical refill path for combat-shaped channels. A plain
retry loop of `hero.manipulate(...)` with no `sessionOpen` typically lands
exactly ONE `core/action_class/primary` action — subsequent calls reject
`action_budget_exhausted`; `advanceScene`/`manualTick` advance the WORLD
clock, not a session's turn. Beats needing more than one attack against the
same target should wrap the fight in a `combat_grid` session and drive
`hero.advanceTurn(sessionId)` between attacks (WE6/WE7/CC5 precedent).
(Some `turn_start`/`turn_end` channels also support lazy sessionless window
reset — do not treat "only `r_advance_turn` ever deletes a budget row" as a
universal kernel law without re-checking `budget_gate.rs`.)

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
