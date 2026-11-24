# Gotcha — `adjacentMoves()` lists raw graph geometry, not gated traversability; to prove an edge now rejects, attempt `.move()` and check the status

`listAdjacentMoves` (`packages/spellkave-sdk/src/core/movement.ts`) iterates
`place_edges` only — it performs ZERO affordance-predicate evaluation
(`packages/spellkave-sdk/CLAUDE.md` §1/§4: the SDK is forbidden from
re-implementing server-side runtime validation). An edge whose traversal
affordance is gated shut (e.g. a trap that closes a room, WE10's statue
trap) still appears in `adjacentMoves()` — the `edge_key` geometrically
exists; only its `place_edge_affordance` predicate is false. Asserting
persistence of a closed gate by checking absence from `adjacentMoves()`
is a false negative that will never fail even when the gate is genuinely
broken. Assert the real thing instead: call `.move(edge.edge_id)` and
check `result.status === "rejected"`.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
