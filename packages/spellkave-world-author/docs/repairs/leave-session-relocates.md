# `LeaveSession` always relocates the leaver off the tactical grid — it removes a participant from the turn order at the cost of taking the body out of the scene, so it is the wrong tool for a corpse

To keep a body in the scene but stop handing it the turn, author
`turn_eligibility_pred` on the session definition (ADR-0143). Reach for
`LeaveSession` only when the entity is really leaving.

## Skipping a participant: `turn_eligibility_pred`

`r_advance_turn` hands the turn to every `session_participant` in order,
unless the session's `[[session_definitions]]` row authors a Bool
`turn_eligibility_pred`. With one, the advance scans the roster onward from the
outgoing actor. It evaluates the predicate with each candidate as `actor`, and
the first candidate for which it is true gets the turn:

```toml
[[session_definitions]]
session_def_id = "adventure/session/crypt-fight"
bundle_id = "adventure"
turn_rule = "Sequential"
turn_scheduler_id = "srd/turn/initiative"
# Or call a zero-parameter Bool macro, so every combat session shares one rule.
turn_eligibility_pred = "actor.status('srd/condition/dead') == false"
```

The reference use is the srd ruleset's macro `srd/takes-turn` (body
`actor.status('srd/condition/dead') == false`), which every srd combat proof
session names as `turn_eligibility_pred = "macro('srd/takes-turn')"`. It skips
a dead monster and a PC after its third failed death save, but keeps an
Unconscious PC in the rotation so it can make its death save
(`packages/spellkave-srd-cc/docs/death-and-dying.md`; live proof
`packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/takes-turn.test.ts`).

What a skipped participant keeps and loses:

- It **stays a participant**. It is still targetable, lootable and seated on
  the grid, and `participant_tag_group_count(..)` in a `termination_pred`
  still counts it.
- It never becomes the current actor. It gets no `TurnStart`/`TurnEnd`, no
  budget refresh, no recharge, no boundary autonomy job, and no start-of-turn
  hazard.
- **Only its owner-keyed condition expiries fire** as the scan passes its
  slot. A condition the dead caster keyed to its own turn on a *living*
  target still ends on schedule.
- If a ruleset needs a creature's other boundaries (a Paralyzed creature's
  end-of-turn save, a dying character's death save), that creature must stay
  eligible. Name only the state that should skip, for example Dead, not
  Incapacitated.
- Revival is automatic: the predicate reads the live condition, so healing or
  clearing the condition makes the body eligible again at the next advance.

Edge cases:

- If **nobody** is eligible, the advance falls back to the unfiltered rotation
  and logs it. A `termination_pred` should end such a fight first.
- A predicate that errors at run time counts the candidate as eligible and
  logs the error.
- A participant that becomes ineligible **on its own turn** keeps the turn
  until something calls `end_turn`. The kernel never takes a turn away
  mid-turn (ADR-0092 D-1), so a seat or the player still ends it.

The predicate may read only the candidate's own facts: `actor.stat`,
`actor.effective`, `actor.resource_max`/`resource_min`, `actor.status`,
`actor.has_tag` and `actor.has_capability`, composed with literals,
comparisons and boolean logic. Dice, `target.*`, `has_niche`, `has_item`,
`participant_tag_group_count` and `implied_by_count` are refused by
`MF-VAL-334`. `spellkave session-def inspect <id>` shows the predicate a live
world carries.

## `LeaveSession` is leaving, not skipping

`FrameWriteOp::LeaveSession` deletes the `session_participant` row the
rotation walks. Its own contract (BC-8) says so: it does not touch
`current_actor`, and the next advance simply no longer finds the leaver.

It also relocates the leaver to its `pre_session_place_node_id` (BC-4), or to
an authored `destination` if you supply one. That is not a side effect you can
switch off. It is half of what the op is for, and it is why the op exists
(Klarg wriggling free and fleeing the fight). Applied to a body that should
stay in the scene, it removes the body from the scene.

Live-measured (sk-awlo.3, 2026-08-27) by wiring it as a consequence of
`srd/condition/dead`: the mechanism worked exactly as designed. The corpse
left the roster and the turn moved on, proving BC-8 for the first time. The
same run turned three green `combat-arena` cases red, the first of them

```
Error: manipulation context did not disclose `entity:13` as an observed target
```

because the corpse had been relocated to `srd_proof_scene/combat_arena_gate`,
off the grid, where nothing on the grid can target it. A player who wants to
search the body cannot find it, and neither can the loot drop that anchors on
the victim's node. Leaving also drops the body from `termination_pred`
counting.

So reach for `LeaveSession` when the entity really is **leaving**: fleeing,
withdrawing, being carried away. For a participant that should remain present
and targetable, use `turn_eligibility_pred` above.

Two further things that bite when you do use it, both live-confirmed:

- **Gate it, or it takes the trigger down with it.** Condition-hook side
  effects are *not* isolated from the event that fired them.
  `record_event_typed` ends in `resolve_condition_hook_intents_for_event(..)?`,
  which propagates back into `apply_status`. A `LeaveSession` that errors
  (no ambient session, holder not a participant, terminal lifecycle, no restore
  target) aborts the very `ApplyStatus` that triggered the hook. Wire a death
  to it ungated and the first creature to die outside combat simply refuses to
  die. `target.stat('core/session_id') > 0` is the gate; it is absent, never
  zero, for a non-participant, and a hook `detail_filter` reads that absence as
  "this hook does not apply to me".
- **Do not author a literal `destination` just to dodge BC-9.** The default
  restore target is the participant's own `pre_session_place_node_id`, which is
  the correct per-creature answer; a literal node teleports every leaver in the
  world to the same place. Both enrolment paths write that field, so BC-9's
  empty-target error is defensive for anyone actually seated in a session.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
