# Example — weighted int roll table

A worked authoring of a **non-uniform, non-identity** int `roll_table`. Use
this shape for weighted draws (encounter severity, loot tiers, omen tables).

**Do not** author a die as an identity-mapped uniform 1..N weight-1 int
table — that is MF-VAL-317 Fatal (sk-s1e / #2184). Author dice as DSL
expressions (`1d8`, `d20`, `2d6 + 3`) or an
`entity_definition_item_dsl_source` slot (sk-84i.2 `.source`).

The complete manifest form is
[`weighted-int-roll-table.toml`](./weighted-int-roll-table.toml).

```toml
[[roll_tables]]
roll_table_id = "example_weighted/severity"
bundle_id = "example_weighted"
display_name = "Encounter severity"
result_kind = "int"

[[roll_table_entries]]
roll_table_entry_id = "example_weighted/severity:1"
roll_table_id = "example_weighted/severity"
authored_order = 1
weight = 6
result_ref = "10"

[[roll_table_entries]]
roll_table_entry_id = "example_weighted/severity:2"
roll_table_id = "example_weighted/severity"
authored_order = 2
weight = 3
result_ref = "20"

[[roll_table_entries]]
roll_table_entry_id = "example_weighted/severity:3"
roll_table_id = "example_weighted/severity"
authored_order = 3
weight = 1
result_ref = "30"
```

## Things to notice

- **`result_kind = "int"`** lets the DSL evaluator parse each `result_ref`
  as `i64`. Outcome-graph tables use `"outcome_graph"` instead.
- **Unequal weights** skew the draw (here 6:3:1). Equal weights on
  **non-identity** values are also legal; identity 1..N with every
  `weight = 1` is not.
- **DSL call:** `roll_table('example_weighted/severity')` resolves against
  the seeded entries at evaluation time.
- **Static reference validation** still checks `roll_table('<id>')` calls
  (`MF-VAL-211`).

## Retired: d20-as-roll-table

The previous `d20-roll-table` worked example taught a 20-row identity
weight-1 table. That shape is now rejected at validate time. Prefer the
native `d20` / `1d20` DSL atom for dice.
