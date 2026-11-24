# An affordance `niche_id` needs a `spatial_niche_attachment` only when its niche is place-provided — pick the niche's `provider` deliberately

**Symptom — a granted capability yields no affordance at the actor's node.**
Granting a capability via `actor_capabilities` does not, by itself, make an
affordance derivable. The `capability:<id>` prefix some `niche_id` values use
is a naming convention; nothing in the kernel matches on the `"capability:"`
string. What decides admission is the niche's `niche_definitions.provider`,
which resolves to a `niche_provider_definition` row whose flags both the
perceive side and the act side read
(the world API;
act-side branch in the world API,
the `resolve_niche_provider_flags` call before the attachment lookup).

The three seeded providers:

- **`place`** (also what an empty `provider`, or a niche with no
  `niche_definitions` row, falls back to) — the niche exists only where a
  `spatial_niche_attachment` binds it to the node the perceiving actor
  occupies. This is where the original symptom comes from: no attachment at
  the actor's node, no affordance, and the act fails with
  `r_manipulate: precondition failed (element=attachment_presence): no spatial_niche_attachment for niche '…'`.
  The `self_eligible = true` flag does not change this.
- **`entity`** — a candidate entity affords the niche through its own
  authored tags/state satisfying the niche predicate; no attachment row.
  Live example: `srd.advancement_trainer` in
  `packages/spellkave-srd-cc/fixtures/base/character-creation/advancement.toml`.
- **`actor`** — the actor's own capability carries the verb everywhere; no
  attachment row is consulted (the act records
  `precondition:attachment_skipped:actor_provided`). Live example: the
  `capability:srd/class-feature/fighter/second-wind` `[[niche_definitions]]`
  row with `provider = "actor"` in
  `packages/spellkave-srd-cc/fixtures/base/classes/fighter.toml` (~line 1293).

**Repair.** For a mount/buff/ability meant to work "from anywhere", author the
niche with `provider = "actor"` (carrier-bound verbs) or `provider = "entity"`
(target-provided verbs) instead of attaching it at every node. Keep `place`
(with attachments) only when you actually mean room-scoping. A
`capability:*` niche must name its provider explicitly — the world-author
pre-flight rejects the miss as `WA-CAP-002`; see
[`running-an-authored-act`](../running-an-authored-act.md#anchoring-depends-on-the-niches-provider-changed-by-actor-carried-verbs).

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
