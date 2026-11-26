# Privileges: who may do and see what

Most of what an actor may do is decided by authored data: an affordance's
`gate_predicate` checks `actor.has_capability('core/walk')`, and a bundle can
mint a new capability without a server change. A **privilege** also requires an authority boundary. The server checks named
maintenance/read gates, the publisher identity, dynamic role-binding families,
and the reserved-prefix lane for authored acts. A manifest can define act
templates under an admitted reserved capability; it cannot bypass these checks.

This page lists every privilege the server compiles in, plus one read the
host decides and this module does not. The CI check
`the privilege-capability-ids skgate registry gate (bin/skgate run --gate privilege-capability-ids)`
keeps section 1 complete (see [Keeping this page complete](#keeping-this-page-complete)).
It does not see the host rule in section 2.

Related: [`dm-oversight.md`](./dm-oversight.md) explains elevation in depth.
ADR-0007 (DM role and trust elevation), ADR-0081 (epistemic visibility) and
ADR-0084 (per-grant elevation ceiling) record the in-module decisions.
ADR-0150 (Proposed, `specifications/adr/0150-publisher-reads-the-world-in-band.md`)
records the publisher read.

## The reserved prefix

The reserved prefix is `frontier.`. Gameplay condition grants and suppressions,
identity tags, equipped or carried items, and definition seeds cannot produce or
remove authority under this prefix. Configure authority through a
[`role_bindings`](./roles.md#bind-a-role-to-a-subject) row. Publisher/genesis
explicit `actor_capabilities` grants remain a migration lane until .67.
Blueprint cloning skips
reserved grants. Offline validation warns (`MF-VAL-375`) when templates,
action gates or compiled literal predicate checks name reserved capabilities.
Applying those rows requires each named capability, or `frontier.escalate`,
in a live Bundle extent covering the row's defining bundle (`MF-APPLY-039`).
The publisher and genesis bypass that row admission; adding a bare reserved
actor grant still follows the separate publisher/genesis-only lane. A manifest
actor grant with `source = "role_binding:..."` is always refused (`MF-VAL-380`);
only binding realisation may create that source.
Role bindings realise capabilities on a separate presence body. Configure
gameplay equipment with ordinary capabilities.

### Privileged frame landing

A privileged consequence needs a live role binding that covers the affected
places and entities. Transfers check both endpoints. Prepared-place seals
also apply. Revoking the binding prevents its pending work from landing.

A placeless role presence can act at a covered target when the action offers
privileged templates. A visible target can still fail admission.

## 1. Capabilities the server checks by name

The world resolves the caller through its bound actors and checks their current bodies,
including placeless role presence bodies. Character selection and authority
resolution are separate: a primary character does not hide another owned
presence body's grants.

Acting reducers ordinarily bind the authenticated sender to a directly
controlled current body. The reviewed Layer-2 verbs and current-actor
SessionMove/compound-intent entries also admit bounded `frontier.impersonate`
steering, with exact-login consent for Person bindings. Read extent grants
alone supply no acting authority. Publisher setup/ruling arms remain explicit;
other direct-control paths keep their direct ownership checks. Service-client
mutations and NPC steering require the original observation's world/generation;
a hold never transfers the Service edge or silently refreshes stale work.

| Capability id | Unlocks | Special rule |
|---|---|---|
| `frontier.apply_manifest` | **Write:** apply a manifest or delta. **Read:** the "operator" bit of the spatial views, so the full place catalog without fog of war. | Genesis bootstrap; otherwise a live authored apply grant is required (`MF-APPLY-015`). Presence-held and explicit scoped requests additionally check each row and root against live extents; see codes below. The live apply-holder catalog-read arm remains through .82. |
| `frontier.prune` | **Write:** ordinary scoped manifest tombstones, including their ownership and target cascade. | A live covering grant is required (`MF-APPLY-046`). Force does not bypass admission. Binding retractions use D6 instead; legacy ordinary-body holders retain the transitional adapter until .84. |
| `frontier.escalate` | **Write:** maintain role rows and live reserved definitions over the defining bundle. | Alternative to holding all required ids (`MF-APPLY-045`). It does not waive affected-binding D6, clock introduction or reserved-definition introduction. |
| `frontier.read_hidden` | **Read:** the existing Hidden see-as floor of a live extent grant. | No act authority. |
| `frontier.read_internal` | **Read:** Internal depth inside a live extent. | Capability-derived depth works alongside the legacy scalar until hosted migration/cutover (.67/.82). |
| `frontier.pace_time` | **Write:** manual tick(s), pause, resume, start tick loop and bounded cadence; additive `pace_time` tool RPC. | Publisher or a live authored grant on the sender's current body. World-wide regardless of extent; presence attribution precedes a character; no genesis exemption. The tool uses the caller identity and refuses publisher ports. |
| `frontier.spawn_entity_definition` | **Write:** spawn a new instance of an `entity_definition` at runtime. | Publisher maintenance, or a live realised binding grant covering the actual landing and seal; bare grants land nowhere. No genesis exemption. |
| `frontier.impersonate` | **Act:** steer an ordinary Actor body's reviewed Layer-2 verbs and current session entries. | Owned non-steerable presence; complete place/body extent, seals, Person consent and original generation. It grants no direct control or character selection. |
| `frontier.drive` | **Identity:** assign/release durable Service drivers for eligible NPCs. | Owned presence; complete body extent; no playable or binding-subject target, authored binding takeover or already-bound identity. Release follows assigning presence without an extent check and refuses while held. |
| `frontier.open_session` | **Write:** open an authored session for a bounded vector of existing actor bodies. | Caller-owned role presence; every participant, source and generated destination uses the same live extent and inherited seals. Raw third-party session setup remains publisher-only. |
| `core/raw_trace_inscription` | **Write:** inscribe a raw `trace` row directly (`r_inscribe_trace`), outside the consequence path. | The body needs admitted direct control or bounded steering and this gameplay capability. A steered raw trace must name a covered place-node landing. |

Where they are defined and granted:

- `frontier.apply_manifest`, `frontier.pace_time` and `frontier.spawn_entity_definition` are part of
  the world’s standard vocabulary,
  so every node has their definitions from first boot. The same rows exist in
  `packages/spellkave-mechanics/fixtures/core/base/affordances.toml`; the test
  `genesis_capability_rows_match_the_core_fixture_copies` keeps both copies
  identical.
- `core/raw_trace_inscription` is defined only in
  `packages/spellkave-mechanics/fixtures/core/base/affordances.toml`. A node
  seeded without that fixture has no definition, so nobody can hold it.
- Binding example: the Elven Mini DM NPC Aldwin receives `frontier.apply_manifest` and `frontier.pace_time`
  through an authored role binding
  (`packages/spellkave-adventure-elven-mini/fixtures/adventure/cast/npcs/aldwin.toml`).

A role binding's D6 gate checks the dynamic id `frontier.bind.<role_id>` or
covering live grants of every merged capability; publisher/genesis also admits
it. This dynamic family is checked in
the world API, separately from the named
constant inventory above. Roles containing `frontier.apply_manifest` cannot use the holder paths until
.82. `frontier.spawn_entity_definition` now uses the shared binding landing
check and may participate in covered holder admission. The reference cases in
`authority/verdict.rs` prove this distinction.

### Manifest write refusals

Presence-held and explicit scoped applies check ownership, both placement images
and mutation targets at enqueue and before each drain segment. Codes identify
`041` (outside every extent), `042` (foreign ownership or root claim), `043`
(unlisted authored row) and `044` (non-publisher whole-world replacement), all
in the `MF-APPLY` domain. Entry bundle mismatch is `MF-APPLY-037`.
Role and aggregation maintenance also checks every affected realised binding against its old and final merged capabilities (`MF-APPLY-036`, `realised_binding_impact`). Scoped role writers need the final ids or `frontier.escalate` over the row bundle (`045`); introducing an unknown reserved definition or adding `frontier.pace_time` to a merged role remains publisher/genesis-only (`035`). Static `MF-VAL-379` is a warning, not admission. Authored gates on reserved
ids use the same bundle-scoped role-write verdict at enqueue and every drain
recheck (`MF-APPLY-039`); their offline warning (`MF-VAL-375`) does not admit a
write. Spawn parameters choose either a fixed `blueprint_id`, or
`definition_from_args = true` with a non-empty `allowlist_tag`. Invalid mixed
modes or missing spatial fields are fatal `MF-VAL-381`. In args mode,
`definition_ref` must resolve at execution to an entity definition carrying
the tag; it cannot select a place-graph blueprint.

The legacy ordinary-body delta/bundle adapter remains until `.67`/`.84`;
whole-world replacement already requires the publisher.

An unlisted `object_state` row is a satellite of its entity. An owner-preserving
raw overwrite keeps its existing stamp and checks placement plus target reach.
Claiming it in applyset memory, changing its stamp or retracting it requires a
nonempty target-owner set wholly inside the writer's Bundle extents. A listed
state row retains its ordinary takeover check. Policy tests live in
the world API; the live producer/observer proof
is `packages/spellkave-cli/src/__tests__/extent-scoped-apply.live.test.ts`.

## Privileged runtime acts

An affordance whose `capability_id` starts with `frontier.` selects a privileged
frame. Its authority is the selected body, capability and binding, preserved
through reactions and scheduled work. Every placed mutation checks the live
realised binding's current extent. Normal landings check their seals; the bounded
`BreakPlaceSeal` operation alone selects and breaks a covered closed seal. Other
writes recheck their own landing, including any remaining ancestor seal. A stale grant
copy cannot widen a changed binding. Bare explicit grants select no binding and
land nowhere. Ordinary frames retain ordinary reach; an action with both ordinary
and privileged candidate templates requires the ordinary actor location before
selection. These rules are pinned by `authority/landing.rs`, the enum landing
inventory, and the live privileged-act journey.

The demo `core` bundle supplies these authored compositions. Adventures can
compose existing primitives with their own content. The `afflict` family covers
conditions and identity tags; `set_state` covers state, name and text. These compositions
use ordinary mutation leaves and the bounded seal transition; `.92` owns the broader parameterized
dispatch menus for those same families.

| Action | Capability suffix | Target and argument |
|---|---|---|
| `core/act/spawn` | `spawn_entity_definition` | Place with the `core/mark_surface` niche; `args_json` carries `definition_ref`, an entity definition tagged `core/spawnable` |
| `core/act/despawn` | `despawn` | Creature; refuses identity-bound and playable-seat bodies |
| `core/act/lock`, `core/act/unlock` | `set_state` | Object tagged `core/lockable`; writes Boolean `core/locked` |
| `core/act/give`, `core/act/take-back` | `transfer` | Creature; inserts/removes the authored `core/item/loot_dagger` choice |
| `core/act/afflict`, `core/act/remove-condition` | `afflict` | Creature; applies/removes the authored `core/condition/prone` choice |
| `core/act/plant` | `inscribe` | Place with the `core/mark_surface` niche; optional `dispatch_text` becomes clue text |
| `core/act/break-seal` | `break_seal` | Place with the same niche; required nonblank `dispatch_text` of at most 1024 UTF-8 bytes; a covering PlaceGraph binding is required |

The core wolf is a neutral stat-free example tagged `core/spawnable`. An args-bound
Spawn accepts entity definitions only, refuses a graph blueprint or non-allowlisted
choice, and gives the spawned body no summoner identity. A fixed graph Spawn must
have a landing graph and becomes its child. Each core act leaves a trace naming the presence. The ordinary act markers use
`core/observed_change` at their landing. The seal transition creates exactly one
Public `seal_break` trace at the selected sealing graph's anchor, associated with
the same existing ApplyConsequence event as its durable break row.
The shared creature and lockable-object niches represent physical target facts;
remove-condition additionally requires prone. Unplant is transitional under `sk-jay0.3.24.131`;
private hints are transitional under `sk-jay0.3.24.132`.

Writing a privileged template requires holder-or-escalate authority over its
bundle at both enqueue and cursor recheck (`MF-APPLY-039`). Offline `MF-VAL-375`
is advisory; `MF-VAL-380` fatally rejects a forged `role_binding:` grant source,
even for the publisher. `sk explain capability <id> --target live` marks its
templates with `privileged`. Doctor's `privileged_template_unheld` audit reads
private applyset provenance and reports lost applier authority without retracting
anything. Missing ownership/provenance evidence is reported as unknown; run as
publisher for a whole-world audit.

Versioned local examples and refusal receipts (internal record, not in this repository)
include the installed CLI outside the checkout, caller-owned presence selection,
independent mutation assertions and whole-journey cost. The captured Plant argv
uses `intent manipulate`, its selected presence and `args_json.dispatch_text`;
use targets disclosed in your own manipulation context instead of fixture IDs.
These packaged guides supply `.56`'s portable publication source; the evidence
covers local behavior and leaves unaided discovery unverified.

Local shared tools and the NPC presence seam are supported. Hosted MCP actor
selection belongs to `.45`; this section does not imply a hosted invocation.

## Defined, not yet checked

The bootstrap also defines the following authority vocabulary. Definitions and
role composition grant nothing by themselves. The corresponding implementation
slice must supply the gate and binding semantics before these IDs authorize an
operation; see [roles](./roles.md).

| Capability id | Owning planned slice |
|---|---|
| `frontier.impersonate` | `act-as-and-consent` (.41) |
| `frontier.deliver_private_hint` | principal-pinned private delivery (`sk-jay0.3.24.132`) |
| `frontier.open_session` | publisher maintenance integration (.49) |

The read IDs already derive the elevation class of realised presence grants
(.34): Internal for `frontier.read_internal`, otherwise Hidden, including
roles without read capabilities. The read-depth compatibility stage also reads `frontier.read_internal` directly;
legacy scalar depth stays active until hosted migration (.67) and cutover (.82). Every extent-bearing grant retains the existing Hidden floor.

## 2. Privileges bound to an identity, not a capability

These maintenance gates compare `ctx.sender()` with an identity. The publisher
arm of `require_world_authority` admits vocabulary, runtime maintenance and
module configuration without a body. Neither an apply capability nor genesis
admits a non-publisher to raw maintenance; scoped authors use manifest apply.

| Privilege | Gates |
|---|---|
| Operator: `config.operator_identity`, set to the publishing identity when the world is published; defaults to `Identity::ZERO`, which grants nothing | `r_bind_actor_identity` (ordinary actor bindings; optional provenance defaults to Person, and a Person identity reads no [service-only audience](metadata-attachments.md#audience), so bind an NPC seat with `service`; presence bodies and the reserved `presence` label are refused) |
| Operator | direct vocabulary and runtime maintenance, authoring validation probes, retention/decay setters, `set_tick_interval_bounds` |
| Operator | `r_revoke_seat`, `r_reassign_seat` |
| Operator | `r_trust_identity_issuer`, `r_untrust_identity_issuer`, `r_trust_identity_audience`, `r_untrust_identity_audience` |
| Operator | the same full-catalog read bit as `frontier.apply_manifest`; either the publisher or a live apply row is enough during compatibility |
| Player seat claim: first come on an offered playable body, only for `role = "primary"` | `r_claim_actor` (presence bodies and role-binding subjects are excluded) |
| `$sender` self-bind: an `actor_identities.identity` of `"$sender"` resolves to the applying connection | lets an admitted author write its ordinary seat binding; a role-bound NPC requires covering D6 bind authority and publisher-mediated durable host bootstrap |

The publisher's read of private world-state tables is not an authored
capability and not a reducer gate in `server/`. The host admits the database
owner — the identity that published the module — to those tables, read-only,
for SQL and for a subscription. ADR-0150 is the opt-in on `connect()` (default off). `sk` sets that
publisher option. The hosted gateway does not. A
holder of `frontier.apply_manifest` who is not that identity is not admitted
to the raw tables. The measured proof is the `owner-private-subscribe` evidence report (internal record, not in this repository).
The greps at the bottom of this page do not see the rule, because it is not
a string in the world implementation. `sk get` and `sk describe` use that cache after the publisher subscription applies
(`reads_as_publisher`). Non-publishers use separate indexed authoring views with
binding-held Hidden/Internal read authority and per-kind coverage; an apply grant
alone does not admit them to raw tables. See [reading a world](reading-a-world.md).
Neither reader calls the manifest export.

## 3. Elevation: capability grants that widen what you see

Elevation is data. Any capability grant with a non-empty `extent_ref` widens
the holder's view to the bodies in that extent (ADR-0007 D-4). A live `frontier.read_internal` row raises the reached bodies to Internal
independently of its scalar class. During compatibility, a legacy Internal
`elevation_class` still raises depth too (ADR-0084). Extent and exclusive
expiry bound both paths; other grants retain the Hidden floor. The final
scalar retirement is blocked on hosted backfill (.67) and owned by .82.

| `elevation_class` | Reaches, through `owner_delivery_admits` |
|---|---|
| `""` or `hidden` (default) | Hidden floor; a `frontier.read_internal` row also reaches Internal |
| `internal` or `full` (synonyms, parsed by `elevation_ceiling` in the world API) | also `Internal` rows, and `Discoverable` rows without a knowledge row |

Any other value is an authoring error at apply time. For role bindings authors
choose the role, not `elevation_class`: the reconciler derives that class from
the merged capabilities and writes grants to the separate presence body.

Shipped grants:

| Capability id | `elevation_class` | Extent | Holder | Fixture |
|---|---|---|---|---|
| `dm_oversight/oversee` | `internal` | `place_graph` `dm_oversight/region` | `dm_oversight/dm` | [`examples/dm-oversight.toml`](./examples/dm-oversight.toml) |
| `elven_mini/dm/watch` | `full` | `place_graph` `elven_mini/region` | Aldwin | `packages/spellkave-adventure-elven-mini/fixtures/adventure/cast/npcs/aldwin.toml` |
| `elven_mini/dm/seat` | `full` | none | Aldwin | same file; an empty `extent_ref` widens nothing, so this grant is a marker checked by an affordance's `gate_predicate` |

`core/world_admin` and
`elven_mini/dm/seat` sound like privileges, but the server never checks them
by name. Bundles use them in DSL predicates, like any ordinary capability.

## Authored session setup

Define an action, affordance, outcome and consequence using the existing place
niche. Its fixed frame write is `OpenSession { session_def_id = "bundle/session" }`;
the definition must resolve inside the template's dependency closure. Grant
`frontier.open_session` through a role binding on the caller's own presence.
The standard `dm` role includes it; granting a role remains an authoring operation.

The manipulate argument `participant_entity_ids` enrolls 1–64 distinct runtime
actor-body ids. The SDK accepts safe integers or decimal strings; Rust CLI JSON
accepts numeric u64 values or nonzero decimal strings. It is separate from `expected_participants`, which checks
disclosed role bindings. The definition and default grid are authored; invocation
cannot inject `definition_ref`, `destination` or `build_target`. All participants
must be current actor bodies co-located at the target node. Presences, missing
actors and already-running members refuse. Every subject/source/anchor/planned
cell must pass the same live grant and inherited seals; a Bundle grant over the
graph alone cannot enroll a player the bundle does not own.

An authored opener can enroll eligible actors at the target node. A failed
setup rolls back the new session. Existing expiry records associated with
other owners survive the attempt. Enrollment grants no participant control
or impersonation.

Clients discover the `manipulation_contract` enrollment marker before dispatch;
an older module refuses locally, while omission keeps existing verbs compatible.
