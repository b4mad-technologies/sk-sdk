# Ask whether an actor may act

`sk can-i` asks the world's admission probe. It does not roll the action's
resolution, apply a consequence, or change the world. The answer is true for
one instant: turn, position, and resources can change before the act.

```bash
sk can-i core/cast_mark --as core/hero --target core/mark
sk can-i core/cast_mark --as core/bystander --target core/mark --expect refused
```

`spellkave_can_i` is the same question. Proof: `openspec/specs/world-authoring-cli/spec.md`.

## Supply the same participant arguments

The probe uses the literal `--args` object (`args` in `spellkave_can_i`).
Include the intended selected items and either `expected_participants` or
`participant_context` when the selected template declares participants.
Supply one expectation form at a time. The world checks it against the
current body and equipment; a missing or stale expectation is refused at
`declared_participants` with `stale_participant_context`.

Read the intended player's `manipulation_context` through that player's own
profile. Its admitted `participants` rows provide the action's context token
and complete bindings. Pass that fresh token or those bindings explicitly to
the probe. The author caller still needs the probe authority described below;
reading a player's choices confers no control over another body.

PLAYER manipulation tools can compose the sole disclosed participant context
when the request omits one. `can-i` does not perform that composition. Compare
the same body, target, selected items and explicit participant arguments at
the same world state. Omitting participant arguments from both requests can
produce different wire arguments through these two paths.

The refusal's optional `note` explains this requirement. Verdict fields,
expectations and exit codes retain their existing meaning; the note never
selects a context or grants authority. The same-input investigation in
`ledger/designs/can-i-participant-context.md` summarizes explicit-binding and
context-token admission, independently bound player dispatch and rollback
checks over 203 schema tables.

## What the answer means

`admitted` means every check before resolution passed. It does not mean the
act will succeed. The resolution, the reaction window, the checks at commit,
and the consequence are listed as not run. Proof:
`openspec/specs/world-affordance-resolution/spec.md`.

`refused` names the check and the `failure_kind`. `capability_not_held`
means the body lacks the selected action template's capability (including
capabilities carried by items). Proof: the requirement "Selection admits
only templates whose capability the actor holds" in
`openspec/specs/world-affordance-resolution/spec.md`. It does not carry spent
amounts, positions, or another actor's id. `errored` means the act path
itself failed; the label is named and the error text is not.

`disclosed` is whether the factored context offers the action to that body.
It is reported beside `admitted`. When they differ, the result names both
and calls neither a fault. Disclosure and eligibility stay separate
(ADR-0140 D-4, ADR-0141 D-2).

A template predicate that rolls a die can answer differently on a repeat.
The verdict marks that. For how a roll resolves, use `sk eval`.

## Checks

The probe runs the act path's own checks, in that path's order, and stops
before resolution. The two checks of the sender's control are not run: the
gate is `frontier.apply_manifest` on the caller's bound actor, not a seat
on the body. A body that no actor inhabits is refused at the inhabit check.
Proof: ADR-0148 D-4 and `openspec/specs/world-affordance-resolution/spec.md`.

Human output (`--format human`) is one line for the answer, then one line
per check (`label result`). A table was the other option in the design; one
line per check stays readable in a terminal and is what the snapshot test
pins.

## Authority

The world answers a caller whose bound actor holds `frontier.apply_manifest`.
A caller without it gets no verdict. ADR-0094 D-2 is one genesis grant, not
a seat class. ADR-0103 D-1 grants nothing. The shipped PLAYER tools, DM
tools, and `DmSeatPort` do not call the probe. Proof: ADR-0148 D-4.

## Closed door

`--expect admitted` or `--expect refused` exits 0 when the answer matches
and 2 when it does not, naming both. An unknown authored key and a caller
without authority also exit 2. An unknown action and a body no actor
inhabits are answers of the world (`refused`) and exit 0. No reachable
world exits 1 and names `sk dev up` or `sk config use-context`.
