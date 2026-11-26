# DSL grammar

<!-- Synced by scripts/sync-grimoire-reference-docs.mjs from b4mad-technologies/sk-grimoire docs/dsl-grammar.md at commit 7c157a7978b1a568e03e5470285259390dee5574. Do not edit by hand. -->

Manifest fields whose name ends in `_source` hold Spellkave DSL text: a
predicate (a guard that is true or false) or an outcome expression. This page
lists every operator of the language. The operator entries come from
`spellkave_dsl::dsl_reference()`. The parse gate
(`crates/spellkave-dsl/tests/reference_examples.rs`) runs every DSL example
through the parser, and the eval gate (`reference_examples_eval.rs`) checks
the documented result of each one.

## Operator precedence

**`||` binds tighter than `&&`.** This is the reverse of C, Rust and
JavaScript. `a && b || c` parses as `a && (b || c)`, and `a && b && c || d`
parses as `a && b && (c || d)`.

Boolean terms cannot be put in parentheses: `(` and `)` group integer
expressions only, so `(a && b) || c` is a parse error. Write the guard so
that the flat reading is the one you mean, or split it into separate
predicates. Avoid repeating a guard on both sides of `||`: the text
`act && niche && c || act && niche && d` parses as
`act && niche && (c || act) && niche && d`, which is true only when both
`act` and `d` hold.

The test `or_binds_tighter_than_and` in `crates/spellkave-dsl/tests/corpus.rs`
proves the rule. Whether to keep or flip it is open decision
`sk-jay0.7.105.10`.

## How to read an entry

Each operator has its AST name as heading. *Expression kind* says where it may
appear: in a predicate, in an outcome expression, or in both. *Returns* is the
value type it produces. An entry marked **Not DSL text** has no parser
surface: it is written as a structured `[[consequence_frame_writes]]` row,
and its example is that row's `frame_write` value (see
[the manifest format](manifest-format.md#consequence_frame_writes)).

## Operators

### BoolLiteral

Expression kind: `predicate|outcome`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `value` | boolean literal |

- Literal true/false value.
- The bare literal parses only as a root int/outcome expression (`parse_int_expression`); as a Predicate operand it composes into a comparison, e.g. `true == true`.

Examples:

- `true`

### IntLiteral

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `value` | integer literal |

- Literal signed integer value.

Examples:

- `10`

### TextLiteral

Expression kind: `predicate|outcome`. Returns: `Text`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `value` | single-quoted text literal |

- Literal text value.

Examples:

- `'opened'`

### ReadInt

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|session\|world\|`bindings.<name>` (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`); `$event.detail.<int field>` |
| `field_id` | authored or core field id |

- Reads an integer fact supplied by the caller: `<subject>.stat('id')`, `bindings.<name>.<field>`, a bare binding name, or an int-typed `$event.detail.<field>`.
- `location` is not a number-read subject — `location.stat(...)` does not parse.

Examples:

- `actor.stat('core/strength')`

### ReadEffectiveInt

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|session\|world\|`bindings.<name>` (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `field_id` | authored or core field id |

- Reads the EFFECTIVE integer value — base fact plus active modifier composition (e.g. condition-driven modifiers). `stat` reads the base value; `effective` opts in to the composed value.

Examples:

- `actor.effective('homebrew/Momentum')`

### ReadText

Expression kind: `predicate|outcome`. Returns: `Text`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | `<subject>.substrate_id` (actor\|target\|session\|world\|`bindings.<name>`); `$event.kind` / `$event.detail.<text field>`; `<subject>.text('id')` (actor\|target\|location\|session\|world) only as a `roll_table(...)` or `.source(...)` argument |
| `field_id` | authored or core field id |

- Reads a text fact supplied by the caller. There is no general text read: only the three forms in `subject` produce a ReadText node.
- `.text('id')` is not a free-standing expression — it parses only inside the id argument of `roll_table(...)` or `<subject>.source(...)`.

Examples:

- `$event.detail.speech_act`

### ReadBool

Expression kind: `predicate|outcome`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|location\|session\|world (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `field_id` | authored or core field id |

- Reads a boolean fact supplied by the caller via `<subject>.state('id')`.
- Inside a macro body, a Bool-typed macro parameter name also reads as a ReadBool.

Examples:

- `target.state('is_open')`

### ReadResourceMax

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|session\|world\|`bindings.<name>` (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `field_id` | resource_definition_id |

- Reads the EFFECTIVE per-entity MAX bound for a resource — an `entity_resource_bound` override for the subject wins, else the bundle-wide `resource_definition.max_value` (#30 / sk-ct8.2).

Examples:

- `actor.resource_max('srd/hp')`

### ReadResourceMin

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|session\|world\|`bindings.<name>` (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `field_id` | resource_definition_id |

- Reads the EFFECTIVE per-entity MIN bound for a resource. Sibling of `ReadResourceMax`.

Examples:

- `actor.resource_min('srd/hp')`

### HasCapability

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|location\|session\|world (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `capability_id` | capability definition id |

- Checks capability membership in the subject fact pool.

Examples:

- `actor.has_capability('core/open')`

### HasItem

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|location\|session\|world (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `item_def_id` | item definition id |

- Checks item membership in the subject fact pool.

Examples:

- `actor.has_item('core/torch')`

### HasNiche

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|location\|session\|world (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `niche_id` | niche definition id |

- Checks niche membership in the subject fact pool.

Examples:

- `target.has_niche('core/container')`

### HasTag

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|location\|session\|world (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `tag` | opaque authored tag |

- Checks relational instance and definition tags supplied by the caller.

Examples:

- `target.has_tag('locked')`

### SharesTag

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject_a` | actor\|target\|location\|session\|world |
| `subject_b` | actor\|target\|location\|session\|world |
| `prefix` | opaque authored tag-id prefix |

- True iff the two subjects each carry a tag starting with the prefix and those prefix-filtered tag sets intersect.
- Content-neutral set-intersection over the two subjects' tag pools — an open authored tag family, never a closed column.

Examples:

- `shares_tag(actor, target, 'actor.language.')`

### HasStatus

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|location\|session\|world (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `condition_definition_id` | condition definition id |

- Checks active condition/status membership.

Examples:

- `actor.status('core/poisoned') == true`

### ImpliedByCount

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `condition_definition_id` | optional condition definition id; absent means current candidate |

- Reads a kernel-pre-populated count of other active rows whose definitions imply the child condition.
- The evaluator never reads database tables; empty context returns 0.

Examples:

- `implied_by_count('core/condition/incapacitated') == 0`

### ParticipantTagGroupCount

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `prefix` | opaque authored tag-id prefix |
| `excluding_condition_definition_id` | optional condition definition id |

- Reads a kernel-pre-populated count of distinct matching tag values among session participants.
- A missing pre-populated fact is an evaluation error, never a silent zero.

Examples:

- `participant_tag_group_count('side:', 'core/condition/unavailable') <= 1`

### PeersNearTarget

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `prefix` | opaque authored tag-id prefix |
| `radius_mm` | authored radius in millimeters |
| `excluding_condition_definition_id` | optional condition definition id |

- Reads a kernel-pre-populated count of actors other than Actor and Target within radius_mm of Target that share >=1 prefix-prefixed tag with Actor and do not carry the excluding condition.
- The evaluator never reads database tables or computes geometry; a missing pre-populated fact is an evaluation error, never a silent zero.

Examples:

- `peers_near_target('srd.faction.', 1524, 'srd/condition/incapacitated') >= 1`

### OccupantsAt

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `scope` | node scope: to_node or from_node on the traversal path, target on the manipulate / resolution path |
| `excluding_condition_definition_id` | optional condition definition id |

- Reads a kernel-pre-populated count of actors other than Actor standing on the scoped place node that do not carry the excluding condition (ADR-0134 D-3).
- The evaluator never reads database tables; a scope the current path did not populate is an evaluation error, never a silent zero.

Examples:

- `occupants_at('to_node', 'srd/condition/dead') == 0`

### ChannelPool

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `channel_id` | economy_channel_definitions.id |

- Reads the authored pool_ms_per_round constant of an economy channel.
- A missing kernel-pre-populated fact is an evaluation error, never a silent zero.

Examples:

- `channel_pool('core/action_class/primary')`

### TracePresent

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|location\|session\|world (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `trace_kind_id` | trace kind id |

- Checks whether a trace kind is present for the subject.

Examples:

- `target.trace('core/opened')`

### KnowsEntity

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\|target\|location\|session\|world (chains `actor.wielded_item.…` / `actor.equipped_item('<slot>').…`) |
| `entity_id` | quoted entity-id string or `$bindings.<name>` |

- The entity_id argument is the entity-id-typed binding surface: a single-quoted string or a `$bindings.<name>` path. A bare numeric id does not parse.

Examples:

- `actor.knows_entity($bindings.required_entity_id)`

### And

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `operands` | two or more bool node ids |

- Short-circuits to false when any operand is false.
- Binds LOOSER than `||`: `a && b || c` parses as `a && (b || c)`. Boolean terms cannot be parenthesised (decision `sk-jay0.7.105.10`).

Examples:

- `actor.has_capability('core/open') && target.has_tag('locked')`

### Or

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `operands` | two or more bool node ids |

- Short-circuits to true when any operand is true.
- Binds TIGHTER than `&&`: `a && b || c` parses as `a && (b || c)`. Boolean terms cannot be parenthesised (decision `sk-jay0.7.105.10`).

Examples:

- `target.has_tag('door') || target.has_tag('chest')`

### Not

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `operand` | bool node id |

- Negates one boolean operand.

Examples:

- `target.has_tag('sealed') == false`

### Compare

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `op` | Eq\|Ne\|Lt\|Lte\|Gt\|Gte |
| `left` | bool\|int\|text node id |
| `right` | same value type as left |

- Both operands must have the same comparable value type.

Examples:

- `actor.stat('core/strength') >= 10`

### Arithmetic

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `op` | Add\|Sub\|Mul\|Div\|Max\|Min |
| `left` | int node id |
| `right` | int node id |

- Division by zero is rejected at evaluation time.

Examples:

- `max(actor.stat('core/strength'), 2)`

### Cond

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `cond` | bool node id |
| `then_node` | int node id |
| `else_node` | int node id |

- Evaluates the bool, then exactly one int branch (lazy).

Examples:

- `cond(d20 >= 13, 0, 0 - d6)`

### Roll

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `dice` | <count>d<sides> |

- Uses the caller-provided deterministic evaluation RNG.
- Single-die rolls (count == 1) consult the acting entity's composed roll bias (conditions with modifier delta_kind Advantage/Disadvantage/Plus): Advantage draws the die twice and keeps the max, Disadvantage the min, and BOTH physical faces are recorded individually in evaluation provenance.

Examples:

- `1d20`

### RollUnder

Expression kind: `predicate`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `dice` | die token (`d20`, `1d20`, `2d6`) — not an arbitrary int expression |
| `target` | int expression |

- Compares a roll result against a target number. The first argument must be a literal die token; the parser synthesizes the Roll node from it.
- Consults the composed roll bias; success is a LOWER roll here, so Advantage keeps the min of two draws (the favorable direction flips relative to Roll).

Examples:

- `roll_under(1d20, actor.stat('core/dexterity'))`

### RollTable

Expression kind: `outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `table_id` | quoted roll table id or `<subject>.text('state_id')` |

- Takes exactly one argument; the parser synthesizes the internal draw node.
- Draws from an authored roll table; only the int-drawing form is parseable — there is no Outcome-returning form.
- Int-valued draws consult the composed roll bias (Advantage re-draws and keeps the max, Disadvantage the min).

Examples:

- `roll_table('core/random_event')`

### DslSource

Expression kind: `predicate|outcome`. Returns: `Int`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `subject` | actor\\|target\\|location\\|session\\|world\\|binding\\|actor.wielded_item\\|actor.equipped_item('<slot>') |
| `slot` | item DSL-source slot id |

- Evaluates `subject`'s named DSL-source slot inline, against the SAME actor/target fact context as the calling expression (sk-84i.2, widened G-1).
- Fails closed when the subject carries no matching item_dsl_source fact for the slot (ADR-0035).
- actor.equipped_item('<slot>') selects exactly one existing item in the actor's authored equipment slot (ADR-0126); missing, dangling, or duplicate occupancy supplies no item facts, with no carried-item fallback.
- The equipment-slot argument is a nonempty literal referencing an admitted equipment slot. This subject supports tags, integer/text state, and source reads; it does not add equipment effective-state, status, or resource-bound reads.
- The slot's own source may not itself call `.source(...)` again — depth-limited to 1, fails closed on violation.
- The inner expression's stochastic draws are charged against the SAME evaluation-wide draw budget as the caller (ADR-0059).

Examples:

- `actor.wielded_item.source('srd/damage')`
- `actor.equipped_item('demo/main-hand').source('demo/damage')`

### Let

Expression kind: `predicate|outcome`. Returns: `Bool`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `name` | binding name |
| `value` | int expression |
| `body` | bool or int expression |

- Introduces a lexical binding for the body node.
- Returns the type of its body: Bool for a predicate body (as in the example), Int for an int body. The bound value is always an int expression.

Examples:

- `let difficulty = 10 ; 1d20 >= difficulty`

### OutcomeSequence

Expression kind: `outcome`. Returns: `Outcome`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `steps` | one or more outcome expressions (`sequence`, `invoke_outcome_graph`, `arbitrate`, …) |

- Outcome DSL text in `outcome_templates.outcome_expression_source`; the server runs the steps in authored order.

Examples:

- `sequence(invoke_outcome_graph('core/open_container'), invoke_outcome_graph('core/emit_noise'))`

### InvokeOutcomeGraph

Expression kind: `outcome`. Returns: `Outcome`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `outcome_graph_id` | quoted outcome graph id |

- Outcome DSL text in `outcome_templates.outcome_expression_source`; delegates to an authored `[[outcome_graphs]]` graph.

Examples:

- `invoke_outcome_graph('core/open_container')`

### ModifyResource

Expression kind: `outcome`. Returns: `Outcome`.

**Not DSL text.** It has no parser surface and cannot appear in a `_source` field. The live write is a structured `[[consequence_frame_writes]]` row; the example below is that row's `frame_write` value.

| Arg | Shape |
|---|---|
| `actor` | binding ref of the entity whose resource changes, e.g. `Actor` |
| `resource` | resource definition id |
| `delta_source` | DSL int expression evaluated at apply time (`-3`, `0 - d6`, `cond(...)`) |

- The `Op::ModifyResource` AST node has no parser surface; `modify_resource(...)` in DSL text does not parse.
- Author a `[[consequence_frame_writes]]` row whose `frame_write` is `{ ModifyResource = { actor, resource, delta_source } }`.

Examples:

- `{ ModifyResource = { actor = "Actor", resource = "core/hp", delta_source = "-3" } }`

### ApplyStatus

Expression kind: `outcome`. Returns: `Outcome`.

**Not DSL text.** It has no parser surface and cannot appear in a `_source` field. The live write is a structured `[[consequence_frame_writes]]` row; the example below is that row's `frame_write` value.

| Arg | Shape |
|---|---|
| `target_kind` | entity\\|item\\|world_object |
| `target_ref` | binding ref of the target, e.g. `Actor` or `Target` |
| `condition_definition_id` | condition definition id |
| `expires_at_boundary` | optional `{ boundary_id, owner_actor }` |

- The `Op::ApplyStatus` AST node has no parser surface; `apply_status(...)` in DSL text does not parse.
- Author a `[[consequence_frame_writes]]` row whose `frame_write` is `{ ApplyStatus = { target_kind, target_ref, condition_definition_id } }`.

Examples:

- `{ ApplyStatus = { target_kind = "entity", target_ref = "Target", condition_definition_id = "core/poisoned" } }`

### EmitTrace

Expression kind: `outcome`. Returns: `Outcome`.

**Not DSL text.** It has no parser surface and cannot appear in a `_source` field. The live write is a structured `[[consequence_frame_writes]]` row; the example below is that row's `frame_write` value.

| Arg | Shape |
|---|---|
| `kind` | trace kind id |
| `location_kind` | where the trace lands, e.g. `binding` |
| `location_ref` | binding ref of the location, e.g. `ActorSpatialRef` |
| `payload_json` | JSON payload string |

- The `Op::EmitTrace` AST node has no parser surface, and there is no `EmitTrace` frame write.
- The trace write is the `Inscribe` frame write: a `[[consequence_frame_writes]]` row whose `frame_write` is `{ Inscribe = { kind, location_kind, location_ref, payload_json } }` (optional `expires_at_tick`, `expires_after_ticks`, `carry_dispatch_text`, `carry_addressee`, `carry_dispatch_options`, `carry_occurrence`, `carry_dispatch_context`).
- `carry_dispatch_options` copies bounded `dispatch_options` labels as `options` and parallel optional `dispatch_option_refs` as `option_definition_refs` (null means no description). References are exact static authored ids, never eligibility-derived.
- `carry_dispatch_context` copies the dispatch's `dispatch_context` (one JSON object sent as text, at most 8 KiB) onto the payload under `context`. The kernel checks only that it is an object within the bound and reads no key of it; it is presentation content for readers of the trace, and no prompt binding, response set or predicate depends on it. A speaker uses it for the machine side of a question (see [guided dialogue](patterns/guided-dialogue.md)).
- `carry_occurrence` copies only the admitted occurrence id into answer history as a decimal string; unbound actions omit it. Response tags `ui.response-slot=<positive integer>` identify syntax without parsing action ids or labels. See [the carriage contracts](interaction-dsl-and-world-authoring.md#recording-an-answered-occurrence-carry_occurrence).

Examples:

- `{ Inscribe = { kind = "core/opened", location_kind = "binding", location_ref = "ActorSpatialRef", payload_json = "{}" } }`

### Arbitrate

Expression kind: `outcome`. Returns: `Outcome`.

Written as DSL text.

| Arg | Shape |
|---|---|
| `request_shape_id` | quoted arbitration request shape id |
| `context` | one quoted `fact_id=value` string |
| `allowed_outcomes` | one or more quoted `outcome_id=outcome_graph_id` strings |

- Outcome DSL text in `outcome_templates.outcome_expression_source`; opens an arbitration request with bounded allowed outcomes.
- Every argument is a single-quoted string; a malformed `fact_id=value` or `outcome_id=outcome_graph_id` pair fails at execution time.

Examples:

- `arbitrate('core/dialogue_choice', 'mood=tense', 'agree=core/dialogue/agree', 'refuse=core/dialogue/refuse')`
