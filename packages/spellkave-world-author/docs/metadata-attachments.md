# Metadata Attachments

Metadata attachments are validated annotations on authored world objects. They
are for humans, tools, and non-player clients, not for server behavior.

The rule from ADR-0073 is the contract:

> Does the world behave differently if the datum is missing? Then it is not metadata.

Reducers, DSL predicates, schedulers, and perception materialisation must not
read `payload_json` semantically. A client may read metadata, but if the server
must enforce the result, promote the datum to a typed table or world data.

## Placement Ladder

Use this ladder before adding a `[[metadata_attachments]]` row:

| Rung | Use when | Mechanism |
|---|---|---|
| 1 | An actor should perceive it in-world | Typed world data behind perception, such as description columns |
| 2 | The DSL gates or selects on it | Relational tags |
| 3 | The server computes with it | A typed domain table |
| 4 | Only authors, tools, UIs, observers, or drivers read it | `[[metadata_attachments]]` |

Examples of the wrong rung:

- "This edge costs double movement" is not metadata; movement changes.
- "This creature is undead for a spell predicate" is not metadata; use tags or a typed table.
- "This room has an author TODO" is metadata.

## Row Shape

The `phandelver`/`triboar_*` ids in this page's examples are schematic: no
live fixture carries them. Substitute your own bundle's ids.

```toml
[[metadata_attachments]]
target_kind = "place_node"
target_ref = "triboar_trail/ambush_site"
namespace = "editorial.note"
payload_json = '{"text":"Review the clue wording before public release."}'
bundle_id = "phandelver"
source = "manifest"
```

`target_kind` is one of `entity`, `entity_definition`, `item_definition`,
`affordance_template`, `place_graph`, `place_node`, `place_edge`,
`resource_definition`, `capability_definition`, `bundle`, or
`prompt_definition` (`TARGET_KINDS`, the world API,
mirrored by `METADATA_TARGET_KINDS` in
`crates/spellkave-validate/src/metadata_attachments.rs`). `target_ref` must
resolve at apply time. `source` defaults to `manifest` in the authoring
surface. Offline validate rejects an unknown kind (`MF-VAL-330`); live apply
rejects unknown kinds and unresolved refs.

Use `bundle` for content that belongs to the bundle as a whole and to no
subject in it, such as a docs page shell or chapter prose. Its `target_ref` is
a `[[bundles]]` `bundle_id` that is committed when the attachment applies,
normally the attaching bundle itself:

```toml
[[metadata_attachments]]
target_kind = "bundle"
target_ref = "srd"
namespace = "srd.text"
payload_json = '{"text":"This work includes material from the System Reference Document 5.2.1.","source":"SRD 5.2.1","license":"CC-BY-4.0"}'
bundle_id = "srd"
source = "manifest"
```

Content about one subject still attaches to that subject's own kind; `bundle`
is not a shortcut around a missing subject row.

## Native NPC driver documents (local stage 2)

ADR-0165's quest-giver port uses this client/driver rung. The source is an
adventure-owned TOML document, compiled through
`@spellkave/world-author/npc-quests` and the shared Rust validator into ordinary
metadata attachments, read capabilities and sealed NPC job references. Existing
authored actions still enforce acceptance and progress changes. The server does
not interpret the driver payload as a predicate or consequence.

The current quest compiler accepts `schema_version = 1`, one `quest-giver` kind,
`hooks = {}`, the legacy quest shapes, configured giver boards, and
explicit action/flag/state/blueprint/place references. It validates those
references against the supplied dependency worlds before returning an artifact.
Unknown kinds, hooks, slots and versions refuse compilation. Missing reference
targets refuse except the explicitly reviewed missing-flag set tied to
`sk-jay0.3.4.11`; the compiler reports those as `known-missing`. The adventure's
`tests/offline/npc-quest-documents.test.ts` pins that exception set so it can only
shrink. This is the initial quest-giver protocol, not an arbitrary scripting surface.
The canonical authored example is the repository source file
`packages/spellkave-adventure-elven-mini/author/quests.toml`.
The repository test `packages/spellkave-world-author/src/__tests__/npc-quests.test.ts`
pins compilation, dependency closure, canonical hashing and tamper refusal.

A board's private lines and own quest references attach to its actor's metadata
namespace. Shared catalog metadata contains terminal descriptions without private
spoken lines. Each job pins the NPC kind, schema version, private and shared
namespaces, and shared catalog content hash. Admission checks the stored targets,
each payload's self-declared hash and the matching publication IDs; the private
payload hash is not independently pinned by the job. An actor receives read
capabilities for its own document and the shared catalog. Another giver's private document remains outside that read
capability. A document reference supplies no action or DM authority. The native
host's repository document `crates/spellkave-npc-host/QUEST-DOCUMENTS.md` defines
the replay and admission contracts, refusal names and local proof setup.
This variant stays unwired from hosted adventure bundles until stage 3.

### Generated DM runtime table input

`@spellkave/world-author/npc-dm-srd` compiles the platform's existing SRD runtime
tables into `{schema_version: 1, tables, content_hash}`. `compileDmSrdData(tables)`
uses the shared Rust/WASM schema; `parseDmSrdData(json)` validates again and
checks the canonical content hash. The schema preserves source strings, array
order, null defense abilities and absent optional cantrip maps. Unknown fields,
duplicate table rows/keys, unsafe numbers and inconsistent caster references
refuse admission. Tests in `src/__tests__/npc-dm-srd.test.ts` and
`crates/spellkave-validate/tests/dm_srd.rs` pin these checks.

This is offline compiler input for the opt-in trusted DM duty carrier below.
The standalone table artifact supplies no read, write or DM authority. The
enclosing carrier requires separate publisher and runtime admission. Do not
put privileged table/configuration fields into an NPC's editable persona
document.

In the repository, `pnpm exec tsx scripts/export-dm-srd-catalog.ts` exports all
nine unchanged `adventure-runtime/src/dm/data/srd-catalog.ts` tables to
`crates/spellkave-npc-host/corpus/documents/dm-srd-v1.generated.json`.
The `dm-srd-data-drift` registry gate runs the exporter with `--check` to compare
without writing. The adventure's `tests/offline/dm-srd-data.test.ts` compares the
generated values to every source table, including real prose and caster rows.
This stage adds no ruleset rows and does not activate a hosted DM engine.

### DM presentation component

`@spellkave/world-author/npc-dm-presentation` exposes
`compileDmPresentationJson(value)` and `validateDmPresentationJson(json)`.
Both use `spellkave-validate` through WASM. Raw JSON validation retains duplicate
field checks before JavaScript parsing. The schema contains voice, creation and
level-up text, companion-offer rule/summary labels, invitation text and quest-board
prompt lines. It rejects
act IDs, targets, quantities, recipients, kits and extents as structural fields.
Labels are presentation values and cannot grant or select an authored action.
The required `companion_offer.agreement_reopen` label contains bounded, nonblank
`rule` and `summary` strings, with the same admission as agreement accept and
decline labels. The exporter calls the existing TS `agreementRule("reopen")`
and copies `agreementSummary`; it does not infer a Rust-side label. Missing
labels and nested authority fields refuse admission. Older unshipped stage-2
presentation documents require regeneration.

The required `voice.persona_slug` copies the authored TS seat `personaSlug`
exactly for cycle-error step labels. It is a nonblank string of at most 16 KiB;
older unshipped presentation documents require regeneration.

The required `quest_board.lines` maps quest references to plain `greeting`,
`accept`, `decline` and optional `complete` strings, using the existing giver
line vocabulary. Every supplied string is nonblank and at most 16 KiB; unknown
structure, null values and authority fields refuse admission. The running TS
board and presentation exporter share the same `QUEST_PROMPT_LINES` projection.
The complete carrier additionally checks its keys and source text against the
admitted duty board and catalog source below. Older unshipped presentation
documents require regeneration.

Computed creation and class-flavour lines use flat text/value segments with
field-specific display slots. There is no callback, expression evaluator, world lookup or recursive
template. Shared `MAX_TEMPLATE_PARTS` and `MAX_TEXT_BYTES` bound each template
to 64 parts and each text value to 16 KiB. Literal whitespace parts are preserved;
plain display fields still require nonblank text. Callers supply preformatted display values; native concatenation
rejects missing/extra inputs and bounds output at 256 KiB. Progress guidance
declares separate ready/missing text. The exporter
`scripts/export-dm-presentation.ts` captures unchanged legacy lines; a separate
test-only artifact records 86 rendering cases compared by native and TS tests.
`dm-presentation-data-drift` checks both generated files without writing.

This component does not emit metadata rows, read grants, a trusted duty document,
a publication envelope or a mounted-engine declaration. The enclosing compiler,
publisher and activation admission must validate those separately. The expected
rendering cases are test assertions and must never be mounted as engine inputs.
Its negative tests prove component checks. The carrier parser below separately
tests publication-artifact refusal; live publication and activation negatives
remain owed by `sk-jay0.3.33.7.7` and its integration owners.

### Opt-in DM carrier compiler

`@spellkave/world-author/npc-dm-documents` exports
`compileNpcDmSource(sourceJson, canonicalWorlds)` and
`parseNpcDmArtifact(artifactJson, canonicalWorlds)`, both returning
`Promise<NpcDmArtifact>`. The strict JSON source contains original principal
plan P, explicit read IDs, the existing compiled quest catalog, presentation,
typed duties and Job-only reference locators. Raw duplicate fields, unknown
fields, unsupported versions and broken canonical references refuse. The
parser rederives all artifact fields, rows, Pdocs, hashes, locators and grants.

The required `level_up.class_flavour` and `level_up.offer_with_class_flavour`
are flat display templates captured by calling the TS `classFlavourLine` and
`levelUpOfferUtterance` functions. Their slots are respectively `class_name` +
`primary_ability` and `offer` + `class_flavour`; the append separator is
captured literal text. The consumer uses the base offer when class flavour
is absent or empty. Unknown class metadata suppresses flavour in the TS seat
but throws in its class-grant path; these are distinct behaviors. Templates
carry no action authority, callbacks, expressions or world-row lookups.
Missing fields, invalid slots, unknown structure and existing size bounds
refuse admission; older unshipped presentation documents require regeneration.

The required `duties.quest_board.quest_refs` is a nonempty list of distinct,
nonblank quest references bounded to 16 KiB each. It preserves the actual TS
board selection order; presentation map order supplies no scheduling policy.
Each reference resolves to an independently admitted catalog quest owned by
`giverKey == body_key`. Body presentation `quest_board.lines` must have exactly
the same keys. Source admission also requires each line object to equal that
quest's `prompt_lines` from the compiled authored quest source; the runtime
catalog omits prose and runtime admission instead checks ownership, key closure
and the existing document hash/publication links. Both exporters consume the
running TS board's shared projection, without a new giver document, locator or
read grant. Missing fields, unknown/foreign quests, duplicate references,
mismatched keys and source prose drift refuse admission. Regenerate both source
and presentation fixtures for this opt-in unshipped carrier extension; it does
not activate a native DM engine.

The required `duties.layer_topology` captures the ordered story-layer IDs and
role links from `ALDWIN_LAYER_TOPOLOGY`, shared with the actual TS layer factory.
`ordered_ids` preserves highest-priority-first order and contains exactly the
two distinct role IDs, each nonblank and bounded to 16 KiB. `companion_offer_id` and
`quest_board_id` are distinct members of that list. `companion_yields_to` is a
possibly empty list containing at most the quest-board ID. Extra layers are
refused until a corresponding producer and consumer ship.
An active layer named in that list suppresses the companion layer's observation
and decision for that cycle; the existing ceremony controls remain separate.
The source constants drive the real TS IDs, array order and `mayRun` check, so
capturing the topology does not introduce a second authored table. IDs remain
open vocabulary; they grant no read or dispatch authority and are not canonical
world-row references. Unknown structural fields, missing links, duplicate IDs,
dangling yields and self-yields refuse admission. Older unshipped stage-2 duty
documents require regeneration. Native engine consumption belongs to the
companion/body-arbitration work; this carrier change does not activate it.

The required `duties.creation.observation_vocabulary.class_tag_prefix` is
the exact query prefix shared with the TS class reader. It must be nonblank,
bounded to 16 KiB, and concatenate with each admitted class slug to that
class's identity tag. Each slug must be nonempty and contain no dot, matching
the TS reader's single-segment rule. It is separate from the class speech-menu
token and is not inferred from an identity tag. A future native class reader skips
only the class grant and offer flavour for multiple matching class tags,
returns normally with the approved `wait/ambiguous-class-tag` diagnostic and
continues other duties; TS ordering for that ambiguous case is undefined.
This carrier does not activate that consumer or change the TS choice.

Class-grant bounds come from each admitted `advancement_tags` level domain,
not a native literal or story maximum level. The exporter checks every full
ladder against the same source bounds used by the TS runtime renderer.
Canonical admission compares its whole tag domain with the authored action
selection, so a removed/truncated ladder refuses before activation. A level
without an admitted tag is not synthesized into an action argument; preserve
the source refusal/throw boundary. An existing tag with no level-specific
feature still dispatches the advancement act.

Each `duties.creation.observation_vocabulary.ability_states` row requires an
`aliases` list for score input. Every alias must be a nonempty ASCII letter,
digit or underscore sequence; the list must contain the row's canonical
`ability` key, ignoring ASCII case. Aliases must be unique ignoring ASCII case
both within a row and across all ability rows. Missing lists, ambiguous aliases
and regex syntax refuse admission. The repository exporter imports the existing
creation parser's `ABILITY_ALIASES` table and checks every alias against that
parser before emitting duty data. The native validator's `tests/dm_duties.rs`
pins required fields, malformed/colliding aliases and alternate ability names.

The required `observation_vocabulary.menu_tokens` declares the existing
creation parser's literal namespace, relative token prefixes, array-adoption
token, decimal score width and ordered ability keys. Score order must contain
exactly the admitted ability inventory. Prefixes must be nonempty literal
paths ending in `/`, without overlapping branches; class and origin tokens
must agree with their declared prefix and slug. The exporter imports
`CREATION_MENU_TOKEN_GRAMMAR` from the TS source, and that parser consumes the
same constants. Codec labels describe wire decoding, not executable action
references: choice components retain permissive base64url and replacement
UTF-8 decoding; adopted text requires lowercase, even-length hex and valid
UTF-8. Unsupported codecs, missing fields, inconsistent orders and ambiguous
prefixes refuse admission. Native mutation controls in `tests/dm_duties.rs`
and the TS creation projection test protect this contract. Older unshipped
stage-2 documents must be regenerated; there is no inferred namespace fallback.

The required `duties.creation.presentation_vocabulary` carries creation display
text and candidate aliases, exported from the TS runtime's
`CREATION_PRESENTATION_VOCABULARY`, which the TS call sites also consume.
`menu_labels` names class, background, species, skill, cantrip, prepared spell,
starting kit, name, ability scores and confirmation menus. `missing_phrases`
names class, background, species, name, skills and kit omissions; `list`
contains the empty-list word and pair, ordinary and last separators. These
labels and the empty-list word must be nonblank and at most 16 KiB each.
Separators must be nonempty and at most 16 KiB; literal whitespace is preserved.
Their wording is admitted data.

`templates` requires each listed placeholder exactly once, in any order:
`count_kind` uses `{kind}` and `{remaining}`; `kit_option` uses `{letter}`
and `{description}`; `equipment_page` uses `{source_text}`, `{page}` and
`{pages}`; `equipment_more` uses `{page}` and `{pages}`; `adopt_name`
uses `{name}`; `remaining_one` and `remaining_many` use `{remaining}`;
`answer_option` uses `{index}`. `adopt_array` and `confirm` contain no
placeholders. Unknown, repeated, missing or unmatched braces refuse admission.
Substitution is literal, without recursive interpolation or executable code.

`spoken_confirm_aliases` and `spoken_discard_aliases` are nonempty lists of
at most 64 distinct phrases, each at most 256 bytes, trimmed and containing
lowercase ASCII letters, spaces, apostrophes or hyphens and at least one letter.
They must be disjoint and must not equal a canonical class, species or
background display name. Slash-delimited menu tokens cannot match the admitted
spoken alphabet. The existing TS normalization trims, lowercases and
removes terminal `.!?` before comparing. `text_field_aliases` requires
nonempty `name`, `appearance` and `backstory` lists, at most 64 aliases per
field and 64 bytes per alias. Each alias contains only ASCII letters,
digits or underscores; aliases must be unique ignoring ASCII case within and across text fields
and disjoint from ability aliases ignoring ASCII case. Keyed-text matching
retains case-insensitive word boundaries, last-key-wins parsing and existing
field-specific termination and length bounds. These aliases and display labels
confer no dispatch authority. Spoken aliases select proposal parsing; typed
forms instead use the separate required `creation.input_field_keys` (name,
appearance and backstory), exported from `CREATION_INPUT_FIELD_KEYS`, which
also authors the forms. Those wire keys are distinct nonblank ASCII
alphanumeric/underscore strings of at most 64 bytes. Typed values use the same
field-specific termination and length checks directly, without rebuilding keyed
speech. They retain the legacy rule that the last matching field alias inside a
form value wins before termination (for example, `Renn; name=Bob` yields `Bob`).
Native mutation
controls in `tests/dm_duties.rs` protect these admission rules; the TS runtime's
creation tests protect existing output and parser behavior. Older unshipped
stage-2 documents require regeneration with the new required field.

The required `duties.creation.kit_granted_value` is a positive JavaScript-safe
integer exported from `CREATION_KIT_GRANTED_VALUE` in the TS kit authoring
source. The authored marker bound, atomic completion write and TS completion
reader share that constant (currently 1). Canonical kit admission derives its
expected completion delta from this value and refuses a value that disagrees
with the whole canonical action consequence. The canonical marker must also
satisfy `min_value <= initial_value < kit_granted_value <= max_value` (an omitted
initial value uses `min_value`, matching the kernel), preventing clamping and
completion at birth. This is completion state data,
not a dispatch grant; older unshipped documents must be regenerated.

`duties.creation.classes` is the creation menu. It may offer fewer classes than
`srd.classes`: it must be a non-empty list of distinct classes, each of which is
an admitted SRD class. A class outside the SRD data refuses admission, and so
does a `duties.creation.kits[]` entry whose class is not in the menu, so an
exporter that narrows the menu drops those kits too. `srd.classes` itself stays
complete. `duties.creation.species` and `duties.creation.backgrounds` must still
equal the admitted SRD lists. The native validator test
`creation_classes_are_a_nonempty_subset_of_the_admitted_srd_classes` in
`crates/spellkave-validate/tests/dm_duties.rs` covers the subset, an unknown
class, a stray kit and an empty menu.

The reference checks over the real worlds follow the same rule. The class
identity act may declare more class tags than the menu offers, so the menu
classes must be a non-empty subset of that act's tag domain. The class-derived
training lists (`skill`, `cantrip`, `prepared_spell`, `proficiency`) stay the
complete populations the training acts write; they must contain everything an
offered class can train. Origin feats and choice members must still equal their
complete lists. Do not narrow the training lists when you narrow the menu: the
training act's exact tag write is still checked against every member.
`crates/spellkave-validate/tests/dm_reference_metadata.rs` covers both.

`duties.watches.initiative.on_sight` is optional. The DM's initiative watch
(`mode = "legacy"`) calls initiative when it sees an attack between a party
body and a listed hostile. With `on_sight` it also calls initiative when one of
the listed hostiles and a party body come to share a node:

- `actor_keys`: non-empty, distinct members of `hostile_actor_keys`. Only these
  hostiles open a fight by a meeting.
- `unseen_condition_ids`: condition definitions that keep a party body's
  arrival from opening a fight (for example `srd/condition/invisible`).
- `peace_condition_ids`: condition definitions on the hostile that switch the
  trigger off for it. A no-kill ending that leaves the hostile and the hero in
  one node must set one, or the hero's next return opens a fight.

All three lists are required when the object is present; the two condition
lists may be empty and must not share an id. The object is refused with
`mode = "controller"`. Every condition id must resolve in the admitted worlds.
The trigger is a meeting, not perception: the DM does not read what another
body sees. Whoever already stands together when the host starts is no meeting.
A call the world refuses is not repeated for that meeting; the two must part
and meet again.
Design: `ledger/designs/initiative-on-sight.md`; tests:
`on_sight_initiative_is_optional_and_refuses_empty_unlisted_or_controller_use`
in `crates/spellkave-validate/tests/dm_duties.rs` and
`a_meeting_with_a_listed_on_sight_hostile_opens_initiative_once` in
`crates/spellkave-npc-host/src/dm/engine/watches/reward_tests.rs`.

Each `duties.creation.classes[].advancement_tags[]` ladder row also requires
`missing_capability_definitions`, an ordered list exported from
`grantableAdvancementCapabilities(target, classSlug, level).missingCapabilityDefinitions`.
It may be empty; members must be distinct, nonblank and at most 16 KiB.
The exporter asserts each listed capability is still absent from the canonical
SRD population. These are source-reported absent capability definitions, not
canonical foreign
keys or executable grants. The existing contiguous ladder domain supplies the
class and level; no missing-list fallback is inferred for older documents.

The required `duties.watches.initiative` selectors are
`trigger_capability_ids` (a nonempty list of distinct bounded, nonblank capability
references), `party_tag_id` and `hostile_tag_id` (distinct bounded, nonblank tag
references). Capability IDs must resolve in canonical `capability_definitions`;
both tags must resolve in `tag_value_definitions`. The exporter uses the TS
initiative tick's `DEFAULT_INITIATIVE_TRIGGER_CAPABILITY_IDS` unless its config
provides an override, and the existing encounter faction-tag constants. These
selectors confer no capability or binding authority. Party-tag precedence and
the requirement that hostile participants also belong to `hostile_actor_keys`
remain the consumer's existing policy. HP and exact death-condition selectors
reuse `creation.observation_vocabulary.hp_state_id` and
`watches.kill_xp.dead_condition_id`. Missing selector fields in older unshipped
stage-2 documents require regeneration; no ruleset fallback is inferred.
Shape mutations in `tests/dm_duties.rs` and missing canonical-reference controls
in `tests/dm_reference_metadata.rs` protect these requirements.

Canonical inputs are complete publisher-admitted flattened roots after the
publisher's original-P fresh preparation, followed by an independently parsed
quest artifact's manifest contribution. The compiler never prepares content or
self-injects its embedded catalog into those inputs. It retains all raw roots;
only the separate authority adapter projects its consumed columns. Boundary
definitions stay in the raw inputs and cannot be queried through the DM global
reference index. Existing no-document artifacts keep their existing parsers.

The manifest contributes two read capabilities, one reader role, two private
namespaces, the body's presentation grant and two document attachments. Its
principal plan adds exactly one bundle reader binding to P; no binding subject
is emitted by this compiler. Original act selectors, fiction powers and sight
remain in P. Locator fields are exactly `catalog_namespace` and
`reader_binding_id`. Each declared read grant has `socket_role`, `target_kind`,
`target_ref`, `namespace`, `read_capability_id`, `content_hash` and
`publication_id`; socket roles are `principal` or `body`.

Runtime duties omit kit item recipes and all Job reference locators. Both
documents include canonical content hashes and the same initial DM
source-hash publication ID; duties independently link the existing catalog's
hash and publication ID. Each complete document is bounded at 256 KiB.
Shared Rust/WASM facets check content, finite policies, hashes and bounds.
The repository tests in `src/__tests__/npc-dm-documents.test.ts` cover actual
compile/parser consumers and real Web WASM, including all seven forbidden
presentation fields across the admitted structural paths. These checks supply no observed-target,
read-grant, live-credential, assignment, publication or engine-activation proof. Publisher and
activation owners must verify actual rows and owned reads before readiness.
This carrier remains unwired from hosted inputs until stage 3.

For repository development, finish `just build-validate-wasm` and
`just build-authoring-wasm` before invoking pnpm or registry gates: wasm-pack
temporarily replaces the workspace package manifests during generation.
Checks started during that replacement can report missing workspace packages;
rerun them after generation completes.

## Row Identity

A `[[metadata_attachments]]` row's identity is `(target_kind, target_ref,
namespace)`, scoped to its `bundle_id` — the same key the server stores as
the row's primary key and upserts on (ADR-0146; `metadata_attachment_key`
and `add_metadata_attachment`, the world API). The
database refuses a second row for one identity. Player and MCP output name an
attachment by this key string (`provenance.attachment_id`). Re-declaring the same identity with a
changed `payload_json` (an editorial revision, for instance) lands the new
payload/audience/source in place; it does not create a second row. This is
also the applyset row identity (`crates/spellkave-schema/src/row_identity.rs`,
ADR-0145): `sk dev seed`/`apply-bundle` and `spellkave manifest applyset
show` track and hash metadata attachments the same way they track any other
row kind, instead of only counting them. They cannot prune one: there is no
retraction kind for `metadata_attachments` (`MF-VAL-293`). Retracting an entity
also leaves any attachment that names it in place. That slice waits on bead
`sk-jay0.7.186.5.9` (`design.md` D-6 of change `applyset-prune-placed-entities`).

## Action Definition References

An affordance whose player-facing label denotes one canonical definition may
carry `ui.affordance_reference` on its `affordance_template`:

```toml
[[metadata_attachments]]
target_kind = "affordance_template"
target_ref = "dm/creation/class/barbarian/affordance"
namespace = "ui.affordance_reference"
payload_json = '{"definition_ref":"srd/class/barbarian"}'
bundle_id = "dm"
source = "manifest"
```

The reference is exact presentation data. Player surfaces may show its card
without matching prose, while the normal affordance gate and action dispatch
remain the only mechanical authority. Attach it only where one stable template
always denotes that definition; a reusable `Answer 1` template must not gain a
different reference for each live conversation.
Reusable menus instead carry parallel static `dispatch_option_refs` beside
their dispatch labels; Inscribe stores them as `option_definition_refs` in the
question trace. A missing reference means no description, never an eligibility
lookup.

## Authoring with `spellkave_set_metadata`

Use `spellkave_set_metadata` for normal metadata authoring. It is one
discriminated tool with the same flat `target`, `key`, and `value` vocabulary
for every operation: `target: "manifest"` replaces one named top-level
`[metadata]` key; `target: "namespace"` registers one namespace; and an object
target `{ "kind", "ref" }` sets one annotation. Root keys are replace-by-key
rather than a deep merge, so unrelated root metadata remains untouched. Root
values may use the scalar, array, and object forms admitted by shared metadata
validation; attachment payloads remain JSON objects. The tool does not reserve
a docs or UI payload shape.

Attachment identity is `(target_kind, target_ref, namespace, bundle_id)`, the
same identity used by live admission. Repeating that identity replaces its
payload and `source`; it does not append a second historical annotation. The
tool rejects an ambiguous pre-existing identity instead of choosing one. An
attachment may use a namespace from an owning dependency; do not try to
re-register that foreign namespace. A root metadata shape is authored into the
workspace manifest and validated before it is persisted; it does not by itself
add a new server-side storage or interpretation surface.

```json
// Root: replaces metadata.editor only, preserving other [metadata] keys.
{ "target": "manifest", "key": "editor", "value": { "summary": "Review names." } }

// Namespace: bundle defaults to the active authoring context when one is set.
// `audience` here is `mymod`'s own capability id (a dotted or slashed name it
// defines and grants) — see Audience below for the built-in relation words.
{ "bundle": "mymod", "target": "namespace", "key": "mymod.hints", "value": { "audience": "mymod.author_notes", "description": "Author-only guidance, gated behind the mymod.author_notes capability." } }

// Attachment: key is the namespace; source defaults to manifest.
{ "bundle": "mymod", "target": { "kind": "place_node", "ref": "mymod/shrine" }, "key": "mymod.hints", "value": { "text": "Mention the sigil." } }

// Batch: every update is validated together and persists only if all are clean.
{ "bundle": "mymod", "updates": [
  { "target": "manifest", "key": "editor", "value": { "reviewed": true } },
  { "target": "namespace", "key": "mymod.hints", "value": { "audience": "mymod.author_notes" } },
  { "target": { "kind": "place_node", "ref": "mymod/shrine" }, "key": "mymod.hints", "value": { "text": "Mention the sigil." } }
] }
```

An attachment can include `audience` (and optional `description`) to register a
previously absent namespace in the same call. Omit both when using an already
registered namespace; a matching `audience` only verifies that registration and
does not rewrite it. Change an owned registration deliberately with the
`target: "namespace"` form. `source` is optional and defaults to `manifest`.
Do not combine singleton `target`/`key`/`value` fields with `updates`, and do
not repeat a root key, namespace registration, or attachment identity inside a
batch. The generated tool reference carries the complete parameter schema.

## Audience

Every namespace registration names an audience (ADR-0130 D-3, 2026-09-12
revision), and the server enforces it: a row is delivered to a caller only
when the caller may see the row's target **and** the namespace audience
admits the caller (D-2). An audience never invents its own vocabulary — it is
one of the world's existing `VisibilityClass` tokens, the strict owner token
`owned`, or a capability id:

| Audience | Admits the caller when |
|---|---|
| `public`/`Public`, `local`/`Local` | always, subject to the caller being able to see the target |
| `hidden`/`Hidden`, `internal`/`Internal`, `discoverable`/`Discoverable` | resolved exactly like `visible_object_state`: the target is an `entity` whose body is in the caller's `visible_bodies` (see-as scope) and that class's `owner_delivery_admits` gate passes for the body. Metadata carries no per-row knowledge substrate (no "learned" state), so `Discoverable` admits a plain owner exactly when `Internal` would — only through a [DM elevation grant](dm-oversight.md) (`elevation_class = "internal"`), never on ordinary ownership or an unelevated party extent |
| `owned` | the target is an `entity` whose body the caller directly controls — the strict `owned_object_state` relation (steering the body), not merely seeing it |
| any other value | it names a `capability_definition`, and the caller holds a live grant of it that reaches the target (extent-bounded: a grant reaches the caller's own bodies, bodies and places inside its extent, and catalog/bundle targets unconditionally) |

A relation audience needs a body to resolve against. On `bundle`, catalog
(`entity_definition`, `item_definition`, `resource_definition`,
`affordance_template`, `capability_definition`), and place
(`place_graph`/`place_node`/`place_edge`) targets, only `public`/`local` and
capability audiences ever admit anyone — `hidden`, `internal`, `discoverable`,
and `owned` all fail closed there (`class_audience_admits`,
the world API).

A capability id is shaped like `frontier.apply_manifest` or `core/world_admin`
(it contains `/` or `.`, so it can never collide with a visibility-class token
or `owned` — offline validate enforces this shape as `MF-VAL-331`, live apply
additionally requires the capability to exist). There is no generic `author`
or `dm` word: a mod that wants an author- or DM-only namespace defines its own
capability and grants it with `[[actor_capabilities]]`, then names that
capability as the audience — no server change needed. `core`'s own
pre-ADR-0130 examples now read this way: author-only namespaces
(`provenance.source`, `editorial.note`, `art.image`) are gated behind
`frontier.apply_manifest` (whoever may change the world may read its author
notes), and the one DM-only namespace (`narration.read_aloud`) is gated behind
`internal` (reached only through a DM elevation grant, never by an ordinary
owner or an unelevated party extent).

An audience value the server does not recognize admits nobody (fail closed);
it is never a silent downgrade to `public`.

**Service-only capability audiences.** Tag the audience capability's
definition with `core.service_only_audience` when no person may read the
namespace, whatever body or grant that person comes to hold:

```toml
[[capability_definition_tag]]
bundle_id = "mymod"
capability_id = "mymod/read-npc-config"
tag = "core.service_only_audience"
source = "manifest"
```

The server then admits that capability as an audience only for a service
identity and for the publisher (holding `frontier.apply_manifest` is not
enough). An identity is a person when any of its
controlling `actor_identity` rows (every role except `co-pilot`) has Person
provenance: a runtime claim, an operator bind without `service`, a summon cast
by a person. The NPC compilers put this tag on every read capability of
private NPC configuration. A reader that must see such a namespace is bound as
a service (see [actor identity bindings](repairs/actor-identity-bindings.md));
a misspelt tag is an ordinary unknown tag and protects nothing. Proof: the
live test `k2_person_on_marked_body_reads_no_document`
(`packages/spellkave-test-lab/src/scene-live/private-read-guard.local-node.test.ts`).

## Delivery (`on_demand`)

`[[metadata_namespaces]]` also carries `on_demand: bool` (default `false`,
ADR-0130 D-4). Audience and delivery are separate axes: audience decides *who*
may ever read a namespace; `on_demand` decides *when* an admitted client
receives it. A non-`on_demand` namespace is live-session content, delivered to
every admitted, subscribed client as part of ordinary play (`<bundle>.art.image`,
`ui.affordance_group`, `ui.self_summary`). An `on_demand` namespace is
reference content — rules text, creation data, docs — delivered only to a
client that explicitly subscribes the reference view; a play session does not
pull it on connect. `audience` and `on_demand` are denormalized onto each
attachment row at write time (see Namespace Registry below for what that means
for a later re-registration).

`spellkave_set_metadata`'s ergonomic `target: "namespace"` value shape is
`{audience, description?, on_demand?}` — register an `on_demand` namespace
through the same call used for every other namespace registration, no
`spellkave_write_rows` escape hatch needed:

```json
{ "target": "namespace", "key": "mymod.rules_text",
  "value": { "audience": "public", "description": "Reference prose.", "on_demand": true } }
```

## Views

The server enforces D-2/D-3 through three views over the (now private)
`metadata_attachment` table; clients never read the raw table by name. The
two shared views admit the same rows for every caller
(`shared_public_admits`, the world API):

| View | Rows |
|---|---|
| `public_metadata_attachment` | audience `public` or `local`, not `on_demand`, target not a place |
| `public_reference_metadata` | audience `public` or `local`, `on_demand`, target not a place |
| `visible_metadata_attachment` | every other row the caller is admitted to (per-caller: visibility-class relations, the strict `owned` relation, or capability audiences, plus place targets), both delivery modes |

A normal play session subscribes `public_metadata_attachment` together with
`visible_metadata_attachment` — the live-session content path. Player clients
never receive `on_demand` rows, public or restricted, unless they explicitly
subscribe `public_reference_metadata` (reference/character-creation/authoring
tooling does this); a restricted `on_demand` row still requires the caller's
audience to admit it, same as any other restricted row.

## Namespace Registry

Namespaces are authored with `[[metadata_namespaces]]` rows before attachments
use them. The `core` fixture registers the base Spellkave catalog; a mod may
register its own namespace in its manifest or an included fragment:

```toml
[[metadata_namespaces]]
namespace = "mymod.hints"
audience = "mymod.author_notes"
bundle_id = "mymod"
description = "Author-only hints consumed by mymod tooling."
```

A namespace registration is not exclusive to one bundle: multiple bundles may
register the same namespace string as long as they agree on both `audience`
and `on_demand`; a later registration of the same namespace with a different
`audience` or `on_demand` is rejected at apply time, naming the mismatch
(`resolve_namespace_registration`, the world API;
#2119). Prefix your namespaces with your bundle id (`mymod.…`) unless you are
deliberately co-registering an existing shared namespace. Registrations are
cleared and re-applied with their owning bundle; attachments copy the
registration's `audience` and `on_demand` at insert time, and `just doctor`
(`metadata_namespace_registry_seeded`) flags an attachment whose copied
audience no longer matches the current registration.

Once registered by the bundle or a seeded dependency, attachments can target the
namespace:

```toml
[[metadata_attachments]]
target_kind = "place_node"
target_ref = "mymod/hidden_shrine"
namespace = "mymod.hints"
payload_json = '{"text":"Mention the cracked moon sigil only if inspected."}'
bundle_id = "mymod"
source = "manifest"
```

Payload keys are author-defined JSON object fields: the table below lists shared
conventions that tools may choose to understand, not a server-owned schema.

| Namespace | Audience | On-demand | Conventional payload keys |
|---|---|---|---|
| `provenance.source` | `frontier.apply_manifest` | no | `work`, `page`, `foundry_id`, `license` |
| `editorial.note` | `frontier.apply_manifest` | no | `text` |
| `observer.summary` | `hidden` | no | `text` |
| `art.prompt` | `public` | no | `prompt` |
| `art.image` | `frontier.apply_manifest` | no | `path`, `hash`, `license` |
| `srd.text` | `public` | yes | `text`, `source`, `license` |
| `narration.read_aloud` | `internal` | no | `text`, `trigger` |
| `driver.persona` | `owned` | no | `personality`, `goals`, `secrets`, `voice` |

For public subject images, the SDK recognizes a separate convention:
`<bundle_id>.art.image`, registered by that bundle with `public` audience.
It may attach to every admitted target kind that can carry a description
(`entity`, `entity_definition`, `item_definition`, `affordance_template`,
`place_graph`, `place_node`, `place_edge`, `resource_definition`, `capability_definition`) and projects
only `path`, `hash` (lowercase SHA-256), and `license`. The namespace prefix must
match the attachment's bundle. For example, `elven_mini.art.image` and
`orbital.art.image` share a payload convention without sharing ownership or
encoding a particular application's layout. SRD catalog entries attach the
same way: a spell, feat, or class sprite lands on that entry's
`entity_definition`; an offered-action sprite lands on its `affordance_template`; a named playing-the-game action (Attack, Dash, …) lands on its `capability_definition`.
The existing `frontier.apply_manifest`-gated `art.image` registration and
annotations remain unchanged. See ADR-0073 (2026-09-07 postscript) and the
executable
Elven Mini example
for asset validation, precedence, compatibility and consumer fallback rules.

For verbatim CC-BY SRD prose, register `srd.text` (`public` audience,
`on_demand`, owned by bundle `srd`) with conventional keys `text`, `source`,
and `license`. The server still requires only a JSON object; those keys are a
tooling convention, not a kernel schema.

Audience is enforced (ADR-0130, amending ADR-0073's G-1): `metadata_attachment`
is a private table, and a client reads rows only through the views in Views
above. A row still reaches every caller its audience admits — including a
player who controls the target (`owned`) or sees it (`hidden`/`internal`/
`discoverable`) — so authors still choose deliberately: a namespace with a
genuine secret needs a capability audience that actually excludes the party,
not a visibility-class relation or `owned`.

The server and authoring CLI validate that the namespace is registered and that
`payload_json` is a JSON object. They do not require the conventional keys
above, and they allow extra keys. If a payload shape must be enforced for
gameplay or perception correctness, it is no longer metadata; promote it to
typed world data.

## `dialogue.prompt` (closed-question presentation)

A public attachment on a `prompt_definition` can provide fixed presentation
as `{ "question": "...", "responses": { "action/id": "Label" } }`.
For an authored reusable menu, use `{ "presentation": "audience_trace" }`.
The latter tells clients to obtain the question and `options` from the exact
speech trace named by the occurrence's `audience_trace_id`. They must not
substitute a newer trace or fall back to static labels when that trace is
unavailable.
Missing or mismatched visible presentation uses neutral response numbers, never
raw action ids. The scripted ask-menu palette retains its question trace without
automatic expiry; each ask adds one retained trace, including after closure.

The marker and wording remain client presentation conventions. The server
opens and consumes the occurrence through typed definitions, response sets
and state gates; it does not inspect this metadata payload. An authored
ask-menu consequence inscribes `dispatch_text` and bounded `dispatch_options`
and opens its question state in one frame, so refusal leaves neither a new
question nor its open palette. The same write can carry the asker's opaque
`dispatch_context` as `context`; readers get it as `presentation.guide`
([guided dialogue](patterns/guided-dialogue.md)). See
[trace inscription](interaction-dsl-and-world-authoring.md#carrying-bounded-menu-labels-carry_dispatch_options)
and [dialog choice slots](patterns/dialog-choice-slots.md).

## `ui.affordance_input` (player input forms)

A public `ui.affordance_input` attachment on an `affordance_template`
declares the form a player fills before dispatching that template's action:
`{ "fields": [ { "name", "label", "control": "text"|"textarea"|"number",
"placeholder"?, "required"?, "min"?, "max"?, "max_length"?, "channel"? } ],
"submit_label"? }`. An explicit empty `fields` array means "a complete
invocation with no form". `channel` names the transport the world reads the
value from: `"utterance"` — the actor says it (`spellkave_communicate`
utterance, plain text for one field or a JSON object keyed by field name),
`"args_json"` — the structured argument blob. The PLAYER tools refuse
`args_json` values for an utterance-channel field before dispatch
(`utterance_required`), so a fresh player does not learn the transport from a
silently dropped value (sk-jay0.1.46). Reader:
`packages/spellkave-sdk/src/core/readers/affordance_input.ts`; the DM's
creation forms in `packages/spellkave-adventure-runtime/src/dm/creation/seed.ts`
are all utterance-carried.

## Examples

```toml
[[metadata_attachments]]
target_kind = "place_graph"
target_ref = "triboar_wooded_bend"
namespace = "provenance.source"
payload_json = '{"work":"Lost Mine of Phandelver","page":"Chapter 1: Goblin Ambush","license":"private-reconstruction"}'
bundle_id = "phandelver"
source = "manifest"
```

```toml
[[metadata_attachments]]
target_kind = "place_edge"
target_ref = "phandelver/edge/ambush-woodedbend"
namespace = "editorial.note"
payload_json = '{"text":"Reviewer note only; this does not affect traversal."}'
bundle_id = "phandelver"
source = "manifest"
```

```toml
[[metadata_attachments]]
target_kind = "place_graph"
target_ref = "triboar_wooded_bend"
namespace = "observer.summary"
payload_json = '{"text":"This bend is the first pivot from travel into danger."}'
bundle_id = "phandelver"
source = "manifest"
```

```toml
[[metadata_attachments]]
target_kind = "place_graph"
target_ref = "triboar_wooded_bend"
namespace = "art.prompt"
payload_json = '{"prompt":"Daylight fantasy trail bend with abandoned horses and scattered travel gear."}'
bundle_id = "phandelver"
source = "manifest"
```

```toml
[[metadata_attachments]]
target_kind = "place_graph"
target_ref = "cragmaw_castle"
namespace = "art.image"
payload_json = '{"path":"assets/cragmaw-castle.png","license":"private-reconstruction"}'
bundle_id = "phandelver"
source = "manifest"
```

```toml
[[metadata_attachments]]
target_kind = "place_node"
target_ref = "triboar_trail/ambush_site"
namespace = "narration.read_aloud"
payload_json = '{"text":"The trail bends between thick woods and opens onto the wreckage of a recent fight.","trigger":"first_entry"}'
bundle_id = "phandelver"
source = "manifest"
```

```toml
[[metadata_attachments]]
target_kind = "entity"
target_ref = "phandelver/klarg"
namespace = "driver.persona"
payload_json = '{"personality":"Boastful and cruel.","goals":["Keep control of the hideout"],"secrets":["Knows the map matters"],"voice":"loud and contemptuous"}'
bundle_id = "phandelver"
source = "manifest"
```

## Validation

Apply rejects unknown target kinds, unresolved target refs, unregistered
namespaces, malformed payload JSON, and payload JSON that does not decode to an
object. Offline validate also rejects unknown target kinds (`MF-VAL-330`) and
a namespace registration whose `audience` is neither a visibility-class
token, `owned`, nor capability-shaped (`MF-VAL-331`, ADR-0130 D-3); live
apply additionally requires that the named capability actually exists.
Payload keys are intentionally author-defined:

```bash
sk validate <your-bundle>/manifest.toml --bundle \
  --dep packages/spellkave-mechanics/fixtures/core/manifest.toml \
  --dep packages/spellkave-srd-cc/fixtures/manifest.toml
```

(`sk validate`, `packages/spellkave-cli/src/cli.ts`; exit 0 valid, 2 on a
fatal diagnostic. `just validate FILE` validates one file with the Rust
`spellkave` CLI, without the `--bundle`/`--dep` merge.)

After seeding, inspect rows through the observability surface:

```bash
spellkave metadata list --target-kind place_graph --namespace provenance.source
spellkave metadata namespaces
just doctor
```
