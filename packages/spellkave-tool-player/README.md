# `@spellkave/tool-player`

Browser-safe canonical execution for the PLAYER tool roster and the DM extension. The package owns tool bodies and projections; hosts supply an SDK-backed context and optional capabilities through `@spellkave/tool-runtime`.

- [`docs/tool-reference.md`](docs/tool-reference.md) lists the generated PLAYER and operator schemas.
- [`docs/player-scoped-map-view.md`](docs/player-scoped-map-view.md) records the player-visible map contract.
- Node hosts compose the same tools through `@spellkave/session/player-tools`; Pi conversion belongs to `@spellkave/tool-agent-adapter`.

## Portable product guidance

The package owns [player-loop.md](docs/player-loop.md), projected through the
shared corpus as `player/workflows`. Retrieve it with `sk docs player/workflows`
or `spellkave_docs` using that `doc` ID when the adapter offers public help.
The guide describes established gameplay tools; role presence and privileged DM
workflows retain their own pending prerequisites and proof. Persona/access routing
is `personas/access`; reading it grants no world authority.

## PLAYER workflow

Start with `spellkave_orient`. Read `spellkave_manipulation_context` for independent action and target facts, then attempt a typed target and action through `spellkave_manipulate`. Communication uses `spellkave_communicate` with an authored speech-act id, typed target, and optional utterance. Sensing uses `spellkave_sense_context` and a direct `spellkave_sense` attempt. These facts do not promise eligibility; the world validates each attempt.

Scene movement, detail inspection, reactions, and pagination retain their own opaque handles and cursors. Keep these within the revision and domain that produced them.

Reaction and intervention listings also disclose `window_key`, an opaque
continuity key derived from the visible window identity. It remains stable when
other windows change the listing revision. It is not a dispatch handle or a
permission token: responses still use the current handle and revision. A host
persisting this key must scope it to the actor and world generation, because a
world reset may reuse internal identifiers. `SeatView.pending.windowKey` carries
it to deterministic brains; older hosts may omit it, leaving identity unknown.
The reaction-options test verifies stability across a changed listing.

## Communication delivery

The host chooses `worldEvents.replyDelivery` when composing its PLAYER tools:

- `bundled` (default) saves follow-up calls for clients without an event return
  channel. After an accepted dispatch, a cache-update listener claims the first
  matching NPC reply before the bounded deadline. The reply appears in
  `conversation.response`; subsequent drains deliver unclaimed events.
- `events` returns after confirmed dispatch and immediate consequences, without
  waiting for or claiming NPC speech. `conversation.response` remains `null` and
  `awaiting_response` remains `true`. The client's event channel delivers replies.

The browser Play host selects `events`. Pi and the session daemon retain bundling;
daemon hosts can select a mode through `StartDaemonOptions.replyDelivery`. MCP as
a protocol does not imply either capability. The model does not choose this
setting on individual tool calls, and existing tool result fields are retained.

Bundling hosts must provide `onUpdate(notify)`, returning an unsubscribe function,
alongside their one long-lived event builder. Missing notification wiring fails
before dispatch. `replyWindowMs` overrides the estimated window; otherwise
`replyWindowCapMs` bounds the estimate. `pollMs` is deprecated and ignored.
`replySignal` cancels the wait when the host connection closes. The listener and
deadline are removed on completion or cancellation. A notification at or after
the deadline leaves the reply available to a later drain, even if the timer
callback itself was delayed by load.

Tests inject `replyClock` with `now()` and `schedule(callback, delayMs)`, where
`schedule` returns a cancellation function. This controls only the reply window;
SDK/network timers remain real. Deterministic boundary and delivery proofs live
in `src/__tests__/reply-window.test.ts` and the Session package's
`src/player-tools/__tests__/act-affordance-communicate-reply.test.ts`.

## Unconfirmed outcomes

Manipulate and communicate results with SDK status `unobservable`,
`unobserved_timeout`, or `unobserved_no_provenance` retain receipt outcome
`unobserved`. Their PLAYER message is "The outcome could not be confirmed."
They return `observation: null` and an `observation_gap`, without a completion
provenance ID or a resolution summary derived from diagnostic Predicate rows.
This does not establish refusal or no effect and must not trigger an automatic
retry. Confirmed successes, refusals and malformed requests retain their
existing result contracts.

Status values and field names stay compatible; this changes uncertain prose and
omits optional completion metadata when completion is unknown. Rollout and
rollback require only the consuming tool host, with no module publish or world
state migration.
