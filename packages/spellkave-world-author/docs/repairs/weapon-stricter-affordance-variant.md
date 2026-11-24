# Opting ONE weapon copy into a stricter affordance variant without regressing its siblings

(The worked example below — duplicate shortbow ids, `weapon.requires_ammunition`,
`attack-ranged.toml`'s `/ammo` variant — is retired content from
`archive/packages/spellkave-srd/fixtures/base/`. The live srd-cc attacks in
`packages/spellkave-srd-cc/fixtures/base/playing-the-game/attacks.toml` carry
no ammo variant. The general pattern still applies.)

Two entity_definitions can represent "the same" item (e.g. `srd/item/shortbow`
and `srd/weapon/shortbow` both exist, pre-dating any single-source-of-truth
cleanup) and already have DIFFERENT proven wielders. Adding a new, stricter
mechanic (ammo tracking) to a SHARED consequence/affordance template affects
every wielder of every entity_def that reaches it — including beats you don't
control and can't regress. The safe pattern: (1) pick a distinguishing tag
(`weapon.requires_ammunition`) applied ONLY to the specific entity_def copy
you're opting in — check first whether any *proven* beat already wields that
exact id (if so, pick the untouched sibling copy instead, or mint a new
def); (2) append `&& actor.wielded_item.has_tag('<tag>') == false` to the
EXISTING affordance's predicate (a no-op for every current wielder, since
none carry the new tag yet); (3) author a full sibling
outcome/affordance/action cluster with the SAME to-hit math but the tag
check flipped to `== true`, plus the new consequence frame_write. The two
variants then never double-materialise for the same wielder, and zero
already-committed transcripts change (attack-ranged.toml's
`srd/attack/ranged` vs `srd/attack/ranged/ammo`).

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
