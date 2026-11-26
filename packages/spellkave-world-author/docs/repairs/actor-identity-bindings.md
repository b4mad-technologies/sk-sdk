# Actor Identity Bindings

`[[actor_identities]]` binds a SpacetimeDB login identity to an authored actor.
Use a literal identity string when the principal is known ahead of time. Use
`identity = "$sender"` when a fixture should bind the actor to the identity that
applies the manifest; the server resolves it before the scheduled manifest
drain commits rows.

**Driving and steering use different authority.** A primary or summoner
binding supplies direct control; `connectedActorId` and a capability row do
not create that binding. The four Layer-2 verbs and the current actor's
SessionMove/compound-intent entries also admit an owned presence carrying
`frontier.impersonate` over both the place and existing body. A presence body
cannot be steered. For any Person-bound target, its primary owner first offers
control to the exact DM login; a `co-pilot` row grants consent without direct
control, sight or character selection. See [DM control](../dm-oversight.md#steering-and-held-npc-control).

**Provenance is separate from connection lifetime.** New runtime claims are
`Person` regardless of issuer and require a free body tagged
`srd.player_character`; otherwise they refuse `claim_not_offered`. An
idempotent re-claim preserves an existing Service row. Manifest bindings
default to `provenance = "service"`; author human logins explicitly as
`provenance = "person"`. Operator binding defaults to Person. A merge can
promote Service to Person but cannot demote Person (ADR-0146 D-5). Offline
`MF-VAL-376` rejects other values; `MF-VAL-377` rejects authored co-pilots on
any Person row. A manifest co-pilot needs a durable authored Service primary;
live commit checks ownership when that primary is absent from the document.
An authored co-pilot cannot replace an existing direct identity row.

A host-signed runtime claim remains connection-scoped; a trusted IdP claim,
manifest/operator binding, copied binding or spawn summoner has no connection
attached. `r_assign_driver` also writes a durable Service primary. Passive
disconnect removes connection-scoped claims and cascades their co-pilots;
primary release/revoke/reassign also removes consent. Removing issuer trust
stops new durable claims and does not release existing ones. Explicit
`r_release_actor` releases the caller's ordinary bindings; Service mutations
require the generation observed with the decision and refuse during a hold.
The lifetime rules are proved by `actor::claim`/`actor::release` tests and
`client/tests/claim_admission.rs`; they do not depend on provenance alone.

`spellkave actor inspect <actor_id>` and identity inspection include provenance and
`assigned_by`. `spellkave actor control list|transitions|work|audit|events`
uses authorized private observations. The doctor reports
`co_pilot_without_primary`, `person_binding_on_unoffered_body` (durable Person
primary without an offer), `orphaned_drive_assignment`, and as a warning
`person_on_service_only_audience_body` (a person identity controls a body that
holds a [service-only audience](../metadata-attachments.md#audience)
capability, and reads nothing through it); it diagnoses and
does not revoke rows. Whole-world identity checks report unverified when the
caller cannot read the needed private rows. Tests in
`client/src/doctor/actor_control_tests.rs` distinguish those failures from a
healthy empty result.

**`actor.has_item(...)` works inside an action predicate (`r_manipulate`) —
since sk-vjh.7.** `manipulation_facts`
(the world API)
builds the DSL `items` fact pool from the items the acting body directly
carries (`entity_containment.container_id == body`, equipped or loose), so a
possession gate on a self-eligible or targeted action reads true at offer
(materialiser) and act time. Proof anchor: the unit test
`manipulation_facts_expose_carried_items_to_has_item` in that file. Before
sk-vjh.7 the pool was empty outside `r_move`'s edge traversal, the clause was
dead weight in any `&&` chain, and a `dead-manipulate-has-item` lint rule
warned about it; both the gotcha and the rule are retired — see
[`has-item-dead-in-manipulate`](./has-item-dead-in-manipulate.md).

**Gotcha — a self-eligible REACTION needs a `ModifyResource` write
(narrowed 2026-08-01, PR #2079).** The validator (`MF-VAL-263`) rejects a
`self_eligible = true` action_definition that carries reaction wiring
(`reaction_eligibility`/`reaction_trigger`) whose `on_success` consequence
has no `ModifyResource` frame_write budget resource — the depleting budget
is the only terminator against an unbounded free self-triggered reaction
loop (ADR-0050). Add a second frame_write bumping a dedicated resource by 1
(Klarg's `klarg_wriggle_free` → `klarg_allies_down`/`klarg_fled` is the
canonical precedent). A PLAIN self-targeted action with no reaction wiring
is exempt since PR #2079 — a genuinely free self action (`ApplyStatus`-only,
the SRD Dropping Prone shape) now validates; see
[`self-eligible-reaction-budget.md`](self-eligible-reaction-budget.md).

**Gotcha — gate an ALREADY-EXISTING edge (including a Foundry-generated one)
by adding a SECOND `place_edge_affordance` row on the same `edge_key`, not a
new node.** RH1/RH6 established the AND-chain (two rows sharing one
`mode_id` on one `edge_key` both must pass — every row this gotcha touches
carries the implicit default `mode_id = ""`, so plain "two rows on one
`edge_key`" is the same claim here; a row under a *different* `mode_id`
would instead be an alternative the edge OR's against, ADR-0101
movement-defaults-modes-terrain-cost); TT3 confirms it works identically on
a `#1696`-imported generated edge, not just a hand-authored bundle edge — no
need to touch the generated scene file or invent an intermediate node.
Author a custom
`affordance_template` (`niche_id = "core/passable_portal"`,
`capability_id = "core/walk"`, predicate reading your own resource flag,
`outcome_template_id = "core/move_outcome"`), then a `[[place_edge_affordance]]`
row pointing at the target direction's existing `edge_key` only — leave the
reverse-direction `edge_key` untouched so exiting never re-triggers the gate
(P6/RH1 precedent).

**Gotcha — NPC monster defs lack `core/walk`.** An entity built from an
`srd/monster/*` def cannot traverse place edges until you explicitly grant
`[[actor_capabilities]] capability_id = "core/walk"` — without it, every
`r_move` on that actor rejects `predicate_no_longer_holds` on the traversal
affordance. This is affordance discipline (walk-capable actors prove
walkability), not a graph bug.

**Gotcha — attacking a target claim-locks it, but a declared `self_only` action
on that SAME entity bypasses the target claim.** `r_manipulate` defaults to
`SteeringClaimDecision::ClaimRequired` for any manipulate whose consequence
isn't classified as `NonSteering` (`r_apply_consequence/steering_claim.rs`);
`srd/attack/melee`'s generic outcome (HP `ModifyResource` + a conditional
death `ApplyStatus`) does NOT classify as non-steering, so every hero attack
against an NPC acquires/renews a `core/condition/controlled` claim-lock on
it ([claims][claims], Item 20; TTL 10 ticks, renewed on each hit). No prior
combat beat needed the SAME entity to act on itself moments later. Since #2411,
an action authored with `self_only = true` skips target-claim acquisition, so
the carrier can use a self-heal or another genuinely self-only verb while the
attacker's claim remains intact. `self_eligible` alone is not this assertion:
if another actor may also target the verb, its steering-shaped attempts still
obey normal claim contention. Do not release an attacker's claim merely to let
the target use an authored `self_only` action; a rejection there is a runtime
regression.

**Gotcha — a carried item's manipulate target can fail with "no reachable
spatial location", not just `out_of_range`.** A hand-built `entity:<id>` ref
to an item the actor has picked up resolves through `entity_place_node_id`,
which reads only `entity_location` — a carried item has no such row left
(replaced by `entity_containment`) — and rejects with
`"r_manipulate: target entity <id> has no reachable spatial location"`
(the world API) — a plain
resolution failure, not the range check that produces `out_of_range`.
Don't assume one error string is exhaustive when grepping for this
gotcha. Read the real `target_ref` from the caller-scoped manipulation
context (`spellkave manipulation-context targets <perceiver_entity_id>`, or
`readManipulationContext(db, perceiverEntityId).targets` in
`@spellkave/sdk`) instead of hand-rolling `entity:<id>` for any target that
might already be carried; see
[`manipulate-ref-niche-attachment`](./manipulate-ref-niche-attachment.md).

**Gotcha — `srd/niche/strikeable_target` is per-node opt-in, not global.**
Authoring a `capability_id`-gated affordance on that niche (a monster
attack, a breath weapon) is not enough by itself: without an explicit
`[[spatial_niche_attachments]] niche_id = "srd/niche/strikeable_target"`
row at the node, every attempt rejects `precondition_failed
(attachment_presence): no spatial_niche_attachment for niche
'srd/niche/strikeable_target' at 'place_node:<id>'`. Every combat node
carries this row today (P5/cragmaw_castle/wave_echo_cave/RH2) — a NEW
combat node needs its own (TT4's `old_tower_interior`).

**Gotcha — a `strikeable_target` affordance can silently pick the WRONG
co-located-elsewhere target.** The niche materializes one affordance
instance per eligible target within `range_m` — if `range_m` is generous
(30m+) it can reach a strikeable actor at an ENTIRELY DIFFERENT node
whose real-world Foundry pixel coordinates happen to sit nearby (TT4 hit
this: a `range_m = 30.0` breath weapon at `old_tower_interior` selected a
TT1 zombie sitting at `thundertree/brown_horse`). A "first match" target
lookup (the retired `readAffordances(...).find(a => a.action_id ===
actionId)` shape, fine for a capability-only self-affordance, e.g. R1's
Rotting Gaze) is NOT safe here — construct the target ref directly from the
KNOWN target's resolved entity id (`entity:${targetEntityId}`, TT3's
`fightUntilDown` precedent) instead of trusting list ordering, and keep `range_m` tight
(5-20 ft) unless the mechanic genuinely needs reach.

**Gotcha — `recharges_on` alone does not gate re-use; it also needs
`spends_channel`** (the field formerly named `consumes_action_class`;
the world API). An
`affordance_templates` row with `recharges_on = "turn_start"` but an empty
`spends_channel` lets every subsequent attempt succeed immediately — the
budget gate returns early on an empty channel before it ever writes a
recharge row, so no `action_recharging` rejection fires
(the world API,
`check`/`consume`). Pair `recharges_on` with a real channel (e.g.
`spends_channel = "srd/economy_channel/primary"` in srd-cc) on the SAME
row; the two fields together are the load-bearing pair, not either alone.

**Gotcha — item presence at a node is `entity_location`, not
`actors_here`.** `readLocationSnapshot(...).actors_here` lists ACTORS only
(actor_spatial_locations); a pickupable item (a chest, a dropped weapon)
never appears there even when correctly placed via `place_node_id` on its
`[[entities]]` row. Check item presence with `entity_location` directly
(`entityLocationNodeId(db, itemEntityId) === nodeId`, TT3's pattern) —
`actors_here` will read as "missing" and mislead you into re-authoring
placement that was already correct.

**Gotcha — a new `base/*.toml` file is invisible until it's in
`manifest.toml`'s `[[include]]` list.** Scaffolding
`world-fixtures/phandelver/base/<beat>.toml` does not wire it into the
bundle; `just seed` silently seeds everything ELSE and the new content
never applies (no error — the file is just never read). Add an
`[[include]] path = "base/<beat>.toml"` entry in the right dependency
position (after any file whose place_graph/resource/entity_def it reuses)
in the SAME commit as the content.

**Gotcha — the per-node opt-in above (`srd/niche/strikeable_target`) applies
to EVERY `capability:<your_capability_id>`-keyed niche, not just the SRD
combat one.** A custom self-eligible or targeted capability (a flee act, a
warn-run, a posture-read) needs its own `[[spatial_niche_attachments]]
niche_id = "capability:<your_capability_id>"` row at the node where it
should be offered, exactly like the SRD niche — CC2 hit this THREE separate
times (a flee capability, a warn-run capability, and again for an NPC's
ranged-attack TARGET standing at a node that had never opted into
`strikeable_target`) before generalizing the rule. Missing this rejects
`precondition_failed (attachment_presence)`, not a capability/predicate
error, so double-check attachments before debugging the predicate.

**Gotcha — normal birth state belongs on the definition; proof-only state
belongs on the proof instance.** The Phandelver hero's sourced HP 13 is an
`entity_definition_initial_state`, so every ordinary instance starts healthy.
I2 needs a visible healing-potion delta, so its assigned island authors an
explicit per-instance `object_state` HP 3 override. Do not change a shared
definition baseline to satisfy one scenario, and do not reset it procedurally
after seed: author the exceptional instance state in that scenario's manifest.

**Gotcha — a GROUNDED item's own niche (a bespoke pickup gate, e.g. a
niche predicate on `target.has_niche("your.item.tag")`) needs an explicit
`[[spatial_niche_attachments]]` row at the hosting node too, exactly like
the capability-keyed gotcha above — it is NOT automatic just because the
item entity's `place_node_id` is set there.** WE8 hit this live: a
`take_relic` affordance scoped to a custom guarded-item niche rejected with
`precondition_failed (attachment_presence): no spatial_niche_attachment for
niche '...' at 'place_node:...'` until the attachment row was added,
identical in shape to `core/pickup_cursed_chest`'s own wiring
(`core/base/affordances.toml`) which DOES carry one. Contrast: a niche
scoped to an item the actor already CARRIES/WIELDS (RH5's `equip_talon`,
its own `phandelver/item/talon` niche) needs no spatial attachment at
all — the rule is about NODE-SCOPED discovery of a grounded item, not
about item niches in general.

**Gotcha — `cost_time_ms > 5_000` (`T_THRESHOLD_MS`,
the world API) promotes a flat action into
the authored `core/long_running_action` session.** Promotion now works
end-to-end, and the validator warns at the strict threshold so authors can
see the resolved session target before apply. Use a long cost when the action
is deliberately meant to occupy its actor, advance in fiction time, and
complete through a session. For flavor-only duration on an otherwise ordinary
flat action, keep `cost_time_ms` at flat-action scale (hundreds to low
thousands of ms) and narrate the longer duration in
`display_name`/description text instead.

**Playable seats come from the authored tag `srd.player_character`, not from
a kind or a Rust enum (sk-pka5.4, ADR-0102 D-2).** The public `seat` table
lists every actor whose current body carries that tag (on the entity or its
definition): `actor_id`, `entity_id`, `name`, `embodied`, `claimed` — never the
occupant identity. It is re-materialised on manifest commit, claim, release,
bind, body swap and despawn (`sync_seat`). A trusted-IdP claim keeps
`claimed = true` across disconnect; a host-signed claim does not. To offer an actor to players, tag its body (or
its `entity_definition_tag`) with `srd.player_character`; NPCs without the tag
never appear and a new runtime claim refuses `claim_not_offered`. Hosting such
an NPC needs publisher provisioning or the separately scoped drive writer; the
playable tag also grants SRD capabilities, so do not add it merely to bind a host. Read it with `spellkave seat list` (JSONL `seat` lines) or
`readSeats` in `@spellkave/sdk`; the doctor check `seat_catalog_readable`
proves the view is reachable. A seeded Kavemouth currently offers only the
Creation Candidate — the pregen Renn body in `reference/` is not seeded.

[claims]: ../data-model-concepts/claims.md

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
