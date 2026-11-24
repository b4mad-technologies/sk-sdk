# Long-running actions, busy policy, and resumable progress

How to author actions that take real in-world time — rituals, crafting,
travel, rests — and control what their actor may do while occupied.

## The promotion rule (§5.10): you author a cost, the kernel picks the shape

Any `action_definitions` row with `cost_time_ms > 5000` (strictly greater;
5000 itself stays flat) is **auto-promoted** at submission time: instead of
committing its consequence immediately, the kernel opens a session and the
consequence lands when the session completes. You never choose between
"frame action" and "session" for a long action — the cost declares the
fiction, the kernel decides the shape. The validator warns on every row
that crosses the threshold and names the session definition the promotion
will resolve (`session_def_id` if you set one, else
`core/long_running_action` from the core bundle).

Fiction time is measured in **world ticks**, converted once at promotion:
`duration_ticks = ceil(cost_time_ms / fiction_ms_per_tick)`, minimum 1.
The default calibration is `fiction_ms_per_tick = 6000` — one 5e combat
round (6 s) per tick — so `cost_time_ms = 600000` (10 fiction minutes)
runs for 100 ticks. Keep flavor-only durations ("this takes a moment") at
flat-action scale (hundreds to low thousands of ms) and narrate longer
times in `display_name`/description text; author a real cost only when the
action should genuinely occupy its actor.

## What the actor may do meanwhile: the busy policy

While the promoted session is active the actor is flagged busy
(`busy_in_session_kind` = the session definition id). Every action the
busy actor attempts gets exactly one of three verdicts, in this order:

1. **allowed** — the attempt matches the session definition's
   `busy_allow_pred`.
2. **session-breaking** — it matches `busy_break_pred`: the busy session
   closes with outcome `abandoned` (abort semantics below), then the
   attempted action proceeds.
3. **rejected** — everything else, with rejection kind `busy_in_session`.

Both predicates are optional DSL predicates on `session_definitions`,
evaluated against the *attempted* action: its authored tags are visible as
`target.has_tag("...")` and its id as `target.text('action_id')`.
**Author neither predicate and you get the default: full block** — the
only always-allowed move is the actor's own `r_session_close` (give up).

Worked shapes:

```toml
# A rest: light activity allowed, hostilities end it.
[[session_definitions]]
session_def_id = "mybundle/long_rest"
busy_allow_pred = "target.has_tag('light_activity')"
busy_break_pred = "target.has_tag('attack')"
# ... plus round_duration_ms = 6000 and a termination predicate, see below.
```

- **Ritual** — author nothing: full block, only abort escapes.
- **Concentration** — broad `busy_allow_pred`, so the actor moves and
  fights while the effect holds.
- **Travel** — allow perception/talk tags, break on hostile contact.

## How the session ends

`core/long_running_action` (shipped in `packages/spellkave-mechanics/fixtures/core`) is a solo
`Sequential` session with `round_duration_ms = 6000` and this authored
termination predicate — plain DSL reads, no special machinery:

```toml
termination_pred = "world.tick - session.stat('opened_at') >= session.stat('promoted_duration_ticks')"
```

Each world tick advances the solo session's turn, the predicate is
re-evaluated, and at expiry the session terminates `completed`. These
clock-only Sequential sessions (`core/long_running_action` and a bundle's
own long-running-move session, e.g. `core/long_running_move` or
`srd/long_running_move`) author an empty `turn_scheduler_id` on purpose:
the heartbeat still fires TurnStart/termination without pretending this
is initiative combat (#2232). Combat Sequential sessions still need a
real scheduler. Terminal
consequences then fire in binding order: the session definition's
`on_terminate` first (if authored), then the **originating action's**
`on_success` — the same consequence a short action would have applied
instantly, just N ticks later. On abort (`abandoned`, whether explicit or
via `busy_break_pred`) the action's `on_failure` fires instead, when
authored; `on_success` never fires on an aborted run. To give a long
action bespoke busy policy, point its `session_def_id` at your own
session definition — reuse the same termination predicate.

## Interrupted work: progress and the perceivable trace

Aborting a promoted session records what was done:

- an `interrupted_action_credit` row (actor, action, target, `progress_ticks` =
  elapsed ticks, capped at the promoted duration) that **expires** 1000
  ticks after recording, and
- a trace of the authored kind `core/interrupted_work` at the target,
  tagged with the originating action id — co-located actors can *see*
  the half-drawn ritual circle.

Resumption is **opt-in per action**: set `resumable = true` on the
`action_definitions` row and the next promotion of the same action by the
same actor on the same target consumes the unexpired progress row and
shortens the new session by `progress_ticks` (100-tick craft aborted at
60 → resumes as 40). Leave `resumable` unset (default `false`) for
actions that must restart from zero — an interrupted long rest grants
nothing.

Authoring surface note: all three fields have first-class verbs —
`resumable` on `spellkave_define_action`, `busy_allow_pred` /
`busy_break_pred` on `spellkave_define_session` (which also covers
termination predicates, turn scheduling, and grid wiring; see the generated
[tool-reference](./tool-reference.md)). `spellkave_write_rows` remains the
schema-driven escape hatch for anything else.
