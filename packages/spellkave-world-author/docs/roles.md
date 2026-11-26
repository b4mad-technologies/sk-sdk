# Roles as authored content

A role names capability definitions. A `role_definitions` row owns its
`role_id`; another bundle contributes through `role_aggregations`, keyed by
`role_id` and `bundle_id`. Both require an authored `description` and
`capability_ids`. Definitions may be empty; aggregations must contribute at
least one resolving capability. The merged set is the sorted, deduplicated
union of the definition and every aggregation.

```toml
[[role_definitions]]
role_id = "house/gm"
bundle_id = "house"
display_name = "House GM"
description = "Our campaign's authored role."
capability_ids = []

[[role_aggregations]]
role_id = "house/gm"
bundle_id = "weather"
description = "Adds our weather vocabulary."
capability_ids = ["weather/set_weather"]
```

The referenced bundles and capability definitions must exist in the manifest
closure or live world. Offline validation also sees the kernel bootstrap.
An aggregation may refer to a live role without repeating a file dependency.
An attempted foreign role redeclaration is fatal (`MF-VAL-367`) before upsert;
unresolved capabilities use `MF-VAL-366`, and an unknown role or empty
aggregation uses `MF-VAL-368`. Role rows do not participate in `MF-VAL-364`.

The kernel bootstrap defines these standard roles. Each listed capability has
the `frontier.` prefix:

| Role | Capability suffixes |
|---|---|
| `viewer` | `read_hidden` |
| `timekeeper` | `pace_time` |
| `npc-host` | `drive` |
| `dm` | `read_hidden`, `read_internal`, `spawn_entity_definition`, `despawn`, `set_state`, `transfer`, `afflict`, `inscribe`, `open_session`, `impersonate` |
| `adventure-author` | `read_hidden`, `read_internal`, `apply_manifest`, `prune`, `bind.dm` |
| `system-author` | `read_hidden`, `read_internal`, `apply_manifest`, `prune` |

A definition grants no authority to a caller. A `role_bindings` row names
who receives the merged capabilities, for which extent, and until which tick.
The DM role contains read authority, the six scoped mutation capabilities,
scoped session setup and bounded steering. `npc-host` grants `frontier.drive`
without impersonation. No standard role grants `frontier.bind.npc-host`; the
publisher or a holder covering every role capability binds the host.
Pacing and manifest apply remain separate capabilities. See
[privileged runtime acts](./privileges.md#privileged-runtime-acts).

`timekeeper` controls the shared world clock in every extent. A regional
grant still pauses every table in that world. Ordinary `dm` does not pace
time. Elven Mini's publisher-applied `elven_mini/scripted-dm` definition
adds `frontier.pace_time` for Aldwin. The local tool factory offers
`spellkave_pace_time` only on a caller-owned connection with a current
pacing presence; it refuses a publisher connection. Hosted roster and
routing are transitional until `authority-tools-over-mcp` (.45).
See [clock controls](./dm-oversight.md#controlling-the-shared-clock).

## Bind a role to a subject

```toml
[[role_bindings]]
binding_id = "house/alice-dm"
bundle_id = "house"
subject = "$sender"
role_id = "dm"
extent_kind_ref = "place_graph"
extent_ref = "house/region"
description = "The applying DM oversees our region."
# expires_at_tick = 500  # omitted or 0 means permanent
```

`subject` accepts an identity hex, `$sender` (the original applying identity),
or an unambiguous authored entity key belonging to a **non-playable NPC**.
An identity subject needs no character seat. An NPC subject resolves to its
stable actor principal: the runtime-only `subject_actor_id` keeps that link
when the NPC changes bodies. It is not an authoring field or an exported hint.

A legacy ordinary-body apply holder can store a binding without possessing authority to realise
it until .84 removes that adapter. Scoped writers need D6 even to store an inert record. Such a row is **inert**: `presence_entity_id = 0`, no grants or identity
mirrors. A realised binding creates a separate placeless entity and actor,
with its role capabilities on that presence body and durable `role = "presence"`
identity mirrors. It does not put authority on the subject's character body.
Only the NPC's durable primary identity bindings are mirrored; a transient
player claim does not inherit the NPC's authority. The publisher/operator
installs the host's durable primary binding before NPC startup. For an ordinary
non-playable, non-binding-subject NPC, a host presence covering the body with
`frontier.drive` may instead assign a previously unbound, distinct login through
`r_assign_driver`. The assignment is durable `Service`, with `assigned_by` naming
that presence; disconnect or unmount does not release it. Replacement while a
DM hold stands refuses with `driver_assign_while_held`, preserving the holder's
pin and every assignment/control field. An exact same-presence, same-identity
repeat is non-mutating and succeeds under a hold. A client-side hold check
can avoid work but cannot replace this atomic refusal. Keep the retained
credential for a suspended seat and retry after explicit return/recovery.
Assigned driver identities also control their durable Service summons. A
replacement transfers those grants, including nested summons, in the same
transaction; stale retired wake, act and deferred work are refused. Exact
repeat assignment tolerates this summon set. Any held summon blocks the whole
handover or ordinary release with driver_summon_while_held; its authority pin
is preserved. A driver identity refuses new actor or presence edges
(assigned_identity_requires_isolation), except durable unassigned Service
`summoner` rows. This shape exception also applies to operator, manifest and clone
writers, including runtime place-graph Spawn cloning a live summon. The rows
alone do not prove that Spawn created them. Existing-pair
updates retain their lifecycle semantics. Graph cloning that would copy its
assignment refuses the operation. Root release revokes the derived grants
permanently: later root assignment does not resume them. A separately eligible,
unbound summon may be assigned independently. Player summons still survive
disconnect. Manifest reapply/retraction that removes an assigned root instead
wins over descendant holds, revokes both driver and hold, and leaves the live
summon unbound; the DM observes held=false through the scoped control view.
In-play Despawn of an assigned root body or retraction of its assigning
presence also clears the assignment, derived grants and holds immediately; live
summon bodies remain. Presence retraction preserves the root body too, and a
new covering presence can assign the same identity without resuming old summons.
DeleteEntity and full RemoveItem consumption share the physical-body cleanup;
PossessBody to zero also revokes an assigned root's derived authority. Removing
a presence body retracts its role binding before losing the actor/body link.
A nonzero body swap keeps its existing assignment semantics. Unrelated
authored/operator/Player bindings retain their existing Despawn lifetime.
PossessBody to zero releases durable Service summoner grants, preserves Player
summoner and unassigned primary bindings, and evicts the former body's context.
Nonzero body swaps retain assignments and summons. Physical Despawn, DeleteEntity
and full RemoveItem consumption end Player summon grants; live Player summons
continue surviving disconnect. Presence revocation resolves current embodiment
only; no retained-control fallback or legacy backfill is provided.

Proximity-host integration is tracked by `sk-jay0.3.24.144`. An idempotent re-claim keeps
that existing binding and its provenance; a redundant self-bind is a no-op, not an authority
bootstrap. Changing a role-bound NPC's durable primary membership requires D6
bind rights; an existing connection-scoped claim does not waive them.

Realisation requires publisher/genesis authority, or a covering
`frontier.bind.<role_id>` grant, or covering grants of every capability in the
non-empty merged role. The holder paths refuse roles containing capabilities
in the remaining extent-blind list: `frontier.apply_manifest` (until .82). Each grant must
be live and cover the requested extent; authority may be held across multiple
bodies owned by the caller. Editing a realised binding also needs coverage of
its existing extent. See the world API for
the shared D6 decision and reference cases. Bundle grants cover the same bundle and graphs whose root it owns; Bundle grants cover a Party extent when its tag definition is owned by that bundle. Unknown kinds or missing ownership fail closed. Reducer admission and the filtered grant inventory share the registered extent-resolution adapter (`authority::verdict::covers_shapes`); pure tests and `grant-verb.live.test.ts` cover that parity.

A realised subject change uses the [guarded handover](./grants.md#hand-over-one-binding)
preview and a single subject-only delta with typed `binding_preconditions`.
Raw unguarded subject edits refuse with `MF-APPLY-047`. Edit or retract a row
separately to change its scope or revoke it. A positive expiry is exclusive: the binding
ceases to grant authority at that tick; omitted or zero means permanent. Presence bodies cannot be player-claimed,
released as character seats, possessed, or directly rebound by forging the
reserved `presence` identity label. The table predicate, rather than a label,
identifies them (the world API).

A scoped writer changing a role definition or aggregation needs live covering grants of every required id, or `frontier.escalate`, over that row's bundle (`MF-APPLY-045`). This applies to ordinary ids too. Upserts check the final merged union and any removed pre-image ids; removals check the old row's own ids. An empty replacement proves no authority by itself. The check reads grants held before mutation, so adding an id to one's own role cannot authorize another write in that request.

Every changed merged role also checks its affected realised bindings, using the role index. The writer must be able to bind both the old and final sets at every retained binding extent (`MF-APPLY-036`, `realised_binding_impact`). Retracted bindings are checked as removals; an explicit rebind checks both sides. Inert bindings stay inert during role edits. Explicit resubmission of an inert binding can realise it when the sender passes D6; the existing duplicate-digest exception preserves that realization path. Unchanged role vocabulary does not trigger a new row authority decision. Escalate admits a row but does not waive these binding checks.

Two root operations still need publisher/genesis admission (`MF-APPLY-035`): introducing an unknown `frontier.*` capability definition (`reserved_definition_root`) and introducing `frontier.pace_time` into a merged role (`clock_root`), through definition, aggregation or replacement. Maintaining an existing reserved definition uses the ordinary scoped holder-or-escalate rule. A legacy ordinary-body apply holder retains main's ordinary-role rule until .84; reserved upsert ids still require the publisher. `MF-VAL-379` warns that these rows need live admission.

Scoped ordinary tombstones additionally need covering `frontier.prune` (`MF-APPLY-046`), including every remembered cascade target. `--force` only overrides applyset memory checks. Binding retractions use D6 without a prune prerequisite. Legacy ordinary-body pruning remains transitional until .84. The publisher/genesis bare `actor_capabilities` lane retains `MF-APPLY-033` until release follow-up .67; gameplay equipment, conditions, tags and blueprint cloning cannot produce reserved authority.

Presence elevation is derived from the merged role: `frontier.read_internal`
produces Internal reach; otherwise the derived class is Hidden, including
roles with no read capability. The read-depth compatibility bridge (.35)
also accepts capability-ID depth while retaining the legacy scalar until
hosted migration (.67) and final cutover (.82).

### Choose sight and write scope

`place_graph` reaches a graph and its descendants, including a child combat
grid. `party` reaches the named party and its current encounter. `bundle`
uses authored entity provenance for sight: it reaches the entities that bundle
placed, wherever they stand, without reaching an unrelated player merely
standing in its graph (the world API).

For manifest writes, Bundle coverage uses applyset ownership memory. It can
cover placeless definitions and graphs whose root that bundle owns. A state
write also checks its target entity independently; root-graph ownership does
not confer ownership of every body inside it. PlaceGraph and Party grants
admit placed edits but cannot claim a placeless definition or an applyset root.
See [extent-scoped apply](./getting-started-with-verbs.md#extent-scoped-apply)
for the row rules and compatibility boundary. Captured local author examples (internal record, not in this repository)
record an admitted `sk apply -k` edit, a refused `sk diff -k` takeover and
independent live postconditions for AUTH-36-01/02. The captures identify the
proved revision and publisher bootstrap; hosted MCP delivery and packaged
persona guidance remain with `.45` and `.56`.

Aldwin's publisher-authored `elven_mini/aldwin-author-bundle` binding grants
`elven_mini/scripted-dm` over Bundle `elven_mini`, alongside the existing
regional and party bindings. Its definition authoring stays inside that
adventure; shared `dm` and `srd` vocabulary remain publisher-authored.
The generated fixture and `tests/offline/role-bindings.test.ts` in
`packages/spellkave-adventure-elven-mini` prove the binding excludes those
foreign bundles. Publisher listing precedes the seat claim. This content
authority is separate from the scripted runtime: Aldwin opens shared authored
menus through its admitted DM presence, and the occurrence retains the
directed trace that supplies its question and labels. Runtime creation and
advancement perform finite acts; the interim prompt applyset route is retired.
`.91` supplies runtime condition/actor ownership, and world-owned vessels
retain that state when their adventure bundle is reapplied.

## Explain the authored vocabulary

```sh
sk explain role dm
sk explain binding house/alice-dm --target live
sk explain capability frontier.pace_time --target live
sk explain extent-kind place_graph --target files
sk explain role dm --human
```

Files are the default: the configured local folder and scratch workspace are
combined with the shared kernel bootstrap and core extent kinds. Live requests
read actual public vocabulary rows using the selected caller's credentials.
They add no read authority and do not invent missing bootstrap rows. The
AUTHOR tool `spellkave_explain` returns the same structured answer with
`{ "kind": "role", "id": "dm" }`.

Role answers retain each bundle's contribution and capability descriptions,
and `bound_to` lists their authored bindings. Binding answers select the exact
`binding_id`, report planned (files), inert or realised (live) state, extent,
merged capabilities, expiry and derived read class. A connected ordinary caller
sees its own identity mirrors. The server stores `role_binding` privately and
serves admitted rows through `visible_role_binding`: subject-owned bindings,
durable primary NPC membership, D-6-manageable bindings and publisher inventory.
Inaccessible rows are absent, including their ids and counts; subject-only
descriptions are omitted. Empty subjects fail `MF-VAL-370` and the commit path
independently forbids empty stored subjects (the world API).
Read elevation and transient NPC claims alone disclose no binding row
(live regression: `role-bindings-and-presence.live.test.ts`). Explicit binding
inspection is the AUTH-34-01 transition; owned-actor selection is still .45.
Capability answers list the roles containing it and the authored templates
and actions requiring it. Extent-kind answers retain the authored resolution
shape. Unknown ids exit `2` and offer the nearest authored IDs by prefix.

Both role tables are public vocabulary with manifest-only writes. The Rust
JSONL CLI reads them through `role-definition list|inspect` and
`role-aggregation list`; doctor checks their capability and role references.
Bundle export reconstructs authored role and binding rows, excluding presence IDs,
realisation ticks and stable-principal runtime hints. Applyset prune withdraws that
bundle's contributions while retaining other bundles' definitions.

For a persistent world, apply the generated core vocabulary delta before
loading adventures. Publishing a module alone does not backfill roles in an
existing database. Preserve the role tables on rollback: an older module
without those tables needs an explicit state-preserving migration, and the
combined privileged-namespace security floor must remain in force.

## Verified local examples

On an admitted local world, an ordinary caller can use
`sk --format jsonl explain role dm --target live` to inspect the public role
vocabulary. The same installed CLI can explain a custom role and list the
bundles contributing capabilities to it. A role definition alone grants no
authority: an unbound caller's valid `sk apply -k <manifest>` attempt is refused
with `MF-APPLY-015` and exit `2`.

The versioned local acceptance record
and captured installed CLI journey
record the ordinary credential boundary, actual bundle contributions,
files/live agreement and independent unchanged-catalog assertions after refusal.
The installed artifact ran outside checkout with its declared peer explicitly
supplied and its dependency links contained inside the artifact; distribution
portability follow-up `sk-jay0.3.24.62` owns those installation prerequisites.

These historical examples verify local explanation and refusal before bindings
landed. The binding contract above is implemented by .34; the dedicated
grant/revoke journey remains .43 (AJ-02). This record establishes neither the
new binding admissions nor hosted MCP delivery. The complete text accounting
and failed exploratory attempts are linked from the acceptance directory; a
scripted pass does not establish unaided discovery or an efficiency threshold.

## Proven binding journeys

The local binding evidence (internal record, not in this repository) records
AUTH-34-01 targeted inspection of two distinct bindings and AUTH-34-02 revocation
while retaining the independent character claim. Each versioned trace records
real admission, refusals and independent state checks. The examples above are
supported locally; hosted MCP delivery and final owned-presence selection remain
separate acceptance work. Scripted trace cost does not establish an efficiency
threshold or unaided discovery.

## Persistent rollout

Rollout uses two publishes: first publish this schema-compatible module with
the binding table and defaulted runtime hints while the publisher/genesis grant
lane remains open. Apply core roles and migrated binding bundles as publisher
on every catalog world. Follow-up .67 supplies the second publish, which closes
the bare-grant lane after that migration. Publishing alone does not backfill
bindings. Preserve authored configuration and realised authority on rollback;
an older module needs an explicit compatible migration. Legacy queued applies
without a recorded sender/verdict fail closed and need resubmission; authors
must not supply server admission hints. See the [live apply contract](./getting-started-with-verbs.md#authority-reconciliation-during-live-apply).

The privacy fix in `sk-jay0.3.24.89` changes shipped live readers: subscribe to
`visible_role_binding`, including AUTHOR explain/MCP, live AuthorTarget and the
Rust role-binding list/inspect and doctor surfaces. Authored manifest rows and
publisher bundle export keep their original subject values. Grant-verb narrows
the projection further: inaccessible bindings are omitted rather than returning
redacted metadata. A filtered role-edit preview defers private binding impact
to the server; live D-6 still refuses unauthorized affected bindings without
changing role authority (`role-escalation-at-apply.live.test.ts`).

For a hosted world, the operator first verifies a backup and deploys the matching
module and generated client bindings as one compatibility floor. Incrementally
publish the module without delete-data or automatic reset, then verify binding,
presence, seat and grant counts and subject/publisher and foreign-view controls.
A publish refusal stops rollout with existing state retained; it does not
permit resetting the persistent world. Rollback must preserve private storage
and the view contract: use a compatible privacy-safe module or a forward fix.
Do not republish the predecessor that exposed principal metadata. This fix's
local proof does not authorize a hosted activation.

## Role edit recovery and security floor

Admission and drain-time rechecks use the original submitting identity and live authority. The role definitions, aggregations, presence grants and bindings form the bounded atomic authority unit at cursor 1. A refusal before cursor 0 starts writes leaves the world unchanged. A refusal at cursor 1 can retain ordinary cursor-0 writes; it leaves the authority unit unchanged and follows the existing quarantine/unknown-applyset-base recovery contract. Inspect the failure, reconcile the actual state and resubmit an authorized delta; do not assume that the entire manifest rolled back.

The role-escalation slice changes no table, column, reducer signature or binding layout. The subsequent handover slice adds defaulted binding metadata, private receipt tables and caller projections; publish its matching schema and clients together. Preserve persistent state with an incremental publish and verify realised and inert bindings and grants. Recovery uses a compatible module or a forward fix retaining escalation, affected-binding, prune, namespace and privacy checks. An older module that admits the refused edits violates the security floor and is not a recovery build. The local rehearsal and supported CLI scenarios are recorded in the escalation evidence (internal record, not in this repository); hosted activation and portable persona publication remain separate operator/.56 work.

## Prepared places

An author declares `[[place_seals]]` on an authored graph or blueprint, with
`place_graph_id`, `bundle_id` and optional `description`. The seal inherits
through the parent chain, including session grids. `MF-VAL-378` rejects unknown
graphs, directly sealed instances, world-owned roots, duplicate seal rows,
foreign root ownership and export-only break fields in authored input.

A privileged apply or spawn checks its destination. A regional DM whose extent
covers a sealed dungeon receives `MF-APPLY-038` or the spawn `sealed` reason
once earlier authority checks pass. The publisher and a writer holding the
operation's capability through a Bundle extent covering every owner of the
root pass its seals. The root owners come from applyset provenance; an authored
bundle stamp alone does not establish the live exemption. On a world loaded
without applyset memory, the publisher must list ownership before other authors
can use this exemption. An own-bundle DM is an author for this purpose.

The `MF-VAL-374` warning examines the core `dm` role only. It warns for a foreign
Bundle extent and for a PlaceGraph extent covered entirely by an ancestor seal;
an own-bundle extent stays silent. Extent kinds resolve through their authored
`resolution_shape`, including custom kind IDs. A warning does not change a grant.

`sk explain place <graph-or-node> --target files` names the sealing ancestor.
Live explanations use publisher observations; other callers see `server decides`
because policy rows are private. Publisher `spellkave seal list|inspect` includes
break provenance and descendant graph IDs. See the local proof (internal record, not in this repository)
for the precise surfaces and evidence status. Ordinary affordances continue to
resolve inside sealed places; seals protect privileged editing, not gameplay.

### Break a prepared boundary through an authored act

The core `warden` role proposes `frontier.break_seal` without creating a binding.
Bind a presence over a `place_graph` extent covering the sealing graph. The core
`core/act/break-seal` action targets a place node; its consequence contains the
unit frame write `frame_write = "BreakPlaceSeal"`. Custom action chains may use
that same unit string through `spellkave_define_consequence` or
`spellkave_define_action_verb`.

Supply the existing manipulation argument `dispatch_text` as the reason. It must
contain non-whitespace text and fit within 1024 UTF-8 bytes before trimming; the
stored reason preserves its original text. The operation resolves the nearest
unbroken sealing ancestor of the target, rechecks the live binding and capability,
and refuses Party and Bundle extents. A descendant-only grant cannot break a
seal on its parent. An open target refuses `not_sealed`; unknown ancestry or a
missing graph anchor fails closed.

A successful consequence produces one durable break row and one Public
`seal_break` trace at the sealing graph's anchor. Both name the same existing
ApplyConsequence event; the event retains the presence binding and capability.
A later failed write in that consequence leaves no break, trace or successful
consequence event. Later sibling writes see a successful break as open while
still checking their own targets, extent and remaining ancestor seals. A deferred
reaction resumes with the original reason and lane and rechecks current authority.
Autonomy jobs cannot invoke this operation.

Publisher `spellkave seal inspect <graph>` shows the acting presence, retained
reason and audit association. Event retention may expire the event without
invalidating the durable break; doctor reports that distinction. An unrelated
`--force` apply overrides applyset memory checks and does not perform this act.
Publish the supporting module before content using this operation. For rollback,
remove that content before restoring the compatible predecessor module; preserve
seal and break rows and verify that remaining seals still refuse privileged edits.

The versioned local proof (internal record, not in this repository)
contains exact installed CLI arguments, shared-tool requests and independent
audit assertions. The installed CLI ran outside the checkout with the warden's
retained credential; the publisher supplied setup and the independent audit,
not the acting credential. `spellkave_manipulate` carries the reason in
`args_json`; the existing `spellkave_communicate` utterance fold reaches the same
transport and preserves its normalized text through a real reaction. No reason
field is added to either tool contract.

A generic force option is not a seal break. The captured regional edit first
receives `MF-APPLY-038`; its scoped forced retry receives `MF-APPLY-042` at root
ownership admission and changes neither the node, seal nor break audit. Root
claims and force decisions belong to `.36`/`.37`; this proves the break-specific
substrate boundary. Hosted MCP delivery (`sk-jay0.3.24.45`) and final portable
publication (`sk-jay0.3.24.56`) remain transitional. These package-owned examples
supply `.56`'s publication source; a scripted pass does not prove unaided discovery.

## Runtime binding deltas

A delta containing only role-binding writes/removals needs the current D-6
binding right for each mutation. It needs neither apply nor prune capability.
A rewrite checks the old and new role/extent; admission rechecks the original
submitter before committing the bounded batch atomically. Mixed content still
requires ordinary author admission. The runtime lane refuses a denied grant
rather than storing it inert. Runtime binding rows use empty `bundle_id`, with
no reserved bundle or applyset memory. Publisher backup must capture those
world-owned rows separately from authored bundle content.

Caller binding reads include subject-owned and currently D-6-manageable rows.
Other rows are omitted, including their ids, counts and descriptions. A
subject-owned binding alone gives no right to revoke it. `grant_inventory`
reveals bindable extents and epoch/tick facts without principals or binding ids.
Per-role completeness headers reveal no hidden roots; only complete admitted
expansion can support a whole-world request (`grant-verb.live.test.ts`).
