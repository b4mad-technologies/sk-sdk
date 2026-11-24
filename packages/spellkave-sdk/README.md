# @spellkave/sdk

Host-neutral TypeScript SDK over generated Spellkave bindings. Runtime reads use
`SnapshotDb`; writes use typed `ActorClient` reducer methods. Server views and
reducers remain the authority boundary.

## PLAYER projection flow

The SDK readers under `src/core/readers/` provide deterministic projections for
the companion package's orientation and direct-attempt workflow. In particular,
the player layer reads `spellkave_manipulation_context` for independent action
and target facts, then submits a typed `spellkave_manipulate` attempt; the
server remains the sole authority for admission.

- `self.ts` supplies the connected body summary and owned-state rows;
- `scene.ts` supplies the current authorized scene, targets, and detail;
- `inventory_query.ts` plus `item_detail.ts` supply possession lists and joined
  item identity/state;
- `trace_query.ts` supplies perceived trace summaries, entries, and detail;
- `session_status.ts` plus `reaction_options.ts` supply participant session and
  reaction choices.

Readers return sorted authorized rows and do not mint handles. The companion
layer applies finite limits, opaque cursors, revision-bound handles, and compact
presentation. Actions delegate to `ActorClient`; neither a reader result nor a
handle authorizes a reducer.

Capability details join optional authored `capability_definition.description`
only for the connected body's visible grants. Item state details join optional
`resource_definition.description` only after the item resolves through the
authorized possession projection. Both omit unavailable or blank prose and
preserve supplied plain text. Consumers provide missing-description copy;
the readers do not invent explanations or infer additional grants/items from
public definition catalogs. These additive fields retain existing row ordering
and identity. Capability-query revisions include the projected prose; item
detail retains the inventory handle/revision used to resolve its owned item.

## General/operator compatibility

Broader legacy readers and low-level `ActorClient` methods remain available for
operator automation and compatibility tests. They are not the canonical PLAYER
workflow and must not be used to bypass server-defined caller scope, direct-body
control, capabilities, or gameplay predicates.

## Lightweight subpaths (no live connection)

`@spellkave/sdk/readers` and `@spellkave/sdk/schema-surface` are the names and
HTTP schema helpers used at process start. They do not import `connection.ts`
or generated world `module_bindings`. Live `connect()` stays on the package
root (`src/index.ts`).

## Live tests live in `@spellkave/test-lab`

The live-node TypeScript test harness (test worlds, private scenes, forced
RNG seed, manual scheduler control; ADR-0088 D-2) is its own package,
[`packages/spellkave-test-lab`](../spellkave-test-lab/README.md)
(`@spellkave/test-lab`). It depends on this SDK; the SDK does not depend on
it and does not re-export it, so test-lab semantics stay out of the
production surface (`connection.ts`, `readers.ts`, `replay.ts`,
`provenance.ts`).

## Actor action observation

Actor actions submit the reducer once, then classify the result against the
same subscribed cache on delivered-row or reducer-result callbacks. The
observation deadline remains a failure bound. Snapshot hosts without removable
cache listeners retain the configured polling fallback. Listeners and the
pending timer are removed when an attempt ends, including rejection or a
caller predicate error. The injected-delivery contract is covered by
[reducer_observation_delivery.test.ts](src/__tests__/reducer_observation_delivery.test.ts).
The [creation measurement](../../docs/research/ci-reducer-observation-callbacks.md)
records local before/after and counterfactual timings with their limits.

For `ActorClient.manipulate`, an actor ID and a fresh provenance row are
insufficient to identify a call: two processes may act through the same
presence. The wrapper waits for its own reducer result and accepts only a
single terminal Affordance receipt delivered with that invocation's original
argument object. The pinned SpacetimeDB 2.10.1 transport preserves that object
in the caller's ReducerResult callbacks; other sockets receive Transaction
callbacks. Driver-token wrappers retain the nested manipulation args object.
The live transport and same-presence two-process contract is
[manipulation-receipt.local-node.test.ts](../spellkave-test-lab/src/scene-live/manipulation-receipt.local-node.test.ts).

A changed state predicate alone no longer proves manipulation success. Without
an attributable receipt (including snapshot-only hosts, wrappers that clone
the nested args, deferred admission with only a Predicate receipt, or ambiguous
terminal receipts), a settled call returns `unobservable` immediately
without attaching another call's provenance. A transport rejection remains
`rejected` without a provenance receipt. `successOnProvenance` uses the same
attribution rule. Callers must inspect this uncertainty; it does not establish
that the act failed and must not cause an automatic retry.
A deferred reaction admission may return only a Predicate receipt. Ending that
observation promptly lets the caller answer the pending reaction; waiting for
a terminal Affordance here can prevent that continuation from being answered.
The portable consumer regression is
[AUTH-48-01](../spellkave-tool-player/src/__tests__/seal-break.local-node.test.ts).

This tightens observation only: argument/reducer signatures and result variants
stay compatible, server authority and persistent state are preserved, and no
module publish, world reload, or reset is required. Upgrade consumers together
when they rely on snapshot-only predicate success. Rolling back this SDK restores
the earlier subject-based observation race; retain a single invocation owner
or the scoped controller's conservative guard during rollback.

## World-event stream

`createWorldEventBuilder` (`@spellkave/sdk/world-events`,
[builder.ts](src/world-events/builder.ts)) derives the closed `WorldEvent`
stream that Play, the player MCP gateway, the Pi extension and `sk` deliver.
Its contract and every dated change live in
[unified-world-event-stream.md](../../ledger/designs/unified-world-event-stream.md).

Since the compatibility decision of 2026-11-12:

- Within one drain, the resource-delta and condition-delta kinds come out
  together, oldest-first by event id, and a `session_lifecycle` `closed` event
  is last. The trace kinds (`speech_heard`, `trace_addressed`,
  `trace_departure`) keep reader order, newest-first. The readers' own sort is
  unchanged. Pinned by
  [world_events_builder_order.test.ts](src/__tests__/world_events_builder_order.test.ts).
- `self_resource_spent` is not emitted when the delta's `source_entity_ref`
  is non-empty and not the actor. The rule keys on that field, which is the
  frame's `Actor` binding: a `ForEachActorInRadius` body rebinds it to each
  target, so a radius-applied delta reads as self-caused, stays a spend, and
  an area `self_hit` carries no `attacker_name`. Pinned by
  [world_events_builder_spend_source.test.ts](src/__tests__/world_events_builder_spend_source.test.ts).
- `self_hit` may carry the optional `attacker_name`, resolved at emit time from
  the same source as `dealt_hit.target_name`. The key is absent when no name
  resolves or the attacker is the actor. Pinned by
  [world_events_builder_attacker_name.test.ts](src/__tests__/world_events_builder_attacker_name.test.ts).

This changes delivery only: no kind was added or removed, no existing field
changed type, server authority and persistent state are preserved, and no
module publish, world reload, or reset is required. Upgrade consumers that
match the `self_hit` sentence or rely on the earlier within-drain order
together with this SDK. Rolling back this SDK restores the earlier order, the
spends sourced by another entity and the earlier sentence, with no data migration.

## Manifest apply observation

Manifest applies through the shared lane (test-lab uses it too) submit once and observe the subscribed digest/outcome
insert callbacks. An external `MF-APPLY-013` collision fails immediately. The
15-minute dead-scheduler watchdog remains a failure bound; it is not a delay on
the successful path. Production callers supplying `onUpdate` likewise use
post-cache notifications without polling. Legacy callers that supply no update
source retain the polling compatibility path and explicit retry opt-in.

Failed results retain an `outcome` with `applyId`, `digest`, `code`, and `message`
when the server supplies a failure row. Throwing wrappers use
`ManifestApplyError`, preserving that outcome and the original exception as
`cause` when enqueue or observation throws. The message also prints correlation
for text-only consumers. A generic `MF-APPLY-029` row still cannot explain a
server-side cause that was not persisted; use its correlation with node logs.

See the [test-lab live probe verification](../spellkave-test-lab/README.md) for
the owned-node proof, repeatability boundary, and counterfactual.
