# Offline rule evaluation bench (`spellkave_eval` / `sk eval`)

<!-- Budget: ≤300 lines. Entry point for offline formula and rule benching. -->

The offline rule evaluation bench lets authors test Spellkave DSL expressions
locally without a running node, a database connection, or game state. It uses the
exact same evaluator that the SpacetimeDB server runs in production, compiled to
WebAssembly (`crates/spellkave-validate-wasm`).

## Two interfaces, identical results

The bench is exposed in two forms:

1. **CLI:** `sk eval <expr> [--kind predicate|int|text] [--facts <json>] [--dice <faces...>] [--format human|jsonl]`
2. **Author tool:** `spellkave_eval` in `@spellkave/tool-authoring`, callable by AI agents in authoring harnesses.

Both interfaces need no SpacetimeDB node, require no selected context, and return
identical values, stochastic draws, and execution traces.

### Exit codes

Following ADR-0002:

- **`0` (Success):** The expression evaluated successfully. For a predicate, both `true` and `false` are valid evaluation results with exit code `0`.
- **`2` (In-world rejection):** The evaluation could not complete due to missing facts, exhausted dice, exceeded resource bounds, unknown macros, or unsupported server-only operators.
- **`1` (Usage error):** Invalid CLI syntax or schema violations (e.g. unknown `--kind`).

## When formulas evaluate in the game loop

To author rules effectively, understand when each DSL formula is evaluated by the server:

1. **Disclosure (Affordance generation):**
   - Purely capability-driven (`actor_capabilities` matching `affordance_templates.capability_id`).
   - Reads **no formula** and rolls no dice.
   - If an actor lacks the capability, the affordance is not disclosed.

2. **Selection (Candidate validation):**
   - Evaluated during `r_manipulate` candidate selection (the world API).
   - Evaluates `affordance_templates.predicate_source`.
   - If this evaluates to `false`, the attempt is **rejected** (`predicate_rejected`), not treated as an in-world miss. If no spatial niche attached to the location, the attempt fails with `niche_unresolved`.
   - **Do not place attack rolls in the affordance template predicate** (see [`patterns/offer-vs-resolution-roll`](./patterns/offer-vs-resolution-roll.md)).

3. **Resolution (Act execution):**
   - When an action has `resolution_mode = "Stochastic"`, the server evaluates `action_definitions.resolution_predicate_source` (the world API).
   - A `true` result executes `on_success` consequences (e.g. dealing full damage).
   - A `false` result executes `on_failure` consequences (e.g. a miss or partial effect).

4. **Consequences:**
   - Evaluates modifier delta expressions (e.g. `delta_source` on `ModifyResource`) as consequences are applied.

The bench evaluates the supplied expression directly against author-provided facts. It has no ambient game world and no offer mode.

## Fact shape

The `facts` parameter accepts an object grouping facts by subject or pool. The evaluator strictly validates subject and pool names:

```json
{
  "actor": {
    "stat": { "str": 16, "demo/bonus": 3, "srd/hp": 25 },
    "tag": ["player", "warrior"],
    "capability": ["srd/capability/attack/melee"],
    "resource": { "srd/hp": { "min": 0, "max": 30 } }
  },
  "target": {
    "stat": { "ac": 15, "demo/threshold": 15 },
    "tag": ["undead"]
  },
  "location": {
    "tag": ["underground", "dark"]
  },
  "session": {
    "tag": ["combat"]
  },
  "world": {
    "stat": { "tick": 4200 }
  },
  "actor.wielded_item": {
    "stat": { "reach": 5 },
    "tag": ["slashing", "martial"]
  },
  "actor.equipped_item:main_hand": {
    "stat": { "bonus": 1 }
  },
  "bindings": {
    "target_entity": "1002"
  },
  "roll_tables": {
    "demo/loot": [
      { "entry_id": "demo/loot:gold", "weight": 70, "result_ref": "100" },
      { "entry_id": "demo/loot:gem", "weight": 30, "result_ref": "500" }
    ]
  },
  "item_sources": {
    "actor.wielded_item": {
      "damage": "1d8 + 3"
    }
  }
}
```

### Manifest resolution

If a manifest TOML exists in the author's workspace:
- `macro('id')` expressions resolve definitions from `[[dsl_macro_definitions]]`.
- `roll_table('id')` expressions resolve entries from `[[roll_tables]]` and `[[roll_table_entries]]`.
- If `facts.roll_tables` provides entries for a table, those entries take precedence over the manifest.

## Chosen dice mechanics

The `dice` parameter provides predetermined numbers for stochastic operations:

- **Dice rolls (`1d20`, `2d6`):** Consumes faces sequentially from `dice`.
- **Roll tables (`roll_table('demo/table')`):** Consumes **one number** from `dice` as raw entropy. The evaluator takes it modulo the table's total weight, then walks weighted entries in lexicographic `entry_id` order from zero; it is not a 1-based ticket. Replaying a recorded live value as this entropy is therefore not generally valid.
- **Roll modifiers (advantage / disadvantage):** Under advantage or disadvantage, single-die rolls and integer roll tables consume two values from `dice`, keeping the highest or lowest as appropriate.
- **Exhaustion:** If an expression requires more draws than provided in `dice`, evaluation halts immediately with `dice_exhausted`, naming the exact draw number that found the list empty.

## Reading the evaluation trace

When run with `--format human`, `sk eval` displays a tabular AST:

```
┌────┬───────┬────────────┬───────┬─────────────┬─────────────────────┬────────┐
│ #  │ Depth │ Operator   │ Scope │ Value       │ Table entries / Span│ Status │
├────┼───────┼────────────┼───────┼─────────────┼─────────────────────┼────────┤
│ #1 │ 3     │ Roll       │ -     │ 12 (Int)    │ 1..4                │ ok     │
├────┼───────┼────────────┼───────┼─────────────┼─────────────────────┼────────┤
│ #2 │ 3     │ IntLiteral │ -     │ 3 (Int)     │ 7..8                │ ok     │
├────┼───────┼────────────┼───────┼─────────────┼─────────────────────┼────────┤
│ #3 │ 2     │ Arithmetic │ -     │ 15 (Int)    │ 1..8                │ ok     │
├────┼───────┼────────────┼───────┼─────────────┼─────────────────────┼────────┤
│ #4 │ 2     │ IntLiteral │ -     │ 15 (Int)    │ 12..14              │ ok     │
├────┼───────┼────────────┼───────┼─────────────┼─────────────────────┼────────┤
│ #5 │ 1     │ Compare    │ -     │ true (Bool) │ 0..14               │ ok     │
└────┴───────┴────────────┴───────┴─────────────┴─────────────────────┴────────┘
```

Key trace properties:
1. **Completion order:** Children (operands) evaluate and complete before their parents. The root node appears last.
2. **Depth:** Indicates AST nesting level (1 = root).
3. **Scope:** Carries subject and slot context when evaluating nested item sources (e.g. `actor.wielded_item.damage`).
4. **Failing nodes:** If evaluation fails (e.g. a missing fact), the node that raised the failure is marked with `! #<id>` and `FAILED: <reason>`. Ancestor nodes report the propagated failure.

The result's top-level `draws` list is the authoritative stochastic record. Trace rows deliberately do not claim individual draws: nested item-source evaluation and repeated AST-node evaluation make a node id insufficient to attribute a draw reliably. Roll-table trace rows instead show the selected `entry_id` values and which one was `kept`.

### Operator precedence: `||` binds tighter than `&&`

In the Spellkave DSL grammar, the disjunction operator `||` has higher precedence than conjunction `&&`:

`A && B || C` is parsed as `A && (B || C)`

When `A` evaluates to `false`, the right-hand group `(B || C)` is short-circuited. The trace will show `A` evaluated to `false`, while `B` and `C` are omitted entirely from the trace.

## Resolution limits

To protect the server from infinite recursion and denial of service, expressions are evaluated within bounded limits:

- **Static draw budget:** `EvaluationLimits::for_expression` computes the static draw count times 2, capped at `MAX_DRAW_CEILING` (256 draws).
- **Node limit:** Hard limit on the maximum number of AST nodes (512).
- **Depth limit:** Maximum AST recursion depth (64).
- **Item source depth:** One nested `actor.wielded_item.source(...)` evaluation; a source may not call `.source(...)` again.

The Rust evaluator defines these bounds in `EvaluationLimits::default`,
`EvaluationLimits::for_expression` and `eval_dsl_source`; its bound and
source-recursion tests exercise the enforcement.

Runtime node, depth and draw limits reject with `bound_exceeded`, naming the
bound and its budget. A source that calls another source rejects with
`recursion_limit`, naming the subject and slot.

## Quick reference examples

Evaluate an attack roll predicate with predetermined d20 face 12:

```bash
sk eval "1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')" \
  --kind predicate \
  --facts '{"actor":{"stat":{"demo/bonus":3}},"target":{"stat":{"demo/threshold":15}}}' \
  --dice 12
```

Evaluate a damage roll:

```bash
sk eval "1d8 + 3" --kind int --dice 6
```

Evaluate weapon damage reading an item source slot:

```bash
sk eval "actor.wielded_item.source('damage')" \
  --kind int \
  --facts '{"item_sources":{"actor.wielded_item":{"damage":"1d8 + 3"}}}' \
  --dice 7
```

## Live act evaluation records (`provenance_id` and `self_states`)

While Level A evaluates expressions offline, live simulation evaluates rules within the SpacetimeDB server. When an in-world PLAYER attempts an act or movement:

1. **Act:** The client dispatches an action (`sk manipulate`, `sk move`).
2. **Match receipt:** The receipt carries `provenance_id` naming the evaluation record that the client matched to the act.
3. **Query record:** Query the single evaluation record with:
   ```bash
   sk self_states --kind evaluation --provenance-id <id>
   ```
   This returns the continuation envelope with `matched: 1` and the single row (or `matched: 0` if not found).
4. **Read evaluation fields:**
   - If the act was **refused before resolution** (e.g. `predicate_rejected`), `expression_ids` names the action and gate formula that refused it, alongside `failure_kind` and `failure_detail`.
   - If the act **resolved a stochastic check**, `draws` contains the exact dice faces rolled, and `selected_template_ids` holds resolution labels such as `resolution_result:false` and `resolution_consequence:<id>`.
5. **Reproduce at Level A:** Take the failing formula (or resolution predicate), the dice values from `draws`, and the relevant entity/target stats, and run `sk eval` to inspect the full AST trace.

### Two lookup limits

Keep two constraints in mind when reading live act evaluation records:

1. **Client matching by arrival window:** The client matches an act receipt to a server evaluation row by the acting subject and baseline arrivals (rows absent before the act). When a body dispatches multiple acts in rapid succession, check `created_at_tick` on the returned record to confirm which act the record belongs to.
2. **Body ownership scoping:** `spellkave_self_states` queries only records owned by the connected actor's body (`owner_body_entity_id == actor.entity_id`). An evaluation failure row written with owner body 0 (such as a pre-actor system-level rejection before body resolution) or belonging to another actor is not returned by the lookup (`matched: 0`).

### Recorded live node run (hands-on verification)

The entire rule diagnosis, offline reproduction, repair, and re-verification loop runs over published surfaces without SQL queries, server logs, or kernel source inspection:

1. **Refused act receipt:**
   The player attempts to traverse exit `s:exit:1`:
   ```bash
   sk move --handle s:exit:1 --rev <rev>
   ```
   The server rejects the move. The receipt carries the evaluation id:
   ```json
   {"status":"dispatched","verb_class":"movement","handle":"s:exit:1","outcome":"rejected","provenance_id":"r_move:1:3"}
   ```

2. **Single record query (`provenance_id` lookup):**
   ```bash
   sk self_states --kind evaluation --provenance-id r_move:1:3 --format jsonl
   ```
   Returns 512 bytes with the exact failure details:
   ```json
   {"kind":"tool_result","tool":"spellkave_self_states","ok":true,"details":{"listing":"paginated","shown":1,"matched":1,"truncated":false,"next_cursor":null,"rev":"u2-irew8w","items":[{"provenance_id":"r_move:1:3","created_at_tick":1,"status":"Failed","subject_id":"1","selected_template_ids":[],"draws":[],"record_kind":"Affordance","failure_kind":"predicate_no_longer_holds","failure_detail":"affordance_template=core/affordance/traverse_known_threshold;mode=;predicate_source=canonical(template=core/affordance/traverse_known_threshold,root_node_id=4,nodes=4);span=unavailable;predicate_value=false"}]}}
   ```

3. **Level A offline reproduction:**
   Reproduce the failing predicate with `sk eval` and the actor/target facts:
   ```bash
   sk eval 'actor.has_capability("core/walk") && target.has_niche("core/passable_portal") && actor.has_capability("core/fly")' \
     --kind predicate \
     --facts '{"actor":{"capabilities":["core/walk"]},"target":{"niches":["core/passable_portal"]}}' \
     --format jsonl
   ```
   Returns 565 bytes with the full AST trace pinpointing node #3 (`HasCapability` for `core/fly` at span 112..113 returning `false`):
   ```json
   {"kind":"tool_result","tool":"spellkave_eval","ok":true,"details":{"ok":true,"value":{"type":"Bool","value":false},"draws":[],"trace":[{"node_id":1,"operator":"HasCapability","depth":2,"span":{"start":32,"end":33},"scope":[],"value":{"type":"Bool","value":true},"error":null,"table_entries":null},{"node_id":2,"operator":"HasNiche","depth":2,"span":{"start":76,"end":77},"scope":[],"value":{"type":"Bool","value":true},"error":null,"table_entries":null},{"node_id":3,"operator":"HasCapability","depth":2,"span":{"start":112,"end":113},"scope":[],"value":{"type":"Bool","value":false},"error":null,"table_entries":null},{"node_id":4,"operator":"And","depth":1,"span":{"start":0,"end":113},"scope":[],"value":{"type":"Bool","value":false},"error":null,"table_entries":null}]}}
   ```

4. **Apply rule correction:**
   The author edits `base/affordances.toml` to remove the unmeetable fly capability and sends the change:
   ```bash
   sk apply -k packages/spellkave-mechanics/fixtures/core
   ```
   The node configures `core/affordance/traverse_known_threshold` live.

5. **Repeat act:**
   The player attempts to traverse exit `s:exit:1` again:
   ```bash
   sk move --handle s:exit:1 --rev <rev>
   ```
   The server accepts the move. The receipt returns:
   ```json
   {"status":"dispatched","verb_class":"movement","handle":"s:exit:1","outcome":"accepted","provenance_id":"r_move:1:4"}
   ```

6. **Verify accepting evaluation record:**
   ```bash
   sk self_states --kind evaluation --provenance-id r_move:1:4 --format jsonl
   ```
   Returns 641 bytes confirming resolution:
   ```json
   {"kind":"tool_result","tool":"spellkave_self_states","ok":true,"details":{"listing":"paginated","shown":1,"matched":1,"truncated":false,"next_cursor":null,"rev":"u2-1ms0gw8","items":[{"provenance_id":"r_move:1:4","created_at_tick":1,"status":"Succeeded","subject_id":"1","selected_template_ids":["core/affordance/traverse_known_threshold","core/move_outcome","place_edge:1","selection_path:index[niche_id=core/passable_portal]","precondition:address_validity","precondition:target_existence","precondition:reachability","traversal_affordance:core/affordance/traverse_known_threshold","precondition:attachment_presence","precondition:visibility"],"draws":[],"record_kind":"Affordance","expression_ids":["core/affordance/traverse_known_threshold:predicate","core/move_outcome:outcome"]}]}}
   ```

**Operational cost:** 6 CLI tool calls, 1,718 total JSONL response bytes across evaluation/eval payloads, 0 raw SQL queries, 0 server log greps, and 0 kernel source reads.
