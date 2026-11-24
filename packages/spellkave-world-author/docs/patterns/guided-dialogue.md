# Guided dialogue (an NPC asks its questions in the order a data tree holds)

## Name

`guided-dialogue` — Steps as data, one machine side per question

## Problem

I need an NPC that leads someone through several questions, where the order
of the questions, which ones are skipped and which ones hang on an earlier
answer are content I can change without touching the NPC's program. A client
should be able to show "answers so far" and "what is still ahead" without
remembering anything itself.

## Forces

- The order of a guided talk is content. Written into the NPC's program it
  gets copied: once to ask, again to step back, again to clear dependents.
- A client that keeps its own list of answers must copy the NPC's rules to
  keep that list right, and loses it in another browser.
- The NPC stays the authority. A client shows what it is sent and offers
  actions; the world decides (ADR-0141, ADR-0073 D-1).
- NPC documents hold no expressions (ADR-0165 D-2). A step's condition is one
  atom about another step of the same guide.
- What a question's options are is the kind's knowledge (a class's skills, a
  merchant's wares), not the guide's.

## Solution

1. **Write the steps as data.** A guide is a list of steps in the NPC's
   document. The DM carries it as `creation.guide`. Each step has:

   | Field | Meaning |
   |---|---|
   | `id`, `title` | Stable id (opaque to every reader) and a short name for the outline. |
   | `source` | A named option source the kind resolves. The DM kind knows `classes`, `backgrounds`, `species`, `class-skills`, `class-choice-groups`, `class-cantrips`, `class-prepared`, `class-kits`, `kit-equipment`, `pending-name`, `standard-array`, `confirm`. |
   | `options`, `pick` | Inline options `{ id, label, description?, ref? }` and how many are picked (`{ min, max }`), for a talk with fixed answers. |
   | `input` | The step is answered by a typed input (the DM kind knows `name`), not by a pick. An open input step asks no question; the NPC waits. |
   | `show_when` | `{ answered = "<step>" }` or `{ unanswered = "<step>" }`. One atom, no nesting. |
   | `depends_on` | Earlier steps this one hangs on. A different answer there drops the answers here. |
   | `reopen` | The step can be asked again with Back. Default true. |
   | `paged` | More options than slots are shown in pages. Default: cut at the slot count. |
   | `announce_remaining` | A step with several picks sends how many are left. |
   | `listed` | The step has its own line in the outline. Default true. |

   A step takes exactly one of `source`, `options`, `input`. A source belongs
   to one step. A step with nothing to ask is skipped.
2. **Let the engine walk it.** `crates/spellkave-npc-host/src/guide.rs` finds
   the open question, the answered ones, the draft before a step, and the
   answers that hang on a changed step. It knows no step and no ruleset. The
   kind supplies where a source's options come from and where answers are
   kept. A document without a guide is refused; no order is built in.
3. **Ask through the palette.** Each question is one ask-menu act
   ([dialog choice slots](./dialog-choice-slots.md)), which opens one
   [prompt occurrence](./prompt-occurrence.md) bound to its speech trace.
4. **Send the machine side with every question.** The same act carries
   `dispatch_context`; the ask-menu write opts in with
   `carry_dispatch_context`, so the object lands on the trace payload as
   `context` and the SDK joins it to the prompt as `presentation.guide`:

   ```json
   {
     "guide": 1,
     "step": "skills",
     "reopened": false,
     "remaining": 2,
     "outline": [
       { "step": "class", "title": "Class", "state": "answered",
         "answers": [{ "label": "Fighter", "ref": "srd/class/fighter" }] },
       { "step": "skills", "title": "Skill", "state": "open",
         "answers": [{ "label": "Athletics", "ref": "srd/skill/athletics" }] },
       { "step": "kit", "title": "Starting kit", "state": "ahead" }
     ]
   }
   ```

   `state` is `answered`, `open` or `ahead`. A step with several questions has
   one entry per question once its questions are known. `remaining` is absent
   on a single pick. `truncated: true` marks an outline the NPC cut to stay
   inside 48 entries and 8 KiB. There is no step number and no total; a
   reader counts the outline.
5. **Read it, do not rebuild it.** A client shows the outline as sent. It
   never branches on a step id, never guesses a step from the question's
   wording, and keeps no answer list of its own. A prompt without
   `presentation.guide` (an older host) still shows its question and labels.

## TOML example

The write that asks a guided question opts into both carriages:

```toml
[consequence_frame_writes.frame_write.Inscribe]
kind = "srd/speech"
location_kind = "binding"
location_ref = "TargetSpatialRef"
payload_json = "{}"
carry_dispatch_text = true
carry_addressee = true
carry_dispatch_options = true
carry_dispatch_context = true
```

The steps themselves live in the NPC's document, not in the manifest. Three
steps of the DM's creation guide:

```json
{ "id": "kit", "title": "Starting kit", "source": "class-kits", "depends_on": ["class"] }
{ "id": "equipment", "title": "Equipment", "source": "kit-equipment",
  "depends_on": ["class", "kit"], "paged": true }
{ "id": "scores", "title": "Ability scores", "source": "standard-array",
  "show_when": { "unanswered": "name" }, "reopen": false }
```

## Proof

- `crates/spellkave-npc-host/src/guide.rs` (inline tests): the walk follows
  the data order, a hidden step is skipped, a paged step leaves a slot for the
  page turn, a changed answer drops what hangs on it, the outline lists the
  draft and the way ahead and is cut at its bound.
- `crates/spellkave-npc-host/src/dm/engine/creation_tests.rs`:
  `native_creation_asks_in_the_order_the_guide_holds` (swapping two steps in
  the data swaps the questions, forward and back),
  `native_creation_drops_dependent_answers_by_the_guide`,
  `native_creation_machine_side_lists_the_draft_and_the_way_ahead`,
  `native_creation_refuses_a_duty_document_without_a_guide`.
- `crates/spellkave-validate/src/guide.rs` (inline tests): every shape rule
  refuses, `show_when` cannot nest.
- the world API,
  `k5_dispatch_context_is_carried_only_when_opted_in`: the context reaches the
  payload only under the flag.
- `packages/spellkave-sdk/src/__tests__/audience_trace_presentation.test.ts`:
  the machine side is read from the occurrence's own trace; a malformed one is
  dropped and the question kept.
- These are engine, kernel and reader tests. The hand-played live run is
  recorded in `ledger/designs/guided-dialogue-tree.md`.

## Related

[Draft-then-confirm wizard](./draft-then-confirm-wizard.md),
[dialog choice slots](./dialog-choice-slots.md),
[prompt occurrence](./prompt-occurrence.md), and the
[context carriage](../interaction-dsl-and-world-authoring.md#carrying-opaque-presentation-context-carry_dispatch_context).

## Known misuse / anti-pattern

- Branching on a step id in a client. Ids are opaque; show titles.
- Putting anything private into the machine side. Everyone who hears the
  question can read it.
- Treating the machine side as permission. It is presentation; the server
  reads none of it, and the prompt occurrence and the world decide what may
  be answered.
- Changing the order of a guide while a draft is open. The NPC rebuilds a
  draft from the dialogue history and resolves a numbered answer against the
  question as it is asked now.
- A second copy of the order in the kind's program "for convenience".

## SRD features that use this

Aldwin's hero creation. Its guide is `creation.guide` in the DM duty document.
The menu-talker kind does not carry a guide yet.
