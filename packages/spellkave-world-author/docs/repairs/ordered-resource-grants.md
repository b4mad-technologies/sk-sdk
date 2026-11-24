# Ordered resource grants can read earlier frame writes

`consequence_frame_writes` execute by ascending `ordinal`, and each
`ModifyResource.delta_source` evaluates against fresh live facts. One authored
consequence can therefore change a driver resource first and derive a later grant
from the new value. For example, an advancement consequence can increment `level`
at ordinal 0 and use `cond(target.stat('level') == 5, 1, 0)` for a proficiency
resource at ordinal 2. A resource definition's `initial_value` supports
`ModifyResource` seed-and-apply when the target row is absent, but it does not
synthesize a readable `object_state` row before the first write; author an explicit
row when the pre-action value must be perceived or read by the DSL.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
