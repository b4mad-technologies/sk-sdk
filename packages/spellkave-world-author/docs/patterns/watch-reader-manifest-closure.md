# Watch reader-manifest closure

## Name

`watch-reader-manifest-closure` — a watch subscribes every table its injected
callbacks read, not only the ones its own body names.

## Problem

An NPC watch runs on one connection and declares that connection's tables
once, in its own `subscribeReaders` call. Hosts then inject callbacks —
"who is the hero", "who is present", "is this quest accepted" — and those
callbacks read tables the watch body never mentions. On an unsubscribed table
an SDK reader does not throw: it sees an empty table and answers *nothing
found*. The watch keeps running and quietly does less than it was wired to
do.

## Forces

- Subscriptions are per connection. A DM seat has ONE port and connection
  that every watch on that seat shares; `subscribeReaders` widens it
  additively (the retired TypeScript DM port; the Rust host's reader tiers, `crates/spellkave-npc-host/READER-HYDRATION.md`).
  Nothing widens it automatically: a callback the host supplies reads only
  what some reader manifest on that connection has subscribed, so a table
  that neither the watch's manifest nor the host subscribes stays empty.
- SDK readers fail soft by design: `readActorSnapshot` returns `null` when
  `visible_actor_spatial_location` carries no matching row, which is
  indistinguishable from "that actor is genuinely nowhere".
- The degraded answer is usually a *legal* answer. An empty companion list is
  exactly what an omitted resolver produces, so the failure looks like the
  documented default rather than a bug.
- Perception-gated `visible_*` tables differ per socket: the same reader can
  work on an operator connection and return nothing on the NPC's own.
- Runtime `session` / `session_participant` are **private** (ADR-0057, sk-2qt).
  Clients subscribe `visible_session` / `visible_session_participant`. A caller
  sees only sessions whose roster includes a directly-controlled body, or a body
  reached by an Internal-elevated DM extent. Unrelated sockets receive no
  TravelState `state_json` and no distant initiative. Reading the raw table
  names yields an empty handle, which looks like "no fight / not travelling".

## Solution

Treat the callback contract as part of the subscription. When a watch accepts
an optional resolver, its own reader manifest carries the tables that
resolver's documented implementation needs, and a comment says which resolver
each extra table is for — so a later reader deleting the "unused" table sees
why it is there.

```ts
await port.subscribeReaders([
  {
    requiredTables: [
      "visible_manifest_authored_entity",
      "visible_manifest_authored_entity_coverage",
      "visible_target_condition",
      "entity",
      "actor",
      "visible_object_state",
      // A host that answers `resolvePresentPartyEntityIds` by co-location
      // reads it through `readActorSnapshot`, which reads
      // `visible_actor_spatial_location`. Without this table the resolver
      // sees no companion anywhere and silently rebuilds the hero-only
      // grant it exists to replace.
      "visible_actor_spatial_location",
    ],
  },
]);
```

## Proof

`packages/spellkave-adventure-runtime/src/dm/watches/quest-xp-watch.ts`
(reader list `QUEST_XP_WATCH_READERS` in `dm/lib/readers.ts`) subscribes `visible_actor_spatial_location` for
`resolvePresentPartyEntityIds`;
`packages/spellkave-adventure-elven-mini/npcs/catalog.ts` supplies the
resolver. Live proof:
`just srd-cc-live src/test/live-self-seeding/mechanics/q4-quest-xp.test.ts` —
`Aldwin granted 200 quest XP for Q4 to 2,143,15`, `xpAfter={hero:200,
rogue:200, hesper:200}`. Before the table was subscribed the same wiring
granted `to 2` alone (bead `sk-awlo.15`, PR #2792 measurement).

## Related

- [`quest-xp-grant`](./quest-xp-grant.md) — the grant this closure makes
  reach the whole present party.
- [`party-extent-grant`](./party-extent-grant.md) — where party membership
  itself comes from.
- [`before-filing-a-kernel-gap`](./before-filing-a-kernel-gap.md) — an empty
  live read is a subscription question before it is a substrate question.

## Known misuse / anti-pattern

Concluding from an empty read that the world is empty. `q4-quest-xp.test.ts`
carried exactly that inference in reverse: it saw `entityNodeId` return
nothing on the operator socket, and hardcoded the companion pair rather than
widening the subscription — a correct local call that hid the production
defect for as long as it stood.

Equally wrong: adding the whole `visible_*` surface to a watch "to be safe".
Each table is bandwidth on a long-lived connection; subscribe what a named
resolver reads, and say which one in a comment.

Equally wrong for combat/travel: iterating `db.session` after sk-2qt. The raw
table is not on the wire; subscribe and read `visible_session` (and
`visible_session_participant` for the roster) from a connection that actually
participates or holds Internal DM elevation.

## SRD features that use this

- Elven-mini Q1–Q12 terminal quest XP to the co-located party.
