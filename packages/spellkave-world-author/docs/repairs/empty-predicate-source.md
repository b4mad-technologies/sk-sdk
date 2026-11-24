# An empty `predicate_source` needs `predicate_bool = true`, or the affordance silently never resolves

(Worked examples B4/RH2/CC1 are from the retired Phandelver bundle, deleted in `fd2288bdea` — recover via `git show`, see `archive/README.md`; the rule still holds.)

**Gotcha — `predicate_bool` is not a decorative default; it is the literal
value used whenever `predicate_source` is the empty string.** An
unconditional self-eligible act (B4's `approach_quietly`/`skulk_in_brush`,
RH2's `search_cistern` — "always available, no check" acts, as opposed to a
DC-gated check whose `predicate_source` carries a real roll expression)
leaves `predicate_source = ""`; if `predicate_bool` is left at its
easy-to-copy-paste default of `false` (the value every DC-check row in this
codebase carries, since a non-empty `predicate_source` makes `predicate_bool`
irrelevant there), the affordance predicate always evaluates false and the
act never resolves — `hero.manipulate(...)` comes back `rejected` with
`failure_kind: "predicate_rejected"` and a `failure_detail` of the form
"r_manipulate: no authored affordance_template selected action_definition
'…' — predicate_rejected: … its predicate evaluated false"
(the world API)
(CC1 hit this on its own `quiet_approach` +
`trigger_tripwire` acts, both copied from a DC-check template's field list
without swapping this one field). Rule: whenever `predicate_source = ""`,
set `predicate_bool = true` (B4's `cragmaw-hideout-approach.toml` is the
precedent to copy) — `false` there means "this affordance can never fire."

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
