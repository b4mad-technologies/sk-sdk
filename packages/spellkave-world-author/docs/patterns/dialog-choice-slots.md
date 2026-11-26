# NPC dialog choice slots

## Name

`dialog-choice-slots` — NPC dialog choice slots (numbered Answer 1..N palette)

## Problem

I need an NPC conversation with a small fixed set of answers (a menu, a quest accept/decline, a wizard step) without free text silently committing world state and without one affordance per option.

## Forces

- Free text **proposes**, it never commits (ADR-0096 D-7): "I choose
  Ranger" must not draft Ranger. **Shipped exception:** character creation
  turns an *exact* spoken label of the open closed menu ("Ranger") and the
  words "confirm"/"discard" into a pick
  (`packages/spellkave-adventure-runtime/src/dm/creation/draft-state.ts:207-240,300-312`).
  Whether that is parse-to-commit under D-7 is an open decision
  (`sk-jay0.1.48`); do not copy it into new dialogs until it is settled.
- One affordance per class/species/quest answer explodes row counts and
  puts content in the palette that the NPC should be speaking.
- The NPC, not the player, decides how many answers are open right now.
- A slot fired without any utterance must succeed; an optional comment
  should still be heard as speech.
- Talking NPCs must not need author access to run a conversation.

## Solution

One dialog model for every conversation, composed from a **small fixed
palette** the NPC provides:

| Piece | Shape | Role |
|---|---|---|
| Talker tag | `srd.dm_npc.talker` (defined by the `dm` bundle) on the NPC's placement | composes who offers answers |
| Niche | `provider = "entity"`, `target.has_niche('<talker tag>')` | answers are NPC-provided affordances |
| Open-count resource | int `0..N` on the NPC, initial 0 | how many answers are open |
| Answer k | `communicate` affordance gated `target.stat('<open>') >= k` | generic label `Answer k`; NPC speaks the option text |
| Ask-menu N | ordinary self act carrying question and exactly N dispatch labels | inscribes the question and opens its occurrence in one frame |
| Palette maintenance | self-only state setters, granted by the talker tag | closes/resets the palette and selects authored fixed dialogs |

Firing a slot inscribes one speech trace whose payload carries the slot's
`action_id`, the gate-admitted `occurrence_id` when bound, and the optional
comment as `text`. An authored `ui.response-slot=k` action tag identifies the
slot for clients without parsing labels or ids. Presentation resolves words
from the visible answered occurrence; missing or legacy history stays neutral.
The NPC brain decides on
the **acted id**; spoken words are context, except for the creation
exception above. Talk state (which step, what was drafted) lives in the
NPC's process memory — there are no `dialog/last-choice` or `dialog/step`
world rows (character creation rebuilds its draft from the speech history
after a restart; see [`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md)).

The same palette serves a **wizard** (draft in memory, a one-slot Confirm
question and a Discard handle — see
[`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md)) and **simple
talk** (a slot *is* the answer).

## TOML example

The generated DM palette provides fixed Answer actions. The following
fields show the slot and its speech write; its occurrence predicate must
also name the authored prompt that admits that response:

```toml
[[action_definitions]]
action_id = "dm/dialog/choice/1"
bundle_id = "dm"
description = "Numbered dialog answer 1. The NPC speaks the option text; this label stays generic."
display_name = "Answer 1"
non_steering = true
on_success = "dm/dialog/choice/1/success"
required_capability = "dm/action/dialog/choose"
resolution_mode = "Deterministic"

[[action_definition_tag]]
action_id = "dm/dialog/choice/1"
bundle_id = "dm"
source = "manifest"
tag = "ui.response-slot=1"

[[affordance_templates]]
bundle_id = "dm"
capability_id = "dm/action/dialog/choose"
display_name = "Answer 1"
niche_id = "dm/niche/dialog"
outcome_template_id = "dm/dialog/choice/1/outcome"
predicate_source = "target.stat('dm/dialog/open') >= 1"
template_id = "dm/dialog/choice/1/affordance"

[[consequence_frame_writes]]
ordinal = 0
template_id = "dm/dialog/choice/1/success"

[consequence_frame_writes.frame_write.Inscribe]
carry_addressee = true
carry_dispatch_text = true
carry_occurrence = true
kind = "srd/speech"
location_kind = "binding"
location_ref = "ActorSpatialRef"
payload_json = '{"text":"","action_id":"dm/dialog/choice/1"}'
```

## Proof

- `packages/spellkave-srd-cc/src/test/offline/dm-dialog-slots.test.ts`
- `packages/spellkave-adventure-elven-mini/tests/offline/mira-talk.test.ts` (simple
  talk cycle: greet → open=3 → choice/2 → send-off → open=0)
- `packages/spellkave-srd-cc/src/test/live-self-seeding/player/dm-creation/creation-flow.test.ts`
  (candidate sees `dm/dialog/choice/k` after the DM's first cycle)

## Related

[`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md),
[`quest-composition`](./quest-composition.md) (accept/decline slot as the
quest giver), [`directed-speech-anchor`](./directed-speech-anchor.md) (the
speech trace; note the DM slot carries the addressee but anchors at the
speaker, `ActorSpatialRef` — `srd-cc fixtures/dm/manifest.toml:2364-2368`), [`advancement-choice`](./advancement-choice.md)
(the menu members a wizard step lists).

## Known misuse / anti-pattern

- Matching the player's sentence against option labels as the save path.
- One affordance per class / species / background / quest.
- Rewriting generic action display names for each conversation; occurrence-bound
  question/option presentation supplies the visible words instead.
- Per-NPC hardcoded slot lists in TypeScript — composition is the talker
  tag plus DSL gates on the NPC's own open-count.
- Granting a talking NPC author access just to run a menu.

## SRD features that use this

- Aldwin's character-creation wizard and level-up dialogue; Mira's bar talk;
  every elven-mini quest giver's accept/decline slot. Ids, `.mdsl` dialog
  files and acceptance list:
  `npc-dialog-choice-slots.md` (`@spellkave/srd-cc` docs, not in this repository).
