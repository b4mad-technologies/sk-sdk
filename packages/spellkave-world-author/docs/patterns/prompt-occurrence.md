# Dialogue prompt occurrence (which question is open, for whom)

## Name

`prompt-occurrence` — a typed, server-owned identity for "the question this
speaker has open right now"

## Problem

A speaker asks a closed question ("Which class?", "Stand with me? 1: yes, 2:
I must pass"). The answers are ordinary authored actions the addressee could
also fire for a totally different reason. Nothing published says which
actions answer the question that is open *now*, for *this* addressee — so a
stale or reused answer silently misfires, and every client re-invents its own
guess (hotbar ordering, a hard-coded id, a display-name matcher).

## Forces

- Disclosure is not eligibility (ADR-0139/ADR-0141): a client seeing an
  action does not mean it is THE answer to the open question.
- Reused generic slots. A shared palette (`dialog-choice-slots`'s
  `dm/dialog/choice/k`) is fired by every conversation a talker ever has — a
  delayed "Answer 1" meant for question A can satisfy question B's own gate
  predicate and acquire B's meaning.
- ABA. A static prompt id that closes and reopens (A → closed → A) makes a
  delayed answer to the FIRST A valid again once the SECOND A opens.
- Duplicates. A generic answer only inscribes a trace; the asker closes the
  slots on a later cycle, so more than one response can land before closure.
- Audience is a world relation (who is asked), not host/client configuration.
- No new frame write: the opening/closing transitions already exist as
  authored `ModifyResource` writes (a phase resource, `dm/dialog/open`);
  nothing here adds a `FrameWriteOp` arm. The kernel does keep its own
  occurrence and consumption tables and a prompt gate in `r_manipulate`.

## Solution

1. **Definition** (`prompt_definition`, Layer-3, authored): `source_selector`
   (who may ask — an entity ref or tag), `open_predicate_source` (a DSL
   selector over the SPEAKER'S OWN state — `actor.stat(...)`, never
   `target.stat(...)`), `response_action_ids` (the ordered answer set),
   `audience_kind_ref` (`core/audience/directed_trace` or `core/audience/
   broadcast` — kernel-seeded, no authored row needed), `trace_window_ticks`,
   `contract_version`.
2. **Occurrence** (`prompt_occurrence`, kernel-maintained, never client-written):
   the server opens one the moment `open_predicate_source` flips false→true
   on a matching speaker (the SAME post-frame hook that already refreshes
   factored context), captures `response_action_ids`, `contract_version` and `audience_trace_id`
   AT THAT MOMENT, and binds the addressee from the speaker's own directed
   speech trace. For `Broadcast` it stores the placeholder addressee `0`; the
   per-perceiver fan-out is not built yet
   (the world API).
   A → closed → A
   yields two DISTINCT occurrence ids — ABA is impossible by construction.
3. **Check before interpret**: binding is decided at the OCCURRENCE, not the
   definition table. A response that carries
   `semantic_context = { source_ref, occurrence_id }` is ALWAYS judged against
   what is open now for (source, actor): open-for-this-pair → same-occurrence
   → response-in-this-occurrence's-captured-set → not-already-consumed, IN
   THAT ORDER, before the response's own authored predicate ever runs. A
   response WITHOUT context is prompt-bound only while an open occurrence for
   that pair captures its action id (`prompt_context_required`); with nothing
   open it is an ordinary menu answer governed by its own predicate — the
   same generic `dm/dialog/choice/N` slot serves creation menus, plain
   talkers and quest offers. The membership check is what stops a reused
   generic slot from cross-answering one occurrence with another's meaning.
4. **Consume at commit**: consumption is recorded per (occurrence,
   answering actor) (`r_manipulate/prompt_gate.rs:220-231`) when the
   answer's outcome commits — in the admitting reducer for a deterministic
   outcome, later for a stochastic one that waits on a pending resolution.
   The first committed answer per actor wins; a rejected attempt consumes
   nothing.

## TOML example

Two shipped shapes open occurrences.

**Static authored prompt** (kavemouth quest offers,
`packages/spellkave-adventure-kavemouth/author/adventure.ts:135-139`,
rows in `fixtures/adventure/mechanics/actions.toml`): the giver's shared
answer set is disambiguated with the speaker's own bounded
`dm/dialog/prompt` id — see [`dialog-choice-slots`](./dialog-choice-slots.md)'s
generic `dm/dialog/prompt/set/<id>` family:

```toml
open_predicate_source = "actor.stat('dm/dialog/open') >= 1 && actor.stat('dm/dialog/prompt') == 7"
response_action_ids = ["dm/dialog/choice/1", "dm/dialog/choice/2"]
```

**Scripted menu act** (character creation): the DM presence performs a
finite `dm/dialog/ask-menu/<count>` action over the generic
`dm/dialog/choice/N` response slots. Its consequence inscribes the directed
question and `dispatch_options`, then opens the fixed prompt in the same
frame. `dialogMenuAct` in
`packages/spellkave-adventure-runtime/src/dm/dialog/prompt-offer.ts` builds
that plan; the host awaits its accepted receipt. No prompt definitions or
presentation attachments are authored during play.

## Presentation (what the player reads, never what the gate checks)

Static question text and labels can ride on a public `metadata_attachment`
under namespace `dialogue.prompt`, targeting a `prompt_definition`, with
payload `{ "question": string?, "responses": { "<action_id>": "<label>" } }`.
The SDK also accepts the existing optional positive `picks_remaining` field
for static presentations.

Scripted menu definitions instead carry `{ "presentation": "audience_trace" }`.
At opening, the occurrence binds its directed speech trace in
`audience_trace_id`; broadcast stores zero. The SDK reads the question and
ordered labels from that captured trace, so a later speech trace cannot
replace an already open menu's presentation. Creation puts the remaining-pick
count in the question text. `prompts[].presentation` exposes these values to
player tools and the native `spellkave prompts` command.

Presentation does not change response admission: the prompt gate checks the
occurrence's captured response-action set, audience, identity and consumption.
The implementation lives in
`packages/spellkave-sdk/src/core/readers/manipulation_context.ts` and
`client/src/cli/prompt_presentation.rs`. The seeded shared `dm` namespace and
fixed response vocabulary remain authored content. The runtime ownership guard
proves the creation, level-up, dialogue and adventure host paths import no
manifest writer.

## Proof

- `crates/spellkave-validate/src/lib.rs`'s `prompt_definition_*` tests
  (locality/stratification, audience/response-action FK resolution).
- the world API's `target_kinds_match_offline_validator_allowlist`
  (a `dialogue.prompt` label attaches to a `prompt_definition` row directly).
- `packages/spellkave-adventure-kavemouth/tests/offline/quest-prompts.test.ts`
  (authored generic-offer definitions and presentation).
- `packages/spellkave-srd-cc/src/test/live-preseeded/mechanics/prompt-creation.test.ts`
  (same-frame trace, immutable captured presentation, and authenticated CLI labels).
- `packages/spellkave-srd-cc/src/test/live-preseeded/mechanics/prompt-occurrence-gates.test.ts`
  (broadcast zero, stale identity, ABA, member and consumption checks).
- `packages/spellkave-adventure-runtime/src/dm/runtime-ownership.test.ts`
  (runtime and host import/port guard).

## Related

[`dialog-choice-slots`](./dialog-choice-slots.md) (the shared palette this
disambiguates), [`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md)
(the creation phases this gates one at a time), [`quest-composition`](./quest-composition.md)
(the accept/decline offer this identifies).

## Known misuse / anti-pattern

- Matching a spoken sentence or a display label as the save path — the
  occurrence id is the only thing a response's `semantic_context` may name.
- A static prompt id with no occurrence: ABA-replayable, cannot express
  replacement or closure.
- Authoring `audience_kind_ref` to a Rust-enumerated string instead of a
  `core/audience/*` id or an authored `audience_kind_definition` row
  (ADR-0018 D-1).
- Bundling a free-form, many-turns-open station (several simultaneously
  valid actions, no single "the" answer) under one `prompt_definition` —
  D-5's at-most-once consumption would reject every response after the
  first. Not every open question fits this pattern; a multi-field input
  station does not (ADR-0142 G-5, still open).

## SRD features that use this

Aldwin's character-creation class/background/species/confirm questions as
authored menu acts (`packages/spellkave-srd-cc/docs/character-creation.md`);
kavemouth's quest accept/decline offers
(`packages/spellkave-adventure-kavemouth/docs/kavemouth-quests.md`), whose
cross-bundle `response_action_ids` resolve through the narrowed
`action_definitions` reference-closure augmentation (sk-jay0.2.33.15.7).
