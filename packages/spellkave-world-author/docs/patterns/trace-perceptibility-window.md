# Trace perceptibility window (event vs standing mark)

## Name

`trace-perceptibility-window` — Declare event-or-mark on the trace KIND

## Problem

I need a perceivable thing that is either an event (heard only as it happens — speech) or a standing mark (a slime trail, a scorch — findable whenever someone walks in), or something in between that fades.

## Forces

- A trace is perceived at two moments: when inscribed (everyone
  co-located) and on ARRIVAL, when a body later walks onto its node.
- A tick is as long as the operator says (300 s by default): a whole
  scene plus several arrivals fits inside one, so "this tick" is not
  "this instant".
- Deleting a trace reaches backwards: the player read path resolves each
  remembered trace through the `trace` table, so deletion silently
  un-hears a listener who had already heard.
- An elevated/DM caller must still be able to read the full history of the
  nodes it watches.

## Solution

Set `trace_kind_definitions.perceptible_for_ticks` — it governs ONLY the
arrival moment, never the inscription moment, and never the row's life:

| Value | Meaning | Example |
|---|---|---|
| *omitted* | standing **mark** — findable whenever you walk in | a slime trail |
| `0` | **event** — perceived only as it happens | speech |
| `n` | lingers, then fades | smoke, a scent |

The bound is exclusive: `n` admits arrivals through `inscribed_at + n - 1`,
so `0` admits nothing on arrival at all, including on the utterance's own
tick. The row survives either way; memories formed stay formed. Do **not**
use `expires_at_tick` to get this effect.

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/playing-the-game/speech.toml`
(event) and `packages/spellkave-adventure-elven-mini/fixtures/adventure/story/traces.toml`
(standing mark):

```toml
[[trace_kind_definitions]]
bundle_id = "srd"
kind_id = "srd/speech"
location_kinds = "place_node"
perceptible_for_ticks = 0
schema_json = '{"text":"string","addressee":"integer?"}'

[[trace_kind_definitions]]
bundle_id = "elven_mini"
description = "A glistening trail of translucent slime, still faintly wet — something crawled through here."
kind_id = "elven_mini/adventure/trace/slime_trail"
location_kinds = "place_node"
schema_json = "{}"
# perceptible_for_ticks omitted → standing mark
```

## Worked example: a KERNEL-emitted kind (`core/departure`)

A trace kind is content even when the KERNEL writes its rows. When a body
walks out of a place node the kernel inscribes `core/departure` at the node it
left (bead sk-jay0.1.23.35.4), and this window is the whole reason a companion
one room behind can still follow: the departing body's own room-mates perceive
it as it happens, and anyone who arrives within the authored window finds the
trail still fresh.

```toml
[[trace_kind_definitions]]
bundle_id = "core"
kind_id = "core/departure"
location_kinds = "place_node"
description = "Someone left this place through an exit, and the way they went is still readable here."
schema_json = '{"mover":"integer","via_place_edge_id":"string","exit_label":"string"}'
perceptible_for_ticks = 6
```

Copied from
`packages/spellkave-mechanics/fixtures/core/base/long-running-actions.toml`.
Read the number as fiction: six ticks is a fresh trail, not a ledger. Author it
shorter and a follower two rooms behind loses the scent; author it much longer
and a room remembers every passer-by for an hour.

Two rules this example shows that the table above does not:

- The row outlives the window on purpose, but it is not permanent: the
  kernel sets `expires_at = now + 10 × window` (60 ticks for the authored 6;
  fallback 60) (the world API).
  The window governs arrival; the ROW's life is a separate decision, and
  deleting the row early would un-perceive someone who already holds the
  memory.
- The payload names the EXIT taken, never the destination node. A late arrival
  reads which way someone went and resolves that exit against the exits it can
  see itself — a footprint must not teach a room nobody has entered.

## Proof

- `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/speech.ts`
  (walk out / speak / walk back in pins the arrival rule)
- Demo: `openspec/specs/world-knowledge-and-perception/demos/sk-n16-speech-anchor-and-temporal-admission.md`
- the world API (the kernel-emitted
  example above: its seam-B window tests use the same number 6, hard-coded
  in the test, and assert the 10× lifetime)

## Related

[`directed-speech-anchor`](./directed-speech-anchor.md),
[`lingering-hazard-zones`](../lingering-hazard-zones.md) § "Traces that
fade on their own" (the decay-deletes warning in substrate terms),
[`lingering-hazard-zone`](./lingering-hazard-zone.md).

## Known misuse / anti-pattern

- Decaying a trace (`expires_at_tick`) to make it stop being heard.
- Expecting `perceptible_for_ticks = 0` speech to be heard by a body that
  arrives later in the same tick.
- Modelling a standing mark as an event and wondering why explorers never
  find it.

## SRD features

- `srd/speech` (event), the elven-mini slime trail (mark), utility spell
  cast marks (mending / prestidigitation / alarm — srd-cc L12d `trace_cast`). Residue and the
  full lifetime note:
  `speech-and-traces.md` (`@spellkave/srd-cc` docs, not in this repository).
