# Directed speech anchor (anchor says WHERE, payload says TO WHOM)

## Name

`directed-speech-anchor` — Directed speech anchored at the addressee's place

## Problem

I need an NPC or player to say something to someone — broadcast to the room or directed at one body — so the right bodies perceive it and it does not follow anyone around.

## Forces

- An `Inscribe` anchor answers one question only: *where* is this thing.
  Who it was aimed at, what was said, who left it — payload.
- An entity anchor makes the trace travel with that entity: utterances
  accumulate on a person and are handed to whoever later stands next to
  them (a hero once perceived a stranger's entire character-creation
  exchange this way). It buys nothing: an entity anchor admits by
  co-location like any other.
- There is no recipient column, on purpose (ADR-0040 / ADR-0095): the
  addressee routes nothing.
- `carry_addressee` on a dispatch with no entity target fails at binding
  validation — deliberate, so readers never probe for a "usually there"
  key.
- Speech is not a property of the room: attaching a speak niche to places
  leaves every unattached place silent.

## Solution

- **Who may speak** is an actor-carried capability from a vocal-modality
  tag ([`identity-tag-capability-grant`](./identity-tag-capability-grant.md));
  **who may be addressed** is the entity-provided communicable niche from
  the creature tag; a corpse is excluded by `target.status('<dead>') == false`
  on the affordance. No `spatial_niche_attachments` for either.
- **Broadcast / self-shaped** speech anchors at the speaker's place
  (`ActorSpatialRef`).
- **Directed** speech anchors at the addressee's **place**
  (`TargetSpatialRef`) so ordinary co-location admission delivers it
  there, and names the addressee in the payload (`carry_addressee`).
  Never `TargetEntityRef`. One shipped exception: the DM dialog answer
  slots (`dm/dialog/choice/N`) carry the addressee but anchor at the
  speaker (`ActorSpatialRef`, `srd-cc fixtures/dm/manifest.toml:2364-2368`),
  which works because the talker and the answering hero share a place.
- Declare the payload contract on the trace kind (`schema_json`, flat
  key → type, `?` for optional); a required addressee is guaranteed by
  `carry_addressee`, not by the schema. `carry_dispatch_text` copies the
  dispatch's `dispatch_text` into `text`
  (the world API); since
  `srd/speech` requires `text`, a directed speak with no utterance fails the
  schema.

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/playing-the-game/speech.toml`
(`srd/speak-to`, directed):

```toml
[[consequence_frame_writes]]
ordinal = 0
template_id = "srd/speak-to/success"

[consequence_frame_writes.frame_write.Inscribe]
carry_addressee = true
carry_dispatch_text = true
kind = "srd/speech"
location_kind = "binding"
location_ref = "TargetSpatialRef"     # addressee's current place, never TargetEntityRef
payload_json = "{}"                   # kernel fills text (from the dispatch's dispatch_text) + addressee

# trace kind contract:
# [[trace_kind_definitions]] kind_id = "srd/speech"
# schema_json = '{"text":"string","addressee":"integer?"}'
# perceptible_for_ticks = 0   (an event — see trace-perceptibility-window)
```

## Proof

- `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/speech.ts`
  (asserts anchor and payload separately; walks a body out / speaks /
  walks it back in)
- `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/telepathy.ts`
- Demo: `openspec/specs/world-knowledge-and-perception/demos/sk-n16-speech-anchor-and-temporal-admission.md`

## Related

[`trace-perceptibility-window`](./trace-perceptibility-window.md) (event
vs mark), [`party-extent-grant`](./party-extent-grant.md) (addressing
across graphs), [`dialog-choice-slots`](./dialog-choice-slots.md) (slots
inscribe this trace), [`communicate-with-actor`](../examples/communicate-with-actor.md),
[`interaction-dsl-and-world-authoring`](../interaction-dsl-and-world-authoring.md)
§ Trace Inscription.

## Known misuse / anti-pattern

- Anchoring a spoken line to the person spoken to (`TargetEntityRef`).
- Authoring place attachments for speak verbs.
- Treating `payload.addressee` as routing — anyone at the anchor perceives
  the trace.
- Letting the creature tag or a language tag grant speech.

## SRD features that use this

- `srd/speak-aloud`, `srd/speak-to-room` (speaker-anchored),
  `srd/speak-to`, `srd/communicate/telepathy` (addressee-anchored), DM
  dialogue lines (speaker-anchored with an addressee, see above). Chains, ids and the extent residue:
  [`speech-and-traces.md`](../../../spellkave-srd-cc/docs/speech-and-traces.md).
