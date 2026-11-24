# Action economy: channels, boundaries, and fiction time

Spellkave meters an action in **fiction milliseconds**. A channel is an
authored per-round pool, not a count of named actions: an action or affordance
chooses a channel with `spends_channel`, and its `cost_time_ms` draws time from
that pool.

## Define a channel and its boundary

Declare the named boundary first, then the channel which refreshes on it. The
engine fires `turn_start` and `turn_end` both for session rotation and, outside
a session, on fiction-time window rollover; other declared boundaries are
available to authored `FireBoundary` consequences. Either core boundary works
as a `resets_on` target in both modes.

```toml
[[boundary_definitions]]
id = "turn_start"
bundle_id = "mybundle"

[[economy_channel_definitions]]
id = "mybundle/channel/primary"
bundle_id = "mybundle"
pool_ms_per_round = 6000
resets_on = "turn_start"
off_turn_eligible = false
```

`pool_ms_per_round` is the channel's base pool. The active window belongs to
the actor whose boundary fired. In a timed session, rotation fires those
boundaries. Outside a session, fiction-time window rollover refreshes an
actor's spend; it is not necessary to manufacture a global turn just to make
time pass.

Outside a session, crossing the window boundary is the **only** thing that
fires `turn_end` — emptying a pool does not (the sessionless boundary driver,
the world API).
An actor may enter the next round with budget left over, which is the normal
case when play is not turn-based.
This matters when you hang a round-scoped effect off `turn_end` (a
concentration-style condition, say): it expires when the clock says the round
ended, never because the actor happened to spend everything. On rollover the
outgoing window's `turn_end` fires before the incoming window's `turn_start`,
the same order rotation uses.

## Attach a cost

Set `spends_channel` on the affordance/action edge and give the action a
fiction-ms cost:

```toml
[[affordance_templates]]
template_id = "mybundle/affordance/strike"
bundle_id = "mybundle"
# other required affordance fields omitted
spends_channel = "mybundle/channel/primary"

[[action_definitions]]
action_id = "mybundle/strike"
bundle_id = "mybundle"
# other required action fields omitted
cost_time_ms = 3000
spends_channel = "mybundle/channel/primary"
```

An action which names a channel but omits `cost_time_ms` (or gives it `0`)
spends one full pool from that channel. This is the useful default for an
indivisible once-per-window action. An action with no `spends_channel` is
unmetered; it does not consume a pool or participate in the action-economy
gate.

The channel id is an open authored id, not a closed action-class enum. Keep
the same id on the affordance that is selected and the action that commits it.

## Modify an effective pool with a condition

The effective pool is the channel's authored `pool_ms_per_round` plus every
active numeric `modifier_templates` contribution that targets that channel id.
This keeps haste-like effects declarative: author the condition and its normal
modifier template, target `mybundle/channel/primary`, and expiry removes the
modifier when the condition ends. Do not create a second channel merely to
represent a temporary bonus.

## Grant one-shot extra budget with `ModifyChannel`

The condition route above is *standing* — recomputed at every gate for as long as
the condition holds. For a **one-shot** adjustment scoped to the acting entity's
current round window, `ModifyChannel` is a consequence-frame write. This is the
shape an Action-Surge-like ability wants: one extra action, this round, then gone.

```toml
[[consequence_frame_writes]]
template_id = "mybundle/ability/second_wind_of_action"
ordinal = 0
frame_write = { ModifyChannel = { actor = "Actor", channel = "mybundle/channel/primary" } }
```

- `channel` must resolve to an `economy_channel_definitions` row. A typo'd id is
  flagged (MF-VAL-312) once the full bundle `depends_on` closure is present —
  `manifest validate --bundle --dep …` or a live-published world; a lone-file
  `validate` pass without that closure trusts an unresolved channel id rather
  than rejecting it, mirroring `ModifyResource`'s own scoped-reference posture.
- `delta_source` is optional. Omit it and the actor is granted exactly **one full
  `pool_ms_per_round`** of the named channel, mirroring the convention that an
  unauthored cost is a full pool. Supply it and it is an authored DSL **Int**
  expression evaluated at apply time — a constant (`"-500"`), a roll, or a
  `channel_pool('<id>')` read.
- The delta is **signed**: a negative value removes budget.
- Two grants in the same window are **additive**. On window rollover the grant is
  overwritten, never summed against the previous round — so a grant cannot leak
  into the next round (the world API).

**Grants do not override suppression.** The grant adjusts the authored pool
*first*, and active condition modifiers fold over the result *last*. A condition
that sets a channel to zero (`FlatSet(0)` — how an incapacitating condition is
normally expressed) therefore wins outright over any positive grant, while a
plus-shaped modifier still stacks on top of the granted base. Do not author a
negative grant to represent "this condition takes the action away": a grant is
window-scoped and evaporates at the next refill, whereas the modifier route is
recomputed at gate time and is refill-proof. See
[condition capability grant and suppression](./repairs/condition-capability-grant-and-suppression.md).

The generated [manifest reference](./manifest-format.md) is the exact source for
the currently admitted write shape.

## Fire a custom boundary

`FireBoundary` is a consequence-frame write. It fires one declared boundary
for one owner, so it can refresh only that owner's matching channels, recharges,
and boundary-driven autonomy. Use it for fiction that establishes an actual
boundary (for example, completing a ritual phase), not as a generic reset
button:

```toml
[[consequence_frame_writes]]
template_id = "mybundle/ritual/complete"
ordinal = 0
frame_write = { FireBoundary = { boundary_id = "mybundle/ritual_phase_end", scope = "Actor" } }
```

The `boundary_id` must resolve to `boundary_definitions`. `scope = "Actor"`
fires for the acting owner; use the schema-defined scope deliberately rather
than treating a boundary as a world-wide reset. The generated
[manifest reference](./manifest-format.md) is the exact source for the
currently admitted write shape.

## Boundary-relative expiry and autonomy

Boundary-relative condition expiry is available on an `ApplyStatus` frame
write. Set `expires_at_boundary` to a `boundary_id` and an `owner_actor`,
meaning “end when this owner's named boundary next fires.” The owner is a
single-actor frame binding such as `Actor` or `TargetActor`; it is resolved
when the condition is applied.

```toml
[[consequence_frame_writes]]
template_id = "mybundle/stance/apply"
ordinal = 0
frame_write = { ApplyStatus = { target_kind = "entity", target_ref = "Actor", condition_definition_id = "mybundle/guarded", expires_at_boundary = { boundary_id = "turn_start", owner_actor = "Actor" } } }
```

The expiry is armed for that owner only. It is removed when that owner's
boundary fires through session rotation, out-of-session round-window rollover,
or an authored `FireBoundary`; another actor's boundary cannot expire it.
Tick-absolute `expires_at_tick` remains available and can compose with this
mode. Do not use the retired `condition.lifecycle` field.

Autonomy already has two mutually exclusive firing modes in an
`autonomy_jobs` row:

- Absolute fiction time: set `next_fire_at_ms` and a positive `frequency_ms`.
- Owner boundary: set `fire_at_boundary` and `owner_actor`; do not also set
  `next_fire_at_ms`.

The boundary mode is actor-owned just like a channel refresh. A different
actor's turn, window rollover, or explicit `FireBoundary` cannot make an
owner's job fire.

## Observe the result

For the acting PLAYER, `spellkave_self_states` with `kind: "economy_budget"`
reads the current actor-scoped channel budget, including active condition
modifiers and window-local grants. Use this projection to decide whether a
priced action is currently affordable. Spend history alone cannot reconstruct
the effective pool after a grant, suppression, or window refresh. The server
still evaluates the action at dispatch; a prior read does not reserve budget.

The projection uses the condition evaluator's current facts, including gate
predicates, rather than a separate client-side approximation. No additional
authored rows are needed to expose an actor's existing channel definitions,
grants and spends through this PLAYER read.

`spellkave turn inspect <actor>` shows the live channel-spend state and
`spellkave events` shows the surrounding world events. The typed operational
vocabulary is `ChannelSpend`, `ChannelWindowRefresh`, and `BoundaryFired`:
the first records time drawn from a channel, the second records its refreshed
window, and the third identifies the boundary, owner, and source that caused
the refresh. Use `spellkave doctor` to detect unresolved channel references or
malformed recharge state. The client does not reconstruct a past effective
pool from the current condition snapshot.
