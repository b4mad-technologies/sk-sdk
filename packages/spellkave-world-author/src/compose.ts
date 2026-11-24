// embedded-manifest: {"category": "production_schema_constructor", "rationale": "production include inspector constructs a transient schema header from its root", "signatures": ["schema_shape"]}
//
// SRD ACTOR-BEHAVIOR cluster builder — the shared machine behind the per-actor
// behavior drivers (#238 / #708).
//
// ADR-0072 D-1 / #1526: promoted verbatim from the old scripts/srd/behavior-cluster.ts
// (now a re-export shim at packages/spellkave-srd/src/author/behavior-cluster.ts,
// #1968 slice 2; retired with #1526 step 5). This module is the
// canonical composition layer — new shapes are added HERE. Node-only (uses fs
// at call time, never at import); the browser entry does not re-export it.
//
// #835 — the capability+action+tags+outcome IDENTITY core of a spell now also has a
// standalone, fs-free primitive in the package: `emitSpell` (@spellkave/world-author),
// which a general author uses to declare ONE spell identity. This cluster predates it and
// carries the full effect-chain machine. The cast_x/affordance ACTION twin is GONE
// (#836-B, below: one canonical action_definition; the materialiser resolves via
// outcome.manipulation_action_id, not the affordance template_id). Fully delegating the
// remaining identity-row emission to `emitSpell` is the last render-discipline step under
// #836. What this cluster DOES use today is the shared `assertSpellCatalogBinding` (see
// authorBehaviorFragment) — the author-time guard that a self-emitted `srd/spell/*`
// capability has a matching catalog entity_definition.
//
// #836 Parts C/D (shipped): `just srd-lint-bundle` (= `manifest lint --bundle`) reports the
// author-time duplication / binding smells across the merged bundle — twin-action,
// tag-repetition, spell-delimiter-drift, orphan/dangling capability. Best-practice rationale:
// packages/spellkave-world-author/docs/spell-authoring-best-practices.md + the spell-identity-minimal worked example.
//
// One actor BEHAVIOR = a cast/attack effect chain (capability → outcome →
// affordance → action → consequence → frame_write) plus the live-wiring rows that
// let it fire (the actor holds the capability; its node carries the niche). The
// kernel does NOT distinguish "spell" from "monster attack" — both are just an
// actor performing an action whose consequence modifies a resource — so this
// builder is shared by both drivers; only the id namespace + output file differ:
//   • author-spell-behavior.ts   → base/spell-actions.toml   (caps srd/spell/<key>,        actions srd/cast_<key>)
//   • author-monster-actions.ts  → base/monster-actions.toml (caps srd/monster-action/<key>, actions srd/<key>)
//
// Substrate: ADR-0045 (issue #266) makes the two tabletop mechanics authorable as
// generic DSL carriers the kernel stays ignorant of:
//   - dice damage / heal → ModifyResource.delta_source           (Int expression)
//   - per-target save     → ForEachActorInRadius.predicate_source (Bool, per actor)
// The save DC / attack AC is authored as a literal (8 + prof + ability ≈ 13); the
// target's modifier folds into that threshold. Damage-TYPE routing (resist / vuln /
// immune) is the ONE remaining gap (ADR-0045 G-3 / #763), carried as documentary
// tags only — no behavior here has a resistance rider, so none needs it.
//
// The SHAPES (each moves WHERE the to-hit / save roll sits — or drops it):
//   • AoE save-negate    — ForEachActorInRadius sphere; predicate_source GATES the
//       body (a save runs no body → 0 effect). delta_source = "0 - dN".
//   • AoE save-for-half  — sphere, body NOT gated (predicate_source = ""); the save
//       halves inside delta via a typed ternary (ADR-0045 D-3 `cond`):
//       delta_source = "cond(d20 >= DC, 0 - (NdM / 2), 0 - NdM)".
//   • single-target ATTACK — one TargetActor; body = bare ModifyResource(TargetActor).
//       As of #1891/PR #2075, the attack roll does NOT sit on the AFFORDANCE predicate
//       (`predicateSource` on `affordance_templates.predicate_source` — a stochastic
//       comparison there is treated as SATISFIED at materialise time, so it no longer
//       gates OFFER attemptability/visibility). Instead, `predicateSource` stays
//       deterministic ELIGIBILITY only ("" or empty is fine — an ungated attack), and
//       the die goes on `resolutionPredicateSource` ("d20 >= AC", `resolutionMode:
//       "Stochastic"`), evaluated ONCE at act time by `r_manipulate` against the real
//       Actor/TargetActor facts; a MISS applies `onFailure`'s consequence instead of
//       `on_success`'s (composer-resolution-fields — see the field doc comments
//       below). No `roll_at_least` kernel op — the attack composes from the raw `>=`
//       Compare primitive (ADR-0021). A monster drives this identically with caster =
//       the monster (no turn-loop: r_manipulate takes actor_id as a plain param; the
//       claim gate is on the TARGET only).
//   • single-target HEAL — same topology, NO affordance gate (predicate_bool = true),
//       POSITIVE delta ("NdM"); `saturating_add` raises HP, the resource max_value
//       clamps overheal. The kernel does not know heal from damage — only the sign.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cluster_rows_json } from "@spellkave/authoring-wasm";
import { inspectManifest } from "./inspect";
import { renderSchemaManifestJson } from "./manifest";
import { stripManifestHeaders } from "./manifest-text";
import { assertSpellCatalogBinding } from "./spell";

// One actor's full behavior slice. The builder turns a list of these into the
// combined row tables; nothing here is spell- or monster-specific to the kernel.
export interface ActorBehavior {
	// capability `srd/<capPrefix>/<key>` + action `srd/<actionPrefix><key>` derive from this.
	key: string;
	// #835 — explicit capability id, overriding the `srd/<capPrefix>/<key>` derivation.
	// For a CATALOG spell this MUST equal the catalog `entity_definition.entity_def_id`
	// (`srd/spell/<foundry-slug>`), so a single spell is ONE identity: the behavior
	// `capability_id` == the catalog `entity_def_id` == the action's `required_capability`
	// (the cluster always sets `required_capability = cap`). Leaving it unset keeps the
	// legacy per-namespace derivation (monster actions, synthetic consumer affordances).
	// The action id is deliberately NOT touched — the `cast_*` verb keeps its name; only
	// the spell IDENTITY is unified. A `srd/spell/*` capability with no matching catalog
	// entity_definition draws the MF-VAL-264 convention warning.
	capabilityId?: string;
	displayName: string;
	// Render the capability_definition (+tags) here? False when the capability is
	// already authored elsewhere (e.g. Acid Splash's lives in base/spells.toml).
	emitCapability: boolean;
	capabilityDescription?: string;
	capabilityTags?: string[];
	actionTags: string[];
	// "aoe"           — ForEachActorInRadius sphere; gate in the body (negate,
	//                   predicate_source != "") or the delta cond (half, "").
	// "single-target" — one TargetActor; bare ModifyResource. The gate, if any, sits
	//                   on the AFFORDANCE: non-empty predicate_source = an attack/check
	//                   roll (miss skips the consequence); "" = no gate (e.g. a heal).
	// "zone"          — a LINGERING hazard: ordinal-0 frame_write INSCRIBES a
	//                   spatial_environment_state marker on the caster's cell at RUNTIME
	//                   (the Inscribe{kind:"spatial_environment_state"} apply-path overload,
	//                   server inscribe.rs:103 — resolves any place_node incl. ephemeral grid
	//                   cells), ordinal-1 PULSES a node-local ForEachActorInRadius
	//                   (core/area/node_ball, ball_radius 0) over every actor on that cell.
	//                   The marker LINGERS (observable); re-casting re-pulses. The state def
	//                   is emitted automatically (writer_policy "world_interaction" so the
	//                   apply path may write it; a "manifest"-only policy would reject it).
	// "scheduled-zone" — a TRUE lingering hazard (ADR-0054 caster-attributed pulse). Like
	//                   "zone" the CAST inscribes the marker (success consequence, ordinal 0),
	//                   but instead of pulsing once at cast it schedules a subject-bound
	//                   `ScheduleAutonomyJob` effect (success.effect_refs_csv → an
	//                   effect_definition). The job captures the caster as `subject` and, on
	//                   the world clock, RE-FIRES a separate pulse consequence_template
	//                   (ForEachActorInRadius + ModifyResource damage, OR — when
	//                   `applyCondition` is set — ForEachActorInRadius + ApplyStatus condition)
	//                   each `scheduleFrequencyMs` for `scheduleRepeats` rounds — the zone
	//                   damages OR conditions whoever stands in it on its own, then expires. The
	//                   fire-time fence (`is_executable_frame_write_now`) admits both
	//                   ModifyResource and ApplyStatus on the autonomy clock, but NOT Inscribe,
	//                   so the marker Inscribe MUST stay on the cast, never the pulse. WHERE the
	//                   pulse + marker center is set by `zoneCenterRef` (ADR-0055, #776 CLOSED):
	//                   "TargetSpatialRef" ANCHORS on the cast's target cell (fixed where
	//                   dropped — the captured anchor_place_node_id), "ActorSpatialRef" follows
	//                   the caster. `scheduleSource` may carry {Actor}/{tick} placeholders →
	//                   per-cast-unique job_id (concurrent casts no longer collide on the PK).
	// "env-state"     — an AMBIENT-EFFECT spell (Darkness/Silence/Fog, #796/ADR-0056).
	//                   The cast's ONLY frame_write is the marker Inscribe (no actor
	//                   effect, no pulse): it writes a `spatial_environment_state` row
	//                   (value_type BOOL, value = `envStateValue ?? true`) on the
	//                   `zoneCenterRef` cell at RUNTIME. Nothing here touches HP — the
	//                   EFFECT lives in a SEPARATELY-authored consumer affordance whose
	//                   predicate reads `target.state("<zoneStateId>")` (now authorable
	//                   since #796 retired the hardcoded r_move/r_manipulate gate). The
	//                   kernel default-populates an absent env-state fact to false, so a
	//                   fresh cell reads "off" with no manifest seed; the cast flips it on.
	// "summon"        — a SUMMONING spell (Find Familiar / Conjure / Animate Dead, Brief 26
	//                   `EffectPrimitive::Spawn`). The cast has NO frame_write at all; its
	//                   success consequence carries `effect_refs_csv` → an effect_definition
	//                   whose `primitives_csv = "Spawn"` instantiates a catalog blueprint
	//                   (`summonBlueprint`, any `entity_definition.entity_def_id` — e.g. one of
	//                   the 385 `srd/monster/*` defs). The spawn location is one of two forms:
	//                   • `summonLocationNode` → a LITERAL authored `place_node` id (a fixed,
	//                     known-location summon).
	//                   • `summonAtCaster: true` → DYNAMIC: the Spawn's `location_ref` is the
	//                     `ActorSpatialRef` binding, so the creature materialises at the
	//                     CASTER'S CURRENT cell (#849 RESOLVED by #859 — the apply path now
	//                     threads `bindings` into `execute_spawn` and `resolve_spawn_location_ref`
	//                     → `resolve_spatial_ref` substitutes the caster's spatial ref). This is
	//                     the faithful "summon appears next to you" model — the summon follows the
	//                     caster, independent of the cast's `target_ref`.
	//                   The affordance is ungated (a summon always succeeds).
	// "outcome-graph" — a BRANCH-ON-OUTCOME spell (#858/ADR-0058). The action's outcome
	//                   carries `outcome_expression_source = invoke_outcome_graph(<graph>)`
	//                   (the success consequence stays empty — no direct frame_write). The
	//                   graph branches root→<node> by each `branches[]` entry's `guard`
	//                   predicate; `authored_order` = array index, so the FIRST true edge
	//                   wins and the LAST branch should carry a `"1 == 1"` fallthrough. The
	//                   selected TERMINAL node carries its own `consequence_template`
	//                   (one ModifyResource on TargetActor, `branch.deltaSource`) which the
	//                   layer-2 commit sink applies via `r_apply_consequence` (the #865
	//                   node-effect wiring). ADR-0061 / #874 also threads the invoking
	//                   interaction's actor/target int-state, status, and tag facts into the
	//                   guard context, so a guard can branch on both dice (`d20`) and resolved
	//                   state (`target.stat("srd/hp")`). Unlike single-target ATTACK (a miss
	//                   skips the whole consequence → 0 effect), EVERY branch can carry an
	//                   effect, so a "miss" arm still deals half damage (Melf's Acid Arrow:
	//                   hit 4d4 / miss 2d4).
	// "clock"         — a SELF-TARGETED multi-ordinal tally/threshold pattern (#1968 finding
	//                   C2, the death-saves shape — archive/world-fixtures/srd/base/death-saves.toml).
	//                   Unlike every shape above (each writes a TargetActor or a radius-
	//                   selected OTHER actor), a clock's every ordinal writes the ACTING
	//                   subject ALONE: N bare ModifyResource(actor="Actor", ...) tally
	//                   ordinals (0..N-1, `clockTallies`) — plain read-modify-writes against
	//                   a resource this behavior does not own exclusively (a death-save pool,
	//                   a corruption counter, any user-named tally) — followed by M
	//                   ForEachActorInRadius(node_ball, ball_radius 0) threshold ordinals
	//                   (`clockThresholds`) wrapping an ApplyStatus/RemoveCondition on
	//                   "Actor" — never TargetActor, and never a BARE top-level ApplyStatus:
	//                   this substrate's ApplyStatus/RemoveCondition frame_write ops carry no
	//                   delta/predicate of their own to fold a `cond(...)` into (unlike
	//                   ModifyResource), so the ForEachActorInRadius wrapper's OWN
	//                   predicate_source is the only way to gate one. That radius-0 wrapper is
	//                   SAFE here specifically because every tally ordinal already wrote
	//                   "Actor" alone — a co-located bystander's OWN pool value can never
	//                   reflect someone else's roll (death-saves.toml's own header walks
	//                   through this exact reasoning, the A3 co-location fix this shape
	//                   generalises). A clock's affordance predicate (`predicateSource`) is
	//                   the ELIGIBILITY gate for the whole action (e.g. "actor.status('dying')
	//                   == true && ..."), the same seam single-target's attack-roll gate uses
	//                   — a SEPARATE concept from each threshold's own `when` (which gates
	//                   ONLY that threshold's ApplyStatus/RemoveCondition, post-tally).
	shape:
		| "aoe"
		| "single-target"
		| "zone"
		| "scheduled-zone"
		| "env-state"
		| "summon"
		| "outcome-graph"
		| "clock";
	// outcome-graph only — the branch arms (see the shape doc). Each is one terminal
	// graph node + its edge guard + the HP delta its consequence applies on selection.
	branches?: OutcomeBranch[];
	// summon only — the blueprint to instantiate (an entity_definition.entity_def_id, e.g.
	// `srd/monster/cat`). The spawn location is EITHER a LITERAL `summonLocationNode` OR, when
	// `summonAtCaster` is set, the DYNAMIC `ActorSpatialRef` binding (the caster's current cell;
	// #849 RESOLVED). Set exactly one — `summonAtCaster` wins if both are present.
	summonBlueprint?: string;
	summonLocationNode?: string;
	summonAtCaster?: boolean;
	// env-state only — the bool value the marker Inscribe writes (default true = "on").
	envStateValue?: boolean;
	radiusM?: number; // aoe only
	// aoe shape only — override the default "core/area/sphere" + `radiusM` metric
	// geometry with a specific area-shape id + its raw JSON params (e.g.
	// "core/area/node_ball" + '{"ball_radius": 0}', a TOPOLOGICAL radius unrelated to
	// `radiusM`'s metric one). Unset = the original sphere/radiusM behavior, byte-
	// identical for every existing caller (#1968 FIX③ de-fork: a bundle-generic
	// substrate verb sets these instead of hand-mirroring this whole branch).
	areaShapeId?: string; // default "core/area/sphere"
	areaShapeParamsJson?: string; // default `{"radius_m": <radiusM>}`
	// aoe shape only — the resource the per-target ModifyResource body writes.
	// Defaults to "srd/hp" (every SRD aoe spell today) — unset is byte-identical for
	// existing callers; a bundle-generic caller sets its own resource_definition_id.
	aoeResource?: string; // default "srd/hp"
	// Metric PLACEMENT range on the affordance (ADR-0053). 0 (default) = touch /
	// same place_node = pre-0053 behavior. Non-zero lets the cast act on a DISTANT
	// cell/entity within straight-line metric range. Author via the `ft()` feet→metric
	// helper, never raw feet. Governs placement only; AoE membership is still
	// for_each_actor_in_radius after the cell is targeted.
	rangeM?: number;
	// zone only — the lingering-marker state. The state def is emitted with
	// writer_policy "world_interaction" (the apply path may write) + a long freshness so
	// the marker persists. `zoneIntensity` is the value_int stamped on the cell.
	zoneStateId?: string;
	zoneIntensity?: number;
	zoneVisibility?: string; // default "Public"
	// Where the marker + pulse center (both zone shapes). ADR-0055:
	//   "ActorSpatialRef"  (default) — follows the caster's CURRENT cell each fire (mobile aura).
	//   "TargetSpatialRef" — ANCHORS on the cast's target cell (the job's captured
	//                        `anchor_place_node_id`), fixed even if the caster moves — the
	//                        faithful "dropped at range" hazard (Cloudkill). At cast time the
	//                        marker Inscribe also resolves TargetSpatialRef to the target cell,
	//                        so marker + pulse stay co-located.
	zoneCenterRef?: "ActorSpatialRef" | "TargetSpatialRef"; // default "ActorSpatialRef"
	// scheduled-zone only — the ADR-0054 autonomy-pulse cadence. `scheduleRepeats` bounds
	// the duration (a subject-bound actor-reaching job MUST be bounded — server fence +
	// MF-VAL-249); `scheduleFrequencyMs` is the fiction-ms period between pulses;
	// `requiresSubjectAlive` picks the liveness policy (false = the zone persists for its
	// full duration even if the caster leaves, the SRD Cloudkill behaviour; true = it
	// dissipates when the caster's entity is removed, the concentration variant). `source`
	// is the cancel-by-source/provenance key on the runtime job; author it with the
	// {Actor}/{ResponsibleSubject}/{tick} placeholders (ADR-0055 D-3) and the scheduler
	// interpolates them at cast time → per-cast-unique job_id, so concurrent casts no longer
	// collide on the PK (identity stays in the typed `subject` column).
	scheduleRepeats?: number; // default 10
	scheduleFrequencyMs?: number; // default 6000
	requiresSubjectAlive?: boolean; // default false
	scheduleSource?: string; // default `srd/<key>`
	selfEligible?: boolean; // action_definition.self_eligible — set true for a self-targeting action (e.g. a self-heal); default false
	predicateSource: string; // aoe body gate / "" ; or single-target affordance gate / ""
	deltaSource: string; // "0 - dN" damages (negative) ; "NdM" heals (positive, clamps). IGNORED when `attacks`, `applyCondition`, or `removeCondition` is set.
	// ACT-TIME STOCHASTIC RESOLUTION (composer-resolution-fields, #1891/#2075
	// docs/behavior-composition.md's now-resolved gap note) — all three OPTIONAL,
	// mapping 1:1 onto the `action_definitions.resolution_mode` /
	// `.resolution_predicate_source` / `.on_failure` columns, naming mirrored
	// from the shared tool runtime `spellkave_define_action`/`spellkave_define_behavior`
	// verb params (packages/spellkave-tool-authoring/src/authoring-verbs.ts).
	// Omitting all three renders BYTE-IDENTICAL `action_definitions` output to
	// before this field existed (no key is emitted at all — not even the schema
	// default) — this is the composer's half of the canon-ideal split #1891
	// established: the OFFER predicate (`predicateSource` above, on
	// `affordance_templates.predicate_source`) stays deterministic ELIGIBILITY
	// only (a stochastic comparison there is now treated as always-satisfied at
	// materialise time, per #1891 — it no longer gates attemptability), while the
	// dice move here, to the ACT-TIME resolution seam `r_manipulate` re-evaluates
	// for real. Wired for `shape: "single-target"` (the documented gap; also
	// works for "clock", whose own `predicateSource` is likewise a pure
	// eligibility gate) — NOT wired as a body-shape concern for "aoe" /
	// "outcome-graph" / "zone"/"scheduled-zone", each of which already has its
	// own idiom for branching on a roll INSIDE the body/graph (aoe's `cond(...)`
	// delta, outcome-graph's branch guards, a zone's per-actor pulse predicate)
	// and needs no `on_failure` consequence — a miss there already resolves to
	// "no effect" or "half effect" within the SAME consequence template. Setting
	// these on a non-single-target/clock shape is not rejected (the row-level
	// field is shape-agnostic — every shape shares this ONE `action_definitions`
	// push) but has no established idiom backing it yet; treat it as forward-prep,
	// not a proven pattern, until a second shape actually needs it.
	//   resolutionMode              — action_definitions.resolution_mode
	//     ("Deterministic" | "Stochastic" | "Deferred"). Omit for the schema
	//     default ("Deterministic") — set "Stochastic" alongside
	//     resolutionPredicateSource for the attack-roll idiom above.
	//   resolutionPredicateSource   — action_definitions.resolution_predicate_source,
	//     the authored boolean DSL `r_manipulate` evaluates ONCE at act time with
	//     the real Actor/TargetActor facts (e.g. "d20 >= 15" — the SAME roll that
	//     used to sit on `predicateSource` pre-#1891). Omit for empty.
	//   onFailure                   — action_definitions.on_failure, a bare
	//     `consequence_templates` id applied when resolutionPredicateSource
	//     evaluates false (a MISS). This composer does NOT auto-emit that
	//     template the way it auto-emits the `on_success` one (`ids().success`,
	//     always rendered from THIS behavior) — `on_success` is a derived,
	//     always-present identity for this behavior; a miss consequence is
	//     optional and often SHARED across several behaviors (e.g. one generic
	//     "no effect" template), so it stays a plain id reference, author it
	//     separately (e.g. `spellkave_define_consequence`, or a sibling
	//     behavior/extraRows entry in the same fragment) and pass its id here —
	//     the SAME "bare id, no ref-check, no auto-creation" contract
	//     `spellkave_define_action`'s own `on_failure` param already documents.
	//     Omit for none (schema default: empty string).
	resolutionMode?: "Deterministic" | "Stochastic" | "Deferred";
	resolutionPredicateSource?: string;
	onFailure?: string;
	applyCondition?: string;
	// CONDITION-REMOVING (single-target) — the INVERSE of applyCondition: instead of
	// landing a condition, the body REMOVES one from the target via a `RemoveCondition`
	// frame_write (the restoration / cleanse family — Lesser Restoration, Remove Curse,
	// Protection from Poison; it also makes a spell-applied condition curable). The kernel
	// frame-write arm (server `r_apply_consequence/remove_condition.rs`) deletes primary
	// `target_condition` row(s) matching `(target, target_kind, condition_definition_id,
	// parent_row_id IS NULL)` and runs each removed condition's authored remove-time cascade
	// policy on its children — so cleansing srd/paralyzed also clears its implied
	// core/incapacitated per the condition def, NOT per this spell. The shape is
	// `{target_kind:"entity", target_ref:"TargetActor", condition_definition_id, source_match}`.
	// `source_match` is `Any` for source-agnostic cleanse or `Exact(source_id)` for ending one
	// specific source's effect.
	// Cleanse spells have no save (Lesser Restoration just works on touch): leave
	// `predicateSource` empty → the affordance is ungated (predicate_bool = true). Both
	// `deltaSource` and `applyCondition` are ignored when this is set.
	removeCondition?: string;
	// removeCondition only — optional exact source key. Absent means source-agnostic `Any`;
	// present means `Exact(<source>)` for spells/effects that should end one source's effect.
	removeConditionSource?: string;
	// MULTIATTACK (single-target only): N independent self-gating attacks in ONE
	// action/consequence — a monster's Multiattack (e.g. Polar Bear's two Rends).
	// Each entry emits its OWN consequence_frame_write (ordinals 0..N), each a bare
	// ModifyResource(TargetActor, srd/hp, deltaSource) whose attack roll is FOLDED
	// INTO the delta as `cond(d20 >= AC, 0 - dmg, 0)` — so a per-attack miss zeroes
	// only THAT attack, not the whole action. The affordance therefore carries NO
	// gate (predicate_bool = true): each sub-attack self-gates in its own frame_write.
	// The server threads one reducer rng across sibling frame_writes (ADR-0045 COND-3
	// postscript) so the N rolls are INDEPENDENT (two Rends can hit-then-miss). When
	// set, `deltaSource`/`predicateSource` are ignored. Generalises to any N.
	attacks?: MultiAttack[];
	// RESOURCE-GATED CAST (any shape) — a LEVELED spell that consumes a pool
	// (e.g. `srd/spell_slot_1`) instead of casting free (a cantrip). Two effects:
	// (1) the AFFORDANCE gains an extra `actor.stat('<resource>') >= <amount>`
	// gate clause (ANDed with any existing body-gate predicate that already sits on
	// the affordance) — this is the ONLY seam that also reaches a Multiattack
	// (`attacks`), whose affordance is otherwise ungated; (2) the success
	// consequence gains one more ModifyResource frame_write (last ordinal) debiting
	// the pool on the CASTER (`actor = "Actor"`). SRD-MAP B8 (#1561 stage 3a).
	resourceCost?: { resource: string; amount: number };
	// SKILL-CHECK / NON-HP STATE TARGET (single-target only): the `object_state` the
	// single-target ModifyResource body writes. Defaults to `srd/hp` (every combat shape).
	// Set to a non-resource social/disposition state (e.g. `srd/attitude`) to make the
	// success consequence change a NON-HP state — the foundational social-check shape: an
	// actor-initiated `d20 + ability_mod vs DC` affordance gate whose success shifts a
	// target NPC's disposition. ModifyResource works on ANY object_state Int row
	// (modify_resource.rs §12.5b), clamping to a `resource_definition`'s [min,max] when one
	// exists. Ignored when `attacks`/`applyCondition`/`removeCondition` is set.
	resourceStateId?: string;
	// SPEECH-ACT (Searle lens) — when set, the action's outcome_template carries this
	// `communication_speech_act_id`, so the affordance SURFACES as a communication speech
	// act (`communication.speech_act=<id>`, the verb-class discriminator — mod.rs:993). The
	// row still carries `manipulation_action_id` so r_manipulate EXECUTES the gated
	// consequence normally (selection.rs:425); the empty perception `action_id` is the
	// observer-facing descriptor only. This is how a social skill check is framed as a
	// speech act (Persuasion = a directive) WITHOUT a new resolution mode (mode_selection.rs:
	// "Communication intents are ordinary action_definition rows … speech-act ids are
	// descriptor metadata and do not select runtime mode").
	communicationSpeechActId?: string;
	// #1968 B-9: authored PLAYER-facing observation narrative — when set, the
	// action's outcome_template carries this as its `description` column, the
	// authored source `observation.ts` (shared tool runtime) reads for the
	// manipulate/sensing observation contract. Distinct from
	// `capabilityDescription` above, which stays operator-only on
	// `capability_definitions` — see `outcome_template.rs`'s doc comment for
	// the widened, presentation-only contract this field rides. May reference
	// the frozen `{target_name}`/`{actor_name}`/`{place_name}` placeholders
	// only; the validator rejects anything else.
	observation?: string;
	// The acting entity (holds the capability + niche). Defaults to cfg.defaultCaster
	// (the PC), but any actor with an [[actors]] row can act — a MONSTER caster wires
	// identically.
	caster?: string;
	casterNode?: string;
	// Emit an `[[actors]]` steering row for the caster (entity_key + name). A monster
	// caster needs one (r_manipulate drives a bound actor); a PC already has it. No
	// `[[actor_identities]]` is needed — r_manipulate takes actor_id as a plain param,
	// it does not validate the sender's identity against the caster (B6a finding).
	emitCasterActor?: boolean;
	// Emit placement rows for a newly fan-out monster actor. This is fixture wiring,
	// not behavior substrate: the monster still attacks through the same capability
	// cluster as an already placed actor.
	emitCasterEntity?: boolean;
	casterEntityDefId?: string;
	casterKind?: "npc" | "player" | "item" | "place";
	casterName?: string; // [[actors]].name when emitCasterActor is set
	// #728 — DEF-LEVEL capability binding. When set, emit an
	// `entity_definition_initial_capability` row binding THIS behavior's capability
	// to the named `entity_definition`. At instance birth (manifest placement or
	// runtime spawn) the server's `apply_definition_seeds` copies the capability onto
	// the placed entity (an entity-anchored `capability` row, ADR-0028 D-5) — so every
	// instance of the definition is born combat-capable, with NO per-instance
	// `actor_capabilities` grant. This is the SCALE unlock that lets the 385-strong
	// `monsters.toml` catalog carry its proven actions by definition, not by hand.
	bindToDefinition?: string;
	// #728 PROOF instance. Place a fresh entity carrying `bindToDefinition` as its
	// `entity_def_id`, with a steering `[[actors]]` body but deliberately NO
	// `actor_capabilities` row. r_manipulate's selection gates on the caster actually
	// HOLDING the capability (selection.rs — it distinguishes "capability-not-held"
	// from "niche-not-anchored"), so this instance can act ONLY if it inherited the
	// capability from the definition seed. A successful attack is therefore
	// proof-positive of inheritance. The niche is shared via `node` (defaults to the
	// caster's node, where this behavior already attaches the capability niche).
	defInstance?: { entityKey: string; name: string; node?: string };
	// CLOCK only (#1968 finding C2) — N self-targeted tally ordinals, each a bare
	// ModifyResource(actor="Actor", ...). Order is preserved (ordinal = array index),
	// so author a scratch-cell capture BEFORE the tallies that read it (the death-
	// saves idiom: ordinal 0 captures one d20 draw into a scratch resource via
	// `delta: "d20 - actor.stat('<scratch>')"`, ordinals 1+ then tally that captured
	// value via `predicate` against the SAME scratch resource). Required, non-empty,
	// when `shape` is "clock".
	clockTallies?: ClockTally[];
	// CLOCK only — M threshold ordinals, appended AFTER every tally ordinal (so each
	// threshold's `when` can read the tallies' post-write values, the same
	// ordinal-sorted-sequential-commit idiom the lethal attack write and this shape's
	// own fixture precedent both rely on). Each becomes a
	// ForEachActorInRadius(node_ball, ball_radius 0) wrapping ONE ApplyStatus/
	// RemoveCondition on "Actor" — see the shape's own doc comment for why the radius
	// wrapper is safe despite every tally writing "Actor" alone. Required, non-empty,
	// when `shape` is "clock".
	clockThresholds?: ClockThreshold[];
}

// One sub-attack of a Multiattack. The full damage-or-nothing Int expression
// (`cond(<roll> >= AC, 0 - <dice+bonus>, 0)`) is the frame_write's delta_source.
export interface MultiAttack {
	deltaSource: string;
	label?: string; // human tag for the report (e.g. "Rend")
}

// One tally ordinal of a "clock" behavior (#1968 finding C2) — a bare
// ModifyResource(actor="Actor", resource, delta_source) frame_write. `resource` must
// already be an authored resource_definitions row (this builder never auto-creates a
// write-target resource, same posture as every other ModifyResource shape). The
// delta_source itself is EITHER:
//   • `delta` alone (no `predicate`)  — the raw arithmetic idiom a scratch-cell
//     capture needs (death-saves.toml ordinal 0: `"d20 - actor.stat('<scratch>')"`,
//     a set-via-delta that lands exactly on the fresh draw — not a conditional).
//   • `predicate` (+ optional `delta`) — the increment-on-condition idiom every
//     tally-split ordinal needs (death-saves.toml ordinals 1/2: "tally the
//     just-captured roll into exactly one pool"); expands to
//     `cond(<predicate>, <delta ?? "1">, 0)` so the common "+1 on condition" case
//     needs only `predicate`, while a non-unit increment still overrides `delta`.
// Exactly one of `predicate`/`delta` must be set at the CALLER layer (this type
// itself allows either or both — `predicate` set makes `delta` the increment amount
// rather than the whole expression).
export interface ClockTally {
	resource: string;
	predicate?: string;
	delta?: string;
}

// One threshold ordinal of a "clock" behavior (#1968 finding C2) — a
// ForEachActorInRadius(center_ref="ActorSpatialRef", core/area/node_ball,
// ball_radius 0) wrapping ONE ApplyStatus (`applyStatus`) or RemoveCondition
// (`removeCondition`) body targeting "Actor". `when` is the wrapper's own
// predicate_source, evaluated against the POST-tally state (this ordinal runs after
// every `clockTallies` ordinal) — e.g. `"actor.stat('death_save_failures') >= 3"`, or
// an OR-branched short-circuit like death-saves.toml's nat-20 stable-immediately
// check. Exactly one of `applyStatus`/`removeCondition` must be set.
export interface ClockThreshold {
	when: string;
	applyStatus?: string;
	removeCondition?: string;
	// removeCondition only — optional exact source key, mirrors `ActorBehavior.
	// removeConditionSource`. Absent means source-agnostic `Any`.
	removeConditionSource?: string;
}

// One branch arm of an "outcome-graph" spell (#858/ADR-0058). The graph evaluates
// each root→<node> edge in `authored_order` (= the branches[] index); the first edge
// whose `guard` predicate is true selects that terminal node, and the node's
// consequence applies `deltaSource` to `subject`'s `resource` (both default to
// TargetActor/srd/hp — the damage-against-target shape every branch authored before
// playable-fighter-l1-20 D-1). Because the guard context has NO actor/target-state
// bindings (only dice + world-tick), guards branch on a ROLL (`d20 >= AC`,
// `roll_under(d20, DC)`) — and the last branch is a `"1 == 1"` fallthrough. A single
// d20 is rolled by the first guard; on a miss it falls through.
export interface OutcomeBranch {
	node: string; // graph node id (e.g. "hit" / "miss"); also the outcome/consequence id stem.
	guard: string; // edge guard predicate (dice/world-tick only); "1 == 1" = fallthrough.
	deltaSource: string; // resource delta the selected node applies ("0 - 4d4" damages).
	label?: string; // human tag for the report.
	// Playable-fighter-l1-20 D-1: the branch's own write subject/resource — a
	// kernel symbolic actor ref ("Actor" / "TargetActor"). Both omitted keeps
	// the byte-identical pre-D-1 shape: ModifyResource(TargetActor, srd/hp, ...).
	subject?: string; // default "TargetActor"
	resource?: string; // default "srd/hp"
}

export interface BehaviorConfig {
	bundleId: string;
	manifestPath: string;
	// capability id = `<idNamespace>/${capPrefix}/${key}` ; action id =
	// `<idNamespace>/${actionPrefix}${key}`.
	capPrefix: string;
	actionPrefix: string;
	defaultCaster: string;
	defaultCasterNode: string;
	objectStateSeeds?: ObjectStateSeed[];
	// Bundle/namespace override for the derived capability/action/outcome/affordance/
	// success ids (#1968 FIX③ de-fork). Defaults to "srd" — unset is byte-identical for
	// every existing SRD driver (none of which sets it today). A bundle-generic caller
	// (e.g. the shared tool runtime `spellkave_define_behavior` verb) sets this to its OWN
	// `bundleId` so `ids()` derives `<bundle>/spell/<key>` / `<bundle>/cast_<key>`
	// instead of hardcoded `srd/...`. Follows the same override-hook precedent
	// `ActorBehavior.capabilityId` already set for the id as a WHOLE — this overrides
	// only the leading namespace segment, so `capPrefix`/`actionPrefix` keep composing
	// normally underneath it.
	idNamespace?: string; // default "srd"
}

export interface ObjectStateSeed {
	entityKey: string;
	stateId: string;
	valueInt: number;
	sourceTemplateId: string;
}

// FIXTURE-HYGIENE INVARIANT (#1267 follow-up): the generic `srd` bundle's `base/**`
// fragments carry ONLY definitions/templates/vocab — never INSTANCE rows. An instance
// row places/binds a CONCRETE actor or cell into the world; shipping one in the generic
// bundle drags fake townsfolk + proof cells into every world that loads `srd`. These are
// the instance-row tables: they belong in a CONTENT bundle (phandelver/demos) or a
// TEST-ONLY proof fragment the harness loads explicitly, never in `base/**`. The
// mechanical lint (retired 2026-08-11, archived to
// `archive/scripts/ci/check-srd-fixture-hygiene.sh`) used to fatal on any of these in
// `archive/world-fixtures/srd/base/*.toml`. `clusterRows` emits several of them (the live-wiring
// rows that let a behavior fire); a split driver (see author-persuasion.ts) partitions
// them out into the proof fragment by this exact set.
export const INSTANCE_ROW_TABLES: ReadonlySet<string> = new Set([
	"entities",
	"actors",
	"actor_spatial_locations",
	"actor_capabilities",
	"object_state",
	"place_nodes",
	"spatial_niche_attachments",
	"actor_identities",
]);

// #1968 R7 slice 4.10 (ADR-0087): `clusterRows` is now a thin forwarder to
// spellkave-authoring's Rust `compose::cluster_rows` — the final assembly of
// every shape/modifier ported across tasks.md 4.1-4.9 (`ids`, live-wiring,
// single-target, aoe, attacks/resourceCost, zone/env-state/scheduled-zone,
// summon, outcome-graph, clock). See that module's own doc comment for the
// full per-row provenance this function used to carry directly.
export function clusterRows(
	behaviors: ActorBehavior[],
	cfg: BehaviorConfig,
): Record<string, unknown> {
	return JSON.parse(cluster_rows_json(JSON.stringify(behaviors), JSON.stringify(cfg))) as Record<
		string,
		unknown
	>;
}

// Concat-merge a set of row-table maps (later sets append after earlier ones),
// preserving the per-table array shape clusterRows / extraRows use.
export function mergeRowTables(
	...sets: (Record<string, unknown[]> | Record<string, unknown> | undefined)[]
): Record<string, unknown[]> {
	const out: Record<string, unknown[]> = {};
	for (const set of sets) {
		for (const [table, rows] of Object.entries(set ?? {})) {
			out[table] = [...(out[table] ?? []), ...(rows as unknown[])];
		}
	}
	return out;
}

// Strip the [[bundles]]/[metadata] headers from a rendered manifest, leaving only
// row tables — the shape an [[include]] fragment carries (the root manifest.toml owns
// schema_version/[[bundles]]/[metadata]). Exported (#1968 srd verb-layer migration):
// a verb-driven fragment generator (packages/spellkave-shared tool runtime's
// AuthorToolContext/memoryWorkspace) accumulates a fragment's rows via tool calls
// rather than an explicit `rows` object, so it needs this same header-stripping
// applied to the WORKSPACE's own rendered TOML — see
// packages/spellkave-srd/src/author/verb-fixture.ts.
export { stripManifestHeaders } from "./manifest-text";

// Render a header-stripped [[include]] fragment off the real manifest header, from an
// explicit set of row tables (already merged). Goes through the SAME author SDK render
// path (renderSchemaManifestJson) — never hand-rolled TOML.
export function renderFragmentFromRows(
	baseManifest: Record<string, unknown>,
	rows: Record<string, unknown[]>,
): string {
	const base = JSON.parse(JSON.stringify(baseManifest)) as Record<string, unknown>;
	delete base.include;
	Object.assign(base, rows);
	return stripManifestHeaders(renderSchemaManifestJson(JSON.stringify(base)));
}

// Render a COMPLETE standalone manifest (headers KEPT) from a schema-shaped object
// (schema_version + [metadata] + [[bundles]] + row tables). Used for a TEST-ONLY proof
// fragment that is applied on its own (not [[include]]-d into a shipped manifest).
export function renderCompleteManifest(manifestObj: Record<string, unknown>): string {
	return renderSchemaManifestJson(JSON.stringify(manifestObj));
}

// Render a header-stripped [[include]] fragment off the real manifest header.
function buildFragment(
	baseManifest: Record<string, unknown>,
	behaviors: ActorBehavior[],
	cfg: BehaviorConfig,
	extraRows?: Record<string, unknown[]>,
): string {
	// Bespoke rows (e.g. an ambient-effect spell's CONSUMER scene: a node-anchored
	// affordance + niche + counter-capability) that the per-behavior cluster shape
	// cannot express. Merged (concat) into the same schema JSON so they render through
	// the SAME author SDK path — never hand-rolled TOML.
	const merged = mergeRowTables(clusterRows(behaviors, cfg), extraRows);
	return renderFragmentFromRows(baseManifest, merged);
}

// Read the manifest header, build the cluster fragment, write it with a banner.
// #835 safeguard data — every `entity_definition.entity_def_id` across the bundle's
// `[[include]]` closure (the catalog). The package's `assertSpellCatalogBinding` is
// fs-free, so the driver (which HAS fs) gathers the known ids here and feeds them in.
async function collectBundleEntityDefIds(manifestPath: string): Promise<Set<string>> {
	const ids = new Set<string>();
	const add = (m: Record<string, unknown>) => {
		const defs = Array.isArray(m.entity_definitions) ? m.entity_definitions : [];
		for (const d of defs) {
			const id = (d as { entity_def_id?: string }).entity_def_id;
			if (id) ids.add(id);
		}
	};
	const rootToml = await readFile(manifestPath, "utf8");
	const root = inspectManifest(rootToml).manifest as Record<string, unknown>;
	add(root);
	const dir = dirname(manifestPath);
	// Include fragments are header-stripped row tables, but inspectManifest requires a
	// `#:schema` directive + schema_version — lift both from the root and prepend per
	// fragment (the same trick the author-CLI's `inspect --bundle` / `validate --bundle` use).
	const schemaLine = rootToml.split("\n").find((l) => l.startsWith("#:schema")) ?? "";
	const version = typeof root.schema_version === "string" ? root.schema_version : "1.0.0";
	const fragHeader = `${schemaLine}\nschema_version = "${version}"\n\n`;
	const includes = Array.isArray(root.include) ? root.include : [];
	for (const entry of includes) {
		const rel = (entry as { path?: string })?.path;
		if (!rel) continue;
		try {
			const frag = await readFile(resolve(dir, rel), "utf8");
			add(inspectManifest(`${fragHeader}${frag}`).manifest as Record<string, unknown>);
		} catch {
			// a missing include is the validator's problem (MF-VAL), not the safeguard's.
		}
	}
	return ids;
}

export async function authorBehaviorFragment(opts: {
	out: string;
	header: string;
	behaviors: ActorBehavior[];
	cfg: BehaviorConfig;
	// Bespoke schema rows merged into the same render (see buildFragment). Keyed by
	// table name (e.g. `niche_definitions`, `affordance_templates`, `actors`).
	extraRows?: Record<string, unknown[]>;
}): Promise<void> {
	const baseManifest = inspectManifest(await readFile(opts.cfg.manifestPath, "utf8"))
		.manifest as Record<string, unknown>;

	// #835 — fail at author time if a self-emitted `srd/spell/*` capability has no
	// matching catalog entity_definition (the immediate-error form of MF-VAL-264). Only
	// behaviors that EMIT their own capability are guarded; `emitCapability:false` spells
	// reuse an externally-authored cap on purpose (guidance, the accepted stragglers).
	const catalogIds = await collectBundleEntityDefIds(opts.cfg.manifestPath);
	for (const b of opts.behaviors) {
		if (!b.emitCapability) continue;
		assertSpellCatalogBinding(b.capabilityId ?? `srd/${opts.cfg.capPrefix}/${b.key}`, catalogIds);
	}

	const body = buildFragment(baseManifest, opts.behaviors, opts.cfg, opts.extraRows);
	await writeFile(opts.out, `${`${opts.header}\n${body}`.replace(/\n+$/, "")}\n`, "utf8");
	console.log(
		`[behavior-cluster] wrote ${opts.out} (run full-bundle validate to gate cross-refs).`,
	);
}
