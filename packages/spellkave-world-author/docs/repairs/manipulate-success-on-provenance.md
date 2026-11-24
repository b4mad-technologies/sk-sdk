# `manipulate()`'s `successPredicate` has no fixed world-state signal for a stochastic (d20-driven) action — pass `successOnProvenance: true` on the client instead

`createActorClient(session, id, { successOnProvenance: true })` makes
`manipulate()` treat a `succeeded` `evaluation_provenance` row as success even
when `successPredicate` never fires (`provenance.ts`; default `false` —
predicate-driven, unchanged). A death-save roll, a Medicine/Perception/DC
check, or any other action whose outcome branches on a live d20 draw has no
single expected POST-state to poll for (unlike a deterministic action, e.g.
`hpAfter === hpBefore + 6`) — without this option `manipulate()` times out to
`unobserved_no_provenance` even though the server-side row shows
`(succeeded = ())`, because the default path only resolves via
`successPredicate` or a terminal `evaluation_provenance` status, and the
common `() => false, () => null` combo (CC4/CC5's own `fightUntilDown`
idiom) never satisfies the predicate branch on its own.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
