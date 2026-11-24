# Observe, attempt and recover through offered gameplay tools

## Orient

Begin with the offered `spellkave_orient` tool. A connected gameplay context
belongs to the selected actor; reading public docs does not create or change that
context. A caller without an actor can still read this guide through an adapter
that offers `spellkave_docs`, but gameplay availability remains a separate check.

## Choose an attempt

`spellkave_manipulation_context` supplies independent action and target facts.
Its default answer is a bounded summary: open prompts, targets, participants,
the most relevant action rows, and `more_action_ids` naming every other
action. Pass `action_ids` for the syntax rows of named actions;
`detail: "full"` returns the whole registry (large, for programmatic readers).
Use its actual typed target and action with `spellkave_manipulate`; those facts
are not a promise that the attempt will be eligible. For sensing, use
`spellkave_sense_context` and a direct `spellkave_sense` attempt. Communication
uses `spellkave_communicate` with the current authored speech-act and target.
Inspect offered schemas for required arguments rather than inventing identifiers.

An installed CLI exposes these registry tools through its command aliases and
`sk help <command>`. Hosted clients invoke the offered tool names directly and
need no shell. The CLI-specific loop is `cli/workflows`.

## Recover and observe

Keep revisions, opaque handles and cursors within the actor/world context that
produced them. If a refusal or stale handle changes the available choices, obtain
fresh context and choose a currently disclosed attempt. Do not substitute another
principal, publisher credentials or a guessed hidden target.

Read returned consequences and world events before deciding the next step.
After an outcome that has not arrived yet, make a suitable offered observation
call; an asynchronous world may have changed since the previous reply. A missing
turn-based session does not by itself prevent exploration.

A move longer than your reach becomes a journey of several ticks. Pass
`wait_for_arrival_ms` to `spellkave_move` to wait for the arrival in the same
call. If the journey is still under way when the call returns, read
`spellkave_scene` with `wait_for_arrival_ms`: it waits for the journey to end
and answers with the scene as it is then. Re-reading the scene or the session
status in a loop costs calls and learns nothing sooner.

## DM and elevated-player limits

A DM task lens does not grant capabilities. Role presence, NPC takeover, time
control, scene setup and private hint delivery require their owning contracts and
host ports. This guide describes the established observation/attempt loop, not a
verified execution of those pending workflows. Use `hosted-authoring-guidance`
for their currently documented hosted prerequisites.

## Proof boundary

This is package-owned workflow guidance derived from the canonical PLAYER
contracts. Source/schema checks prove tool names and guide distribution; they do
not prove a particular live actor's admission or a hosted role workflow. Public
docs neither read private world state nor execute the described attempts.

Response syntax may carry an optional `response_slot` in manipulation context,
from the public authored `ui.response-slot=<N>` action tag. This identifies
syntax independently of target admission. Trace details and `speech_heard`
events may carry optional `response` history with `action_id`, `slot`,
`occurrence_id` and a caller-visible `label`. A label resolves only from that
answered occurrence's presentation; a reused action or a newer prompt is not a
history link. Missing occurrence identity or inaccessible presentation stays a
neutral number. These MCP additions are optional and older clients ignore them.

Prompt presentation may include optional `response_refs`, keyed by exact
response action identity, from the occurrence's captured visible trace. A missing
ref has no description source. Refs are static authored definitions, not predicate
results. Action descriptors use nonempty template description text first, then
the authored action's world-public static description; with neither, they omit
the description. These are presentation facts and never certify admission.
