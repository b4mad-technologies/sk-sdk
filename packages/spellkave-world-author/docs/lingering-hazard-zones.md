# Lingering hazard zones (caster-attributed pulses)

How to author a hazard zone — *Cloudkill*, *Stinking Cloud*, *Web*, *Spike
Growth* — that damages whoever stands in it **each round on its own**, for a
bounded duration, then fades. No player re-casts every turn; the zone pulses
itself.

> **Binding decision:** ADR-0054 — Caster-attributed autonomy jobs.
> Substrate concept: [autonomy-jobs](../../../docs/data-model-concepts/autonomy-jobs.md).
> The worked example below is the **historical** `srd` Cloudkill — the prose
> and TOML shape are still correct (ranged placement via `anchor_place_node_id`,
> the liveness-policy choice), but every artifact it cites is now archived:
> `packages/spellkave-srd` was retired to `archive/packages/spellkave-srd/`
> (`world-fixtures-retirement`, 2026-08-11, `sk-mts`) and its Tier-3 live proof
> (`archive/packages/spellkave-srd/src/test/live-preseeded/zones.ts`,
> `cloudkill_schedules_a_bounded_self_pulsing_zone`) no longer runs against this
> tree; the original Rust `client/tests/cloudkill_lingering_zone.rs` it was
> ported from is gone outright (deleted per #1219, not merely archived). The
> live `srd-cc` Cloudkill (`packages/spellkave-srd-cc/fixtures/base/spells/level-5/cloudkill.toml`)
> is identity-only — it does not author the self-pulsing shape this page
> describes. **Live examples of the cast-scheduled shape** (a cast that
> inscribes the marker and schedules a `ScheduleAutonomyJob` pulse with a
> per-cast `source`) are the srd-cc Moonbeam and Spike Growth:
> `packages/spellkave-srd-cc/fixtures/base/spells/level-2/moonbeam.toml`
> (`srd/spell/moonbeam/schedule`, `srd/spell/moonbeam/pulse`) and
> `packages/spellkave-srd-cc/fixtures/base/spells/level-2/spike-growth.toml`.
> **For the no-cast shape** (a subject-bound `[[autonomy_jobs]]` row plus a
> `ForEachActorInRadius` → `ModifyResource` pulse), see
> ["A manifest-authored hazard (no cast)"](#a-manifest-authored-hazard-no-cast)
> below — `packages/spellkave-mechanics/fixtures/mech_burning_room`,
> generated (not hand-authored) and checked for byte-identical regeneration
> by `pnpm --filter @spellkave/mechanics run generate:check`.

## The shape

A lingering hazard is **two** authored pieces plus the existing autonomy
scheduler:

1. **The cast** schedules a bounded recurring job that carries its caster.
2. **The pulse** is a subject-bound `consequence_template` that fans damage over
   the zone's occupants. The autonomy scheduler re-fires it each round until it
   expires.

Why "caster-attributed"? The world clock has no acting subject of its own, so it
may not reach actors (ADR-0004 / ADR-0041 — *"the clock killed the goblin"* is
forbidden). The fix is **provenance**: the job stores its caster, fires in a
*non-ambient* context, and every pulse is attributed to that caster. The fence is
satisfied, not relaxed.

## 1. The cast schedules the job

Your cast action's success `consequence_template` references an
`effect_definition` whose primitive is `ScheduleAutonomyJob`. At reducer time the
scheduler captures the casting frame's actor into `autonomy_job.subject` **and**
the cast's resolved target cell into `autonomy_job.anchor_place_node_id` (ADR-0055).

The same `success` consequence ALSO inscribes the lingering marker
(`Inscribe { kind = "spatial_environment_state" }`) — the marker write must stay
on the cast, because the autonomy fire-time fence admits only
`ForEachActorInRadius` / `ModifyResource` / `ApplyStatus` frame writes on the
clock (no `Inscribe`; `AUTONOMY_ELIGIBLE_FRAME_WRITES`,
`crates/spellkave-validate/src/autonomy_jobs.rs`).

```toml
[[consequence_templates]]
template_id     = "srd/cast_cloudkill/success"
effect_refs_csv = "srd/cast_cloudkill/schedule"

[[effect_definitions]]
effect_def_id  = "srd/cast_cloudkill/schedule"
primitives_csv = "ScheduleAutonomyJob"
# repeats_remaining bounds the duration (10 rounds); requires_subject_alive picks
# the liveness policy (see below). fires_at_ms is an ABSOLUTE fiction time
# (ScheduleAutonomyJobParams, schedule_autonomy_job.rs), not an offset from the
# cast: 6000 is already past in any running world, so the first pulse fires on
# the next world tick after the cast. The {Actor}/{tick} placeholders in `source`
# are interpolated at cast time (ADR-0055 D-3) so two casters — or one caster
# re-casting — each get a distinct job_id instead of colliding on the PK.
parameters_schema_json = '{"dsl_function":"srd/cast_cloudkill/pulse","fires_at_ms":6000,"payload_json":"{}","source":"srd/cloudkill/{Actor}/{tick}","frequency_ms":6000,"repeats_remaining":10,"requires_subject_alive":false,"priority":0}'
```

> **Per-cast `source` (ADR-0055 D-3).** `job_id` is derived as
> `"<dsl_function>/<source>/<firing_key>"`, where the firing key is
> `at-ms-<fires_at_ms>` (or `boundary-<boundary>-owner-<owner_actor>` for a
> boundary-relative job) — `build_runtime_job` / `resolve_firing_mode` in
> the world API.
> A static `source` makes two
> concurrent casts collide on the primary key, capping the world at one live
> instance per spell. Author `source` with an `{Actor}`, `{ResponsibleSubject}`,
> or `{tick}` placeholder and the scheduler interpolates it at cast time —
> identity still lives in the typed `subject` column, the string is only the
> cancel/provenance key.

## 2. The pulse damages occupants

The scheduled `dsl_function` resolves to a `consequence_template` whose frame
write is a `ForEachActorInRadius` carrier fanning a `ModifyResource` leaf over
each occupant. The carrier rebinds `Actor` to each occupant per leaf while the
caster stays the responsible subject. **You choose where the zone centers** via
`center_ref`:

| `center_ref` | Behaviour | Use for |
|---|---|---|
| `"TargetSpatialRef"` | the zone stays fixed on the **cast cell** (the captured anchor, ADR-0055), independent of where the caster moves | *Cloudkill* dropped on a distant cell |
| `"ActorSpatialRef"` | the zone **follows the caster** (re-centers on the caster's current cell each fire) | a mobile aura |

The srd Cloudkill anchors on the cast cell with `"TargetSpatialRef"` — it resolves
to the `anchor_place_node_id` captured at cast time, so the cloud lands on, and
stays on, the targeted cell rather than drifting with the caster. The damage is the
real SRD payload, not a flat surrogate: 5d8 poison, CON save for half, with the save
folded into the `delta_source` `cond` (the proven save-for-half shape —
`predicate_source = ""` means every occupant is hit, the save halves inside the
expression). The radius collapses to the single cell (`core/area/node_ball`,
`ball_radius = 0`), so the cloud is node-local.

```toml
[[consequence_templates]]
template_id = "srd/cast_cloudkill/pulse"

[[consequence_frame_writes]]
template_id = "srd/cast_cloudkill/pulse"
ordinal     = 0
frame_write = { ForEachActorInRadius = { center_ref = "TargetSpatialRef", shape_id = "core/area/node_ball", shape_params_json = '{"ball_radius": 0}', predicate_source = "", body = [ { ModifyResource = { actor = "Actor", resource = "srd/hp", delta_source = "cond(d20 >= 15, 0 - (5d8 / 2), 0 - 5d8)" } } ] } }
```

### What the substrate allows on the autonomy clock

A subject-bound job may fire only a **minimal** actor-reaching set — `Damage`,
`Heal`, `ApplyModifier` (as `EffectPrimitive`s) and the hazard
`consequence_template` shape above: `ForEachActorInRadius` carriers with
`ModifyResource` or `ApplyStatus` leaves. `ApplyStatus` was admitted by
ADR-0064 (#958, noted in the ADR-0054 header) for per-round condition pulses;
the srd-cc Caltrops (Speed 0) and Ball Bearings (Prone) pulses rely on it, and
so do their Monster Death / PC Unconscious carriers. A template may carry
several such carriers. Where the check runs depends on who scheduled the job:

- A manifest-authored `[[autonomy_jobs]]` row is checked **at authoring
  time** by the validator (`validate_autonomy_jobs`,
  `crates/spellkave-validate/src/autonomy_jobs.rs`), and again at fire time.
- A pulse scheduled by a cast (`ScheduleAutonomyJob`) is **not** checked
  against this list when you author it or when the cast schedules it (the
  schedule-time `validate_autonomy_job` checks only ids, source, and firing
  mode). The kernel checks it only at fire time
  (`dispatch_authored_effect`, the world API), where a violation
  disables the job.

The rules:

- `PossessBody` is never allowed (possession on the clock is forbidden).
- `Spawn` / `Despawn` carry their target in params and stay ineligible.
- A subjectless (ambient) job may fire only `InscribeTraceCluster`.
- A subject-bound actor-reaching job **must** be bounded
  (`repeats_remaining = Some(_)`) — an endless self-pulsing damage zone is
  rejected.

## 3. Liveness policy — `requires_subject_alive`

You choose what happens to the zone when its caster leaves:

| Value | Behaviour | Use for |
|---|---|---|
| `false` | zone keeps pulsing for its full `repeats_remaining`, attributed to the (now-absent) caster | *Cloudkill* — persists regardless of caster |
| `true`  | dispatcher deletes the job (zone dissipates) once the caster is gone | *Stinking Cloud*, *Web* — concentration-style |

> ⚠️ **"Alive" means "present", not "not HP-dead".** Death is **not** a server
> concept — `srd/hp` is just an authored number the kernel never interprets. So
> `requires_subject_alive = true` dissipates the zone when the caster's `entity`
> row is **despawned/removed**, *not* when its HP hits zero while the body
> remains. Coupling dissipation to true HP-death needs a future authored liveness
> predicate (ADR-0054 D-5, Known Gaps). For now, despawn the dead caster, or
> accept that concentration zones outlive a downed-but-present caster.
>
> The first authored liveness predicate exists for **turn order**, not for
> zones: a session's `turn_eligibility_pred` (ADR-0143) decides who is handed
> the turn, with a ruleset macro such as "not Dead"
> ([`leave-session-relocates`](./repairs/leave-session-relocates.md)). It is
> not wired to `requires_subject_alive`; that dispatcher still reads presence.

## Concentration sibling

The same shape with `requires_subject_alive = true` is the concentration variant
(illustrative — the srd-cc Stinking Cloud is identity-only and does not author
this shape; only the ids change from Cloudkill, and `source` stays per-cast as
the note above requires):

```toml
[[effect_definitions]]
effect_def_id  = "srd/cast_stinking_cloud/schedule"
primitives_csv = "ScheduleAutonomyJob"
parameters_schema_json = '{"dsl_function":"srd/cast_stinking_cloud/pulse","fires_at_ms":6000,"payload_json":"{}","source":"srd/stinking_cloud/{Actor}/{tick}","frequency_ms":6000,"repeats_remaining":10,"requires_subject_alive":true,"priority":0}'
```

## A manifest-authored hazard (no cast)

Everything above schedules the job **from a cast** — a `ScheduleAutonomyJob`
effect captures the casting actor as `subject` at reducer time. But ADR-0054
D-3 permits a manifest-authored `[[autonomy_jobs]]` row to set `subject`
directly, with **no cast at all**: a burning room, a cursed shrine, a rigged
trap — any fixed, authored hazard that should pulse from world-start rather
than from a player's action.

The one authoring gap this shape used to have: `AutonomyJobRow.subject` is a
numeric `entity.entity_id`, which no TOML author can know for a
manifest-spawned entity (every prior authored subject was cast-captured, so
the numeric column was always filled by the reducer, never hand-typed).
`authored-hazard-pulses` (sk-aao) closed it with `subject_entity_key`: the
manifest names the responsible entity by its own `entity_key`, and apply
resolves it into `subject` (an unresolvable key, or a row setting both
`subject` and `subject_entity_key`, is rejected at apply).

The live, currently-validating worked example is
`packages/spellkave-mechanics/fixtures/mech_burning_room` (generated by
`packages/spellkave-mechanics/src/burning-room.ts`, `just validate` against
it returns zero diagnostics). A backing "fire" entity — scenery, never an
actor, existing solely to be the job's `subject` — and an occupant whose
`mech_burning_room/hp` resource the pulse drains every 6 seconds for 3
pulses:

```toml
[[entities]]
bundle_id = "mech_burning_room"
entity_def_id = "mech_burning_room/fire"
entity_key = "mech_burning_room/fire"
kind = "item"
name = "Burning Room Fire"
owned_by_entity_key = ""
place_node_id = "mech_burning_room/room"
quantity = 1

[[consequence_frame_writes]]
ordinal = 0
template_id = "mech_burning_room/pulse"

[consequence_frame_writes.frame_write.ForEachActorInRadius]
center_ref = "TargetSpatialRef"
predicate_source = ""
shape_id = "core/area/node_ball"
shape_params_json = '{"ball_radius": 0}'

[[consequence_frame_writes.frame_write.ForEachActorInRadius.body]]

[consequence_frame_writes.frame_write.ForEachActorInRadius.body.ModifyResource]
actor = "Actor"
delta_source = "-3"
resource = "mech_burning_room/hp"

[[autonomy_jobs]]
anchor_place_node_id = "mech_burning_room/room"
bundle_id = "mech_burning_room"
description = "Burning room hazard pulse (authored-hazard-pulses, sk-aao): damages every occupant of the room every 6s for 3 pulses, attributed to the fire entity, no cast involved."
dsl_function = "mech_burning_room/pulse"
enabled = true
fire_at_boundary = ""
frequency_ms = 6000
job_id = "mech_burning_room/fire_pulse"
next_fire_at_ms = 0
notable = false
owner_actor = 0
payload_json = ""
priority = 0
repeats_remaining = 3
requires_subject_alive = false
source = "manifest"
subject_entity_key = "mech_burning_room/fire"
```

The damage delta is a fixed literal (`-3`), not a dice expression — unlike
the cast-based Cloudkill above, this fixture's live demo reads the occupant's
hp before/after each pulse and needs a deterministic delta to compare against.
That demo is a captured manual session,
`openspec/specs/world-manifest-authoring/demos/sk-aao-burning-room-hazard-pulse.md`,
not an automated test. A dice-based `delta_source` (the SRD save-for-half idiom
above) works identically here; the fixed value is a fixture-authoring choice
for a legible demo, not a substrate limitation.

`center_ref = "TargetSpatialRef"` still resolves to the job's captured
`anchor_place_node_id` — the SAME mechanism the cast-based Cloudkill uses —
so the pulse stays fixed on the room regardless of whether the (stationary)
fire entity ever moves. `repeats_remaining = 3` is a fixture-authoring choice
(small, for a short live demo); any finite value satisfies ADR-0054 D-4.

## Current authoring gaps

Saving throws and dice damage **are** expressible in the pulse leaf (the Cloudkill
example folds a CON save-for-half into `delta_source`, per ADR-0045). Condition/status
payloads (poisoned, restrained) **are now also expressible**: ADR-0064 admitted
`ApplyStatus` into the subject-bound frame-write allowlist alongside
`ForEachActorInRadius` and `ModifyResource`
(`spellkave_validate::autonomy_jobs::AUTONOMY_ELIGIBLE_FRAME_WRITES`,
`crates/spellkave-validate/src/autonomy_jobs.rs`, enforced identically at the
kernel fire-time guard, the world API) — this section previously said
otherwise; that was stale against ADR-0064 (`authored-hazard-pulses`, sk-aao).
A `ForEachActorInRadius` → `ApplyStatus` pulse (a zone that poisons its
occupants each round rather than damaging them) is the condition-hazard
sibling of the `ModifyResource` shapes above (both the cast-based Cloudkill
and the manifest-authored burning room), same eligibility fence, same
bounded-`repeats_remaining` requirement.

What is still out of reach inside an autonomy pulse leaf:

- **Damage-type routing** (resist/vuln/immune) — the `routeDamage()` `has_tag`
  ladder works in a normal cast's `delta_source`. srd-cc pulses author it
  (Moonbeam, Caltrops), and the Caltrops live proof evaluates it on an
  untagged creature; no live pulse proof covers the resist/immune/vulnerable
  branches yet.
- **Macros in the pulse predicate** — `ForEachActorInRadius.predicate_source`
  is parsed at fire time without the manifest macro table, so `macro(...)`
  there disables the job with `MF-DSL-MACRO-UNKNOWN` although offline
  validation accepts it (sk-jay0.2.43). Inline the macro body (srd-cc:
  `abilityModifierBodyFor`).

The scheduling pattern itself is unchanged when these land.

Ranged placement of the zone on a distant cell **is** now supported: the cast
captures its target cell as the job's `anchor_place_node_id` and the pulse
centers on it via `center_ref = "TargetSpatialRef"` (ADR-0055, #776). A moving or
expanding zone (a cloud that drifts downwind) is still out of scope — the anchor
is a single cell fixed at cast time.

## See also

- ADR-0054 — the decision and its fences. ADR-0064 — admits `ApplyStatus`
  into the subject-bound frame-write allowlist.
- [autonomy-jobs concept](../../../docs/data-model-concepts/autonomy-jobs.md) — the scheduling table and the eligibility fence.
- `archive/packages/spellkave-srd/fixtures/base/spell-actions.toml` — the
  seeded `srd/cast_cloudkill/*` rows this guide's cast-based prose quotes.
  Historical: `packages/spellkave-srd` was retired to `archive/` and does not
  seed into any live node (the central `world-fixtures/` pile this page used
  to cite no longer exists anywhere in the repo, `world-fixtures-retirement`,
  2026-08-14).
- `packages/spellkave-srd-cc/fixtures/base/spells/level-2/moonbeam.toml`,
  `spike-growth.toml` — live cast-scheduled examples (marker `Inscribe` on
  the cast, `ScheduleAutonomyJob` with a per-cast `source`, pulse template).
- `packages/spellkave-mechanics/fixtures/mech_burning_room` — the live,
  currently-validating worked example for the no-cast, manifest-authored
  shape (["A manifest-authored hazard (no cast)"](#a-manifest-authored-hazard-no-cast), below).
- [`aoe-damage-spell`](./examples/aoe-damage-spell.md) — an immediate (non-lingering) area spell.

## Traces that fade on their own

A trace normally lives forever. `Inscribe` takes two optional lifetime fields,
and only one of them is usable from authored content:

| Field | Meaning | Authorable? |
|---|---|---|
| `expires_at_tick` | An **absolute** world tick | ❌ in practice |
| `expires_after_ticks` | Ticks **from the moment it is inscribed** | ✅ |

`expires_at_tick` is absolute, and a manifest has no way to know the tick a
future inscription will fire at — the trace is written when a player acts, not
when the bundle is loaded. No live authored `Inscribe` sets it (a grep of the
repository's non-`archive/` `*.toml` files finds none). Reach for `expires_after_ticks` instead; the kernel resolves it to
`inscribed_at + n` at inscription time. Set both and the absolute value wins.

Omit both for a permanent trace — still the default, and still right for
anything the world is meant to remember.

```toml
[[consequence_frame_writes]]
template_id = "mybundle/light_fire/success"
ordinal = 0

[consequence_frame_writes.frame_write.Inscribe]
kind = "mybundle/smoke"
location_kind = "binding"
location_ref = "ActorSpatialRef"
payload_json = "{}"
expires_after_ticks = 10   # the smoke thins out
```

### ⚠️ Decay deletes; it does not "un-tell"

Expiry removes the trace ROW (`expire`,
the world API). Anyone who already perceived
it keeps a private memory of it (`observer_trace_knowledge` copies the payload
verbatim at first perception, and expiry does not delete that row). The
player-facing trace read (the `visible_trace` view) resolves each remembered
trace back through the trace table and skips ids that no longer exist, so a
decayed trace drops out of the trace read **even for someone who perceived
it**. Only the observer's own memory copy stays readable, through
`spellkave_observer_trace_knowledge` (`readObserverTraceKnowledge`,
`packages/spellkave-sdk/src/core/readers/observer_trace_knowledge.ts`, which
does not filter out decayed ids).

So `expires_after_ticks` is right for traces that are ephemeral *by nature* —
smoke, smell, tracks, a lingering chill — where nobody is expected to recall
them afterwards. It is the wrong tool for anything a character is meant to
remember having witnessed. Speech is the cautionary case: an utterance should
stop lying around in the world, but the people who heard it must keep it, so
decay is not the answer there.

**What IS the answer for that case:**
`trace_kind_definitions.perceptible_for_ticks`. It is a separate axis — it
governs how long an EXISTING trace stays admissible to an ARRIVING observer,
and it deletes nothing. `srd/speech` declares `0`: heard by whoever was
present, never by someone who walks in afterwards, while the row itself
survives for anyone who already perceived it and for a DM/oversight look-back.
See "How long a trace stays findable" in
[`interaction-dsl-and-world-authoring.md`](./interaction-dsl-and-world-authoring.md).
Two knobs, two questions: *how long does it exist* vs *how long can it still
be found*.
