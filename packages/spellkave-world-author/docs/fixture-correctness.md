# Fixture correctness — the catalog

**This file is the single source of truth for "how do I author a fixture
bundle *correctly*".** Every enforcer points here and nothing restates these
rules:

- the deterministic validator codes (`MF-VAL-*` / `MF-APPLY-*`) in
  `crates/spellkave-validate` and
  the world API,
- the `srd-fixture-hygiene` grep lint (retired 2026-08-11 alongside
  `world-fixtures/`'s move to `archive/world-fixtures/`; script archived to
  [`archive/scripts/ci/check-srd-fixture-hygiene.sh`](../../../archive/scripts/ci/check-srd-fixture-hygiene.sh) —
  see `archive/README.md` Phase D),
- the read-only [`fixture-correctness-auditor`](../../../.claude/agents/fixture-correctness-auditor.md)
  agent (it *runs* this catalog against a bundle),
- the packaged `sk` skill (`packages/spellkave-cli/skill/SKILL.md`) and the
  shared [`authoring-process.md`](authoring-process.md).

> **Historical evidence.** Many rows and sweep notes below cite
> `phandelver/`, `world-fixtures/` or `packages/spellkave-srd/` as the place a
> failure was found. Those were retired on 2026-08-11/14 (`archive/README.md`);
> read them under `archive/` or with `git show`. The rule each row states
> still applies to the live bundles in the per-bundle map.

> If you find yourself writing a fixture-authoring rule into a `CLAUDE.md`, an
> agent file, or `SRD-MAP.md`, add it **here** and leave a one-line pointer
> there instead. The whole point of this file is that the rules live in *one*
> place. ([[#why-one-place]])

## How the catalog is organised

Fixture-correctness failures split into four classes, and **the class decides
the enforcement** — this is the agreed strategy, not a per-mistake judgment call:

| Class | Mechanically checkable? | Enforcement |
|---|---|---|
| **STRUCTURAL / ref-integrity** (dangling ref, wrong bundle scope, duplicate id) | yes | **LINT** — an `MF-VAL` rule (travels with the bundle, fail-closed *before* seed). Grow this family. |
| **CONVENTION** (instance rows in a reusable bundle, seed-above-max clamp, naming, tag/taxonomy) | yes | **LINT** — same `MF-VAL` family. |
| **SEMANTIC / modelling** (a predicate parses but doesn't *evaluate* as intended; wrong DC band; clumsy shape) | no | **GUIDANCE** (this file, at authoring time) + **live-prove** (proves it actually fires). |
| **SOURCING** (numbers from memory not the Foundry cache; markdown mirror instead of JSON) | no (process) | **GUIDANCE**. |

Principle: **anything deterministically checkable becomes a lint** (the hard
lever that *compels*). Guidance is the soft complement for judgment + sourcing
only — a prose rule that isn't loaded into a prompt prevents little.

Status legend used below: ✅ enforced (deterministic gate exists) · ⚠️ gap → lint
candidate (only-at-seed, partial, or grep-only — wants an `MF-VAL` promotion) ·
📖 guidance-only (not mechanically checkable).

## Detection timing — where each gate fires

| Surface | Codes / checks | When |
|---|---|---|
| **Static validate** | the `MF-VAL-*` family (static, 40+ codes) — `crates/spellkave-validate/src/refs.rs` | `spellkave validate` — *before* any node. Out-of-file frame-write refs hint (sk-zqc); `spellkave validate FILE --against <bundle>` or `--against live` resolves them against that existence-only index (sk-vjh.2). (`just check-manifest-refs`, the every-bundle CI gate over the central fixture pile, #1270, was retired 2026-08-11 alongside `world-fixtures/`'s move to `archive/world-fixtures/` — see `archive/README.md` Phase D.) |
| **Grep lint** | `srd-fixture-hygiene` instance-row prohibition | `just srd-fixture-hygiene` — pre-seed, bash regex |
| **Seed / apply** | the `MF-APPLY-*` family — the world API | `just seed` — DB constraint at commit (too late, fail-open until then) |
| **Live-prove** | server-observed non-recurrence (the RED→fix→RED-absent loop) | the TS runners / `companion-twins` — proves a predicate *evaluates*, not just *parses* |

The deterministic codes are **self-documenting in the source** — this catalog
does **not** copy them all; it indexes them by class and, critically, flags the
**gaps** (the recurring mistakes a code does *not* yet catch). That is the
catalog's value: it is the map of what is mechanized vs. what is still only
prose.

## Scope subtlety — hygiene is for *reusable* bundles, not *content* bundles

The `base/** = definitions-only, no instance rows` rule (catalog row **C1**) is
**scoped to reusable bundles** (`srd/`, and `core/`'s shared vocabulary), *not*
to content bundles. A content bundle (an adventure such as `elven_mini`, a
`packages/spellkave-mechanics` fixture) **legitimately
ships instance rows mixed with definitions** — that *is* the content. Applying an
`srd`-style hygiene check
blindly to every bundle would be **wrong**. See the per-bundle map for which
bundles are reusable (hygiene-bound) vs. content (instance rows expected).

## Per-bundle map

This is the table the auditor reads to know *which* rules apply *where*.

| Bundle | `depends_on` | Role | Hygiene-bound? (C1) |
|---|---|---|---|
| `core` (`packages/spellkave-mechanics/fixtures/core`) | `[]` | World-agnostic floor (login, primary action) | partial — shared vocabulary should stay definition-like |
| `srd` (`packages/spellkave-srd-cc/fixtures`, generated) | `[]` | The 5e ruleset (generic, **reusable**) | **yes** — `base/**` definitions only |
| `dm` (`packages/spellkave-srd-cc/fixtures/dm`) | `srd` | Reusable authored dialogue, wizard phase conditions and finite DM acts | **yes** — never names an adventure |
| `elven_mini` (`packages/spellkave-adventure-elven-mini/fixtures`) | `srd, dm` | One adventure (content) | no — instance rows expected |
| `packages/spellkave-mechanics/fixtures/<mech_*>` | mostly `core` | Single-mechanic proof bundles (content) | no |

Reuse boundary, stated plainly: `srd` is separate from an adventure bundle
because it is the **reusable ruleset** every adventure (elven-mini today, a
modder bundle later) `depends_on`. The split is also a **definitions-vs-instances**
discipline that pays off even with one adventure — it is what the C1 hygiene
lint protects. Do not fold `srd/` into a content bundle.

## The catalog

### STRUCTURAL / ref-integrity

| ID | Symptom | Current detection | Enforcement |
|---|---|---|---|
| **R1** | A row references an id that resolves only *outside* its bundle's `depends_on` closure (dangling / wrong-scope ref). | `MF-VAL-214` (Fatal, static) | ✅ |
| **R2** | A `capability_id` (global PK) is defined twice. | `MF-VAL-266` (static, `--bundle`) + `MF-APPLY-020` (seed) | ✅ — process-level guard: the mandatory pre-authoring existence check (step 0, [`authoring-process.md`](authoring-process.md), #1365) prevents the twin from being authored at all. |
| **R3** | A generated fixture emits an id a hand-authored sibling also defines — file-clean, duplicates only **at seed**. Fix: rename or skip-emit on one of the two emitters (the acid_splash pattern); after the merge run `just wipe && just seed && just publish` to confirm, or trust `--bundle --dep` now that it's a static gate. Process-level guard: the pre-authoring existence check (step 0, [`authoring-process.md`](authoring-process.md), #1365). | `MF-VAL-272` (Fatal, static, `--bundle --dep`) + `MF-APPLY-020` (seed) | ✅ (#1359) — generalises the R2/MF-VAL-266 raw-`Vec` duplicate scan to `entity_def_id`, `action_id`, `roll_table_id`, `outcome_template_id`, `resource_definition_id`, `condition_definition_id`, `state_id` (object_state_definitions), `slot_id`, `template_id` (affordance_templates), and `entity_key`. Sweep found + fixed two live corpus offenders (a duplicate `srd/ac` object_state_definition and a duplicate `core/condition/controlled` id namespace collision in a self-contained demo). |
| **R4** | Seed FK (`entity_definition_initial_state/_capability/_condition`) targets an id missing from the bundle + deps. | `MF-VAL-252/253/254/255` (Fatal, static) | ✅ |
| **R5** | A converter drops rows (validator accepts *fewer* rows silently). | none (validator is happy with fewer) | 📖 row-count check after extraction; auditor compares source-field count vs. emitted. |
| **R6** | Two seed rows write the same `(entity, state)` — a duplicate `object_state` / `entity_definition_initial_state` — and the later include **silently last-write-wins** (e.g. a Bat HP 5 clobbered to 30, historical evidence: `archive/world-fixtures/srd/coverage/spells-behavior.md`, since deleted whole — `world-fixtures-retirement` Phase D, 2026-08-14 — the failure class is unchanged, only its example anchor is gone). Not rejected; not clamped. | `MF-VAL-270` (static, **Fatal**) | ✅ (#1359 — ratcheted Warning → Fatal; corpus swept clean at 0 offenders) — distinct from C6 (bounds) and R2 (capability PK). |
| **R7** | An `[[entities]]` instance (esp. `kind = npc`/`player`) carries **no `entity_def_id`**, so `derive_entity_target_niches` returns `None` and it is **silently dropped from `candidate_targets`** — it can never be a communicate/manipulate target (the footgun `demos/green_herald.toml` exists to document). | none | 📖 — **NOT a clean lint**: a sweep shows bare `npc`/`player` entities are the *norm* (~30+ across core/srd/phandelver/demos — most are legit runtime actors, not intended targets), so a blanket Warning would flag half the corpus. "Forgot the def" vs "fine bare actor" is intent-dependent. Needs an intent-aware check (canon-warden, issue filed). The narrow sub-case *`entity_def_id` set but **dangling*** IS a clean ref-integrity candidate. |
| **R8** | A `[[metadata_attachments]]` row targets a missing world object (`target_kind` / `target_ref`) or uses an unregistered namespace / malformed payload. Without validation, author notes, driver personas, and art/narration pointers silently drift away from their objects. | apply-time metadata checks in `r_apply_world_manifest` + `spellkave-author manifest validate` namespace-shape checks; unknown `target_kind` also `MF-VAL-330` (static) | ✅ (#1765 + sk-jay0.3.5.15) — apply rejects unknown target kind, unresolved target ref, unregistered namespace, and malformed JSON; offline validate rejects unknown target kind (`MF-VAL-330`). Public `<bundle>.art.image` is legal on every admitted kind (not entity-only). Authoring docs live at [`metadata-attachments.md`](metadata-attachments.md). |
| **R9** | An actor that will act as the SENDER of a `manipulate`/`move` call (any connection's `connectedActorId`, or the driving actor of a beat) carries **no `[[actor_identities]]` row**. Validates clean, seeds clean — rejected only at **act time**: `r_manipulate`/`r_move` return `status: "rejected"` with `evaluation_provenance.failure_kind = "actor_authorization_failed"` / `"no control authority for actor <id>: sender not bound via actor_identity"` (the `#856` sender-binding gate, landed 2026-06-17, the world API). Targets-only actors (never a sender) need no binding. Fix: `[[actor_identities]]` row with `identity = "$sender"` (resolves to the applying/connecting identity at manifest-apply), mirroring `phandelver/base/actors.toml:55` hero. Found live 2026-07-04: 3 pre-06-17 phandelver beats (`speak-to-room.toml`, `ranger-mark.toml`, `share-the-way.toml`) authored their bespoke driving actors before this gate existed and never got the row. | none (validator is happy; only the live apply-path rejects) | 📖 — runtime-only failure mode, same shape as R7 (silently absent until exercised); a static lint would need to cross-reference every beat's `connectedActorId`/sender against `actor_identities` rows, which the validator has no visibility into (that's walkthrough-script knowledge, not manifest content) — no clean static detection identified yet. |
| **R10** | A location-dependent (place-provided) action/affordance has **no `spatial_niche_attachments` row** in the assembled manifest. Validates clean, seeds clean — rejected only at **act time** at `r_manipulate`'s `attachment_presence` precondition (no d20 ever rolls). Live evidence: sk-84i.1 wolf proof-scene forgot the `srd/niche/strikeable` attachment. Actor-/entity-provided niches and traversal templates do not need an attachment. | `MF-VAL-328` (static, **Warning**, sk-2wg) | ✅ — **Warning, not Fatal**: a reusable bundle (srd alone) legitimately ships niche-gated actions expecting a downstream scene to author the attachment. Definitions-only manifests (no `place_nodes`) are skipped. Combined-bundle-scope works for free (same as MF-VAL-273). RED tests in `refs.rs`. |
| **R11** | A formula (`entity_definition_item_dsl_source.source` or `ModifyResource`/`ModifyChannel` `delta_source`) reads `stat`/`effective`/`resource_max`/`resource_min` for an id that is not a kernel-projected fact and has no `resource_definitions` or `object_state_definitions` row — first useful error used to appear only when a player acts (`UnknownField`). | `MF-VAL-329` (Fatal with the full `depends_on` closure present or on live admission; Info when the closure is not fully present offline, as `MF-VAL-217`) | ✅ (sk-84i.7) — diagnostic names the owning row and missing symbol. Unknown macros in the same formulas stay `MF-VAL-318` / `MF-DSL-MACRO-UNKNOWN`. |

### CONVENTION

| ID | Symptom | Current detection | Enforcement |
|---|---|---|---|
| **C1** | Instance rows (`entities`, `actors`, `actor_spatial_locations`, `actor_capabilities`, `object_state`, `place_nodes`, `spatial_niche_attachments`, `actor_identities`) shipped in a **reusable** bundle's `base/**` — they leak into every world that loads it. | `srd-fixture-hygiene` grep lint (srd only, ratchet allowlist) | ⚠️ → **flagship promotion**: bash-grep, srd-only, doesn't travel with the bundle. Promote to an `MF-VAL` rule scoped to reusable bundles (#1268). |
| **C2** | A `bundle_id` violates the naming convention — snake_case (with `/` allowed as a namespace separator), aligned `file-stem == bundle_id == metadata.profile`. | `MF-VAL-271` (static, Warning) | ✅ — hyphen outliers migrated; the lint catches a regression. |
| **C3** | An `srd.weapon`-tagged `entity_definition` carries no `entity_definition_item_dsl_source` slot `srd/damage`. | `MF-VAL-268` (Warning, static) | ✅ (repointed sk-hml / #2184 — was `srd/damage_profile`) |
| **C3b** | An int `roll_table` is an identity-mapped uniform 1..N weight-1 table **without** a `die` tag (smuggled die / damage-profile class). | `MF-VAL-317` (Fatal, static **and live admission**) | ✅ (sk-s1e / #2184) — author `1dN`/`d20` or an item DSL-source slot; intentional named-die tables (`core/d20`) keep tag `die`. Live delta apply splices already-published headers/entries/die tags into the validation manifest (sk-3h5) so a second face on a living constant table is Fatal even when the delta omits the table. `roll_table('…')` refs against a published table admit via `LiveVocabulary`. |
| **C4** | An `srd/spell/<slug>` capability has no matching `srd/spell/<slug>` `entity_definition`. | `MF-VAL-264` (Warning, static) | ✅ |
| **C5** | Deprecated descriptor tags (`manipulation.action_id`, `communication.mode`) instead of the typed fields. | `MF-VAL-220/227` (Fatal) + `224/228/229` (Warning) | ✅ |
| **C6** | A seeded `entity_definition_initial_state` or instance `object_state` value exceeds the resource's `max` (or undercuts `min`) → **silently clamped**, not rejected. | `MF-VAL-269` (static, **Fatal**) | ✅ (#1359 — ratcheted Warning → Fatal; corpus swept clean at 0 offenders) — compares seed `value_int` vs. `resource_definition` bounds. |

### SEMANTIC / modelling

| ID | Symptom | Current detection | Enforcement |
|---|---|---|---|
| **S1** | A predicate / DSL string **parses** but does not **evaluate** as intended (e.g. reads the wrong `target.state(...)`, integer-division edge). Example: `niche_definitions.predicate_source` using `target.has_tag('…')` — niche admission has no tag facts, only niche facts, so the predicate is always false; write `target.has_niche('…')` instead. | `MF-VAL-256/257/261` prove *parse + value-type* only | 📖 + **live-prove** (the only oracle: server-observed RED→fix→RED-absent). |
| **S2** | Wrong difficulty modelling — a per-skill DC (`persuasion-dc`, `deception-dc`, …) instead of one intrinsic actor trait; a fixed DC where a contested check is the emergent shape. | none (parses fine) | 📖 prose-only: model ONE intrinsic actor trait and let contested checks emerge (the srd bundle's "modeling per-NPC social difficulty" coverage note retired with that bundle, 2026-08-14 — this row now carries the guidance). |
| **S3** | A **generic** mechanic is authored into a **content** bundle (`phandelver/`) instead of `srd/` — the layering-invariant violation. A 5e-named stat column / statblock table / bespoke schema shape (anti-fossil). The mechanizable subset — ANY bundle defining an id outside its own namespace, not just `srd/`-shaped ones — is `MF-VAL-291` (static, **Warning**, #1510). The remaining 5e-named-column / bespoke-schema-shape judgment call is not mechanizable. | `MF-VAL-291` (static, Warning) for the id-namespace subset; prose-only (4 agent files) for the schema-shape subset | ✅ (namespace subset, #1510) / ⚠️ (schema-shape subset stays canon-warden + guidance). |
| **S4** | Two (or more) `affordance_template` rows resolve the SAME `manipulation_action_id` — possibly at DIFFERENT niches — and EACH carries an independently stochastic predicate (a `d20`/dice/roll_table draw). The ADR-0021 D-2 Postscript retired the `priority` knob and promised a validation-time ambiguity diagnostic; `MF-VAL-341` (`affordance_selection.rs`) only covers the same-*niche* case. The act-time fan-out (`select_turn_aware`, the world API) evaluates every candidate across niches with its own fresh draw, first pass wins — a cross-niche overlap silently samples N independent rolls per act instead of the one each predicate individually implies (#1556 root cause). | `MF-VAL-273` (static, **Warning**, #1556) | ✅ — corpus swept clean for the known offenders: #1625 split `phandelver/hero/reactive_strike` away from `srd/attack/melee`, and #1629 split `phandelver/persuade` away from `srd/persuade`. |
| **S5** | Two (or more) `affordance_template` rows share the SAME `niche_id` AND `outcome_template_id` with identical eligibility (`predicate_source` + `predicate_bool`) — leftover copies that differ only in `template_id` / `range_m`. Runtime then silently picks one via the `template_id` tie-break (crypt-fight deadlock: a range-0 twin of `srd/attack/melee/affordance`). `MF-VAL-341` groups by resolved action and skips move/sense, so this identical-offer shape was invisible there. Distinct predicates on the same niche+outcome (the core traversal-gate catalog) are alternative gates and stay quiet. | `MF-VAL-327` (static, **Warning**, sk-j8e.3 / BL-39) | ✅ — RED fixture `crates/spellkave-validate/tests/fixtures/duplicate_niche_outcome.toml`. |

### SOURCING

| ID | Symptom | Current detection | Enforcement |
|---|---|---|---|
| **SO1** | A number comes from memory, not the SRD / Foundry `.fvtt-cache`. | none | 📖 "I don't know the SRD value" → say it, stop. Never guess. |
| **SO2** | A converter reads the lossy **markdown** mirror instead of the **JSON** cache. | none | 📖 always read the Foundry JSON; emit a per-field coverage report. |

## Checking native fixture regressions

Run `cargo test --manifest-path crates/Cargo.toml` from the checkout under
review. Cargo supplies the runtime package directory that the native tests use
to locate their fixtures, including the
[validator conformance fixtures](https://github.com/b4arena/spellkave/blob/main/crates/spellkave-validate/tests/conformance.rs).
A shared build cache can reuse the executable while it checks this checkout's
files. See the [shared Cargo cache guidance](https://github.com/b4arena/spellkave/blob/main/docs/development.md#shell-format-and-shared-cache-footguns)
for isolated reproductions and recovery from older compiled fixture paths.

When changing validator regression fixtures, also check every native test target
with the pinned Clippy toolchain:

```bash
cargo clippy --manifest-path crates/Cargo.toml -p spellkave-validate -p spellkave-validate-wasm --all-targets -- -D warnings
```

The [Rust crates CI lane](https://github.com/b4arena/spellkave/blob/main/scripts/ci/nx-projects/rust-crates-tests/project.json)
runs this command alongside the native tests. Construct default-based fixtures
with struct initializers for their authored fields; this keeps fixture setup
lint-clean without suppressing warnings.

## Lint-promotion backlog (STRUCTURAL + CONVENTION gaps → `MF-VAL` family)

Ranked by frequency × blast-radius. Each new rule needs a **RED falsifier test
before the rule exists** (a fixture that fails *without* the rule and passes
*with* it), then a regenerated validate-wasm pkg.

**Done:**

- ✅ **CI coverage gap (#1270) — historical.** `scripts/ci/check_manifest_refs.sh`
  validated **every** `world-fixtures/*` bundle + each `demos/*.toml` (each in its
  own `core`-based closure, via the `check-refs` Rust binary), gating the existing
  rules over the previously-uncovered bundles and surfacing two demo bundles that
  shipped fatal-invalid — both fixed in the same PR. The gate itself was retired
  2026-08-11 alongside `world-fixtures/`'s move to `archive/world-fixtures/` (see
  "Static validate" in the table above; `archive/README.md` Phase D) — `spellkave
  validate` / `sk validate --bundle --dep` remain the live per-invocation check.
- ✅ **C6 → `MF-VAL-269`** (seed `value_int` vs. `resource_definition` bounds,
  Warning). RED tests in `refs.rs`. Sweep: 0 current offenders.
- ✅ **R6 → `MF-VAL-270`** (no duplicate `(entity, state)` seed, Warning). RED
  tests. Sweep: 0 current offenders. Ratchet to Fatal once the corpus stays clean.
- ✅ **C2 → `MF-VAL-271`** (`bundle_id` snake_case, Warning; `/` allowed as a
  namespace separator like `tag_authoring/homebrew`). The convention is also
  *applied*: the hyphen outliers (`green-herald`, `actors-and-bodies`) and the
  stem-vs-id mismatches (`singular-event.toml`, `deferred-external-resolution/`,
  `dm-see-as-extent`, `identity-rebind`, `role-capability-write-gate`) were renamed
  so `file-stem == bundle_id == metadata.profile`. RED tests. Sweep: 0 offenders.
- ✅ **C6/R6 severity ratchet (#1359).** `MF-VAL-269` and `MF-VAL-270` promoted
  Warning → Fatal, exactly the ratchet both rows called for. Corpus sweep found
  and fixed one real `MF-VAL-269` offender:
  `srd/monster/carpet-of-flying-5-by-7-ft`'s SRD-sourced (not mis-imported) STR
  40 seed, clamped to the resource's SRD-faithful 30 ceiling at import time
  (`archive/packages/spellkave-srd/src/import/import-foundry-actors.ts`, now archived, matching what the runtime clamp
  already did silently). `MF-VAL-270` swept clean at 0 offenders.
- ✅ **R3 → `MF-VAL-272`** (#1359, "duplicate id across generated + hand-authored
  bundle-closure rows"). Generalises the R2/`MF-VAL-266` raw-`Vec` duplicate scan
  (previously `capability_definitions.capability_id` only) to every other
  globally-unique definitional id column authors actually generate content for:
  `entity_def_id`, `action_id`, `roll_table_id`, `outcome_template_id`,
  `resource_definition_id`, `condition_definition_id`, `state_id`
  (object_state_definitions), `slot_id`, `template_id` (affordance_templates),
  `entity_key`, plus (surfaced by the sweep) `discipline_id`
  (stacking_discipline_definitions) and `policy_id`
  (condition_remove_policy_definitions). Fatal, static, fires under
  `--bundle --dep` exactly where R3's "only-at-seed `MF-APPLY-020`" symptom used
  to hide. RED tests in `refs.rs`. Sweep found and fixed two real offenders: a
  duplicate `srd/ac` object_state_definition (`base/monsters.toml` — the
  generator, which needs the row for its own standalone self-validation gate —
  vs. `base/armor.toml`, which now defers to it, the acid_splash pattern applied
  in the generator-wins direction) and `demos/build_fixture.toml` privately
  re-declaring `core/stacking/single` / `core/remove_policy/independent_lifetime`
  / `core/condition/controlled` — a self-contained demo (no `depends_on`) that
  collided with core's real namespace once layered onto an already-seeded core
  in the normal dev loop; renamed into the demo's own `build_fixture/...`
  namespace instead.

- ✅ **S3 (generalised) → `MF-VAL-291`** (#1510c) — generalises "no `srd/`-shaped
  id defined outside `srd/`" from the single `srd` namespace to EVERY bundle: a
  row that DEFINES an id (not one that merely *references* another bundle's
  vocabulary — Class 5/`MF-VAL-214` already covers dangling/wrong-scope refs)
  must live under its own `bundle_id`'s namespace. Scope mirrors `MF-VAL-272`'s
  definitional-id universe (`entity_def_id`, `action_id`, `roll_table_id`,
  `outcome_template_id`, `resource_definition_id`, `condition_definition_id`,
  `state_id`, `slot_id`, `template_id`, `discipline_id`, `policy_id`) plus
  `capability_definitions.capability_id` and the two instance-row id classes
  the sibling stacking-collision work targets, `entities.entity_key` and
  `place_graphs.place_graph_id`. RED tests in `refs.rs`. **Warning, not
  Fatal** — the #1510 coordination note (2026-07-02T19:13Z) is binding: a new
  Fatal lint landing mid-loop must never redden the running Phandelver
  night-loop's PRs, the same MF-VAL-270/271/272 posture as #1359. **Corpus
  sweep is NOT clean** (unlike the 0-offender starts of C2/R6/C6) — 96 distinct
  `(id, bundle)` offenders across 20 bundles: `place_graph_id = "fixture"` (×4)
  and `entity_key = "actor"` (×5, one more than #1510's tracked count) are
  being renamed by the sibling `change/1510-stacking-collisions` branch; `core`
  itself defines 6 foreign-namespace ids (`frontier.apply_manifest`,
  `homebrew/item/horn_blade`, `homebrew/horn-sheath`, place graphs `inn`/
  `village`/`zzz_storage_closet_blueprint`); `demos/deferred_external_resolution`
  abbreviates its own namespace (`deferred/*` instead of
  `deferred_external_resolution/*`, 7 ids); the remaining ~80 are `demos/*`,
  `srd`, and `phandelver` content bundles' own bare (non-namespaced) instance
  ids (`entities.entity_key` / `place_graphs.place_graph_id`) — pre-existing
  convention across nearly every content bundle, `phandelver`'s ~20 location
  blueprints included. Full breakdown in the PR body (refs #1510).

- ✅ **S4 → `MF-VAL-273`** (#1556) — the ambiguity diagnostic the ADR-0021 D-2
  Postscript promised but the existing `MF-VAL-341` never delivered:
  `MF-VAL-341` groups candidates by `(niche_id, action_id)`, so a genuine
  overlap between candidates on *different* niches was invisible to it, even
  though the act-time selection fan-out (`select_turn_aware`) evaluates
  candidates across every niche in scope for the requested action. `MF-VAL-273`
  groups by `action_id` ONLY and additionally requires EVERY candidate in the
  group to carry an independently stochastic predicate
  (`spellkave_dsl::count_static_draws(predicate) > 0`) — a deterministic or
  single-stochastic-candidate group is not flagged, since only the
  all-stochastic case silently changes the act's effective pass rate. RED
  tests in `affordance_selection.rs` (4 cases: cross-niche same-action
  both-stochastic warns; same-action one-static-one-stochastic is quiet;
  same-stochastic-different-action is quiet; single-candidate is quiet).
  **Warning, not Fatal** — same posture as MF-VAL-341/270/271/272/291 (a new
  Fatal lint must not redden an in-flight corpus). **Cross-bundle scope
  works for free**: `validate_manifest` (and thus this lint) runs on whatever
  `Manifest` it is handed, and the `check-refs` binary already
  merges `core + srd + phandelver` into one combined `Manifest` before calling
  it (the runtime's own admission order) — no architectural change was needed
  to see across bundles. **Initial corpus sweep found 2 live offenders**:
  `srd/attack/melee` (`srd/attack/melee/affordance` +
  `phandelver/hero/reactive_strike/affordance`, the #1556 root-cause pair,
  fixed by #1625) and `srd/persuade` (`srd/persuade/affordance` +
  `phandelver/persuade/affordance`, gated at two different DCs — a fixed 21
  vs. Toblen's own `phandelver/persuasion-dc` stat — fixed by #1629). Current
  combined-bundle sweep is clean of `MF-VAL-273`.

- ✅ **R10 → `MF-VAL-328`** (sk-2wg) — a place-provided niche used by a manipulate affordance must have ≥1 `spatial_niche_attachments` row in the assembled Manifest. **Warning, not Fatal** (reusable bundles expect a downstream scene to attach). Definitions-only (no `place_nodes`) skipped. RED tests in `refs.rs`. Actor-/entity-provided niches and traversal templates are exempt.
- ✅ **Duplicate `consequence_frame_writes` ordinal per template → `MF-VAL-335`**
  (manifest-natural-keys 1.3) — two `[[consequence_frame_writes]]` rows of the
  same `template_id` MUST NOT share an `ordinal`. **Fatal**: the storage key is
  `(template_id, ordinal)` (task 1.1) and the server replaces a template's
  whole ordered write list on every apply, so a duplicate ordinal would abort
  the apply on a primary-key collision halfway through instead of failing
  cleanly at authoring time. RED tests in `crates/spellkave-validate/tests/cross_row_refs.rs`.
- ✅ **Unknown visibility token → `MF-VAL-337`, unknown `elevation_class` → `MF-VAL-338`**
  (sk-jay0.7.174.29) — every authored visibility field
  (`object_state_definitions.default_visibility`,
  `capability_definitions.default_visibility`, `object_state.visibility`,
  `actor_capabilities.visibility`, `spatial_niche_attachments.visibility`,
  `spatial_environment_state.visibility`) MUST be `public`, `local`,
  `hidden`, `internal` or `discoverable` (either capitalisation), and
  `actor_capabilities.elevation_class` MUST be empty, `hidden`, `internal` or
  `full`. **Fatal**. Before this rule, a typo such as `visibility = "private"`
  passed validation, failed only inside the scheduled drain, and the author saw
  the generic `MF-APPLY-029` about 90 s later. Tests in
  `crates/spellkave-validate/src/visibility.rs`; the server pins both token
  lists to its parsers (`parse_authored_matches_offline_validator_tokens`,
  `elevation_ceiling_matches_offline_validator_tokens`).

**Open:**

1. **C1 → `MF-VAL` "no instance rows in a reusable bundle's `base/**`"** (#1268) —
   promote the `srd-fixture-hygiene` grep into the validate crate, scoped by a
   per-bundle reusable/content flag. **Deferred:** ships *inert* (fires on 0 real
   manifests until the srd allowlist burn-down completes); the grep already
   enforces it. Build alongside the burn-down, not before.
2. **`MF-VAL-291` Warning → Fatal** — the ratchet this row calls for (same
   posture as C2/R6/C6). **Promotion condition:** the corpus must sweep clean
   first, and unlike those three rules this one did **not** start clean (see
   the Done entry above) — the burn-down is the sibling stacking-collision
   renames (in flight) **plus** a considerably larger follow-up pass over
   `core`'s own 6 offenders, `deferred_external_resolution`'s abbreviated
   namespace, and every content bundle's bare instance ids (`phandelver`'s ~20
   location blueprints are the biggest single chunk). Not a "next loop-quiet
   window" flip like #1359 — size the burn-down as its own tracked follow-up
   before proposing the Fatal flip.

## <a id="why-one-place"></a>Why one place

Before this file, the same rules lived in ~6 places — `SRD-MAP.md` pitfalls,
`world-fixtures/CLAUDE.md`, `check-srd-fixture-hygiene.sh`, the `MF-VAL` comments
in `refs.rs`, the layering invariant repeated across four agent files, and
`coverage/social.md`. Nine duplicate groups. A rule in six places drifts; a rule
the authoring agent never loads prevents nothing. Consolidating to one catalog,
with enforcers pointing here, is the DRY lever: the knowledge has one home, and
the lints/agent/skill are *downstream* of it.
