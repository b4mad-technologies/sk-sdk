# Defining a DM: region oversight (see-as extent)

How to author a game-master with bounded oversight: use an authored role binding. The binding
realises its merged capabilities on a separate placeless presence body; the
DM's character keeps its own gameplay capabilities. See [roles](./roles.md)
for admission, expiry and persistent rollout.

## The problem this solves

Hidden rows are delivered to their owning body and to an admitted caller with
extent-bearing grants covering that body. `Internal` rows require a higher
elevation ceiling; `Discoverable` rows normally require knowledge, while that
higher ceiling admits them without a knowledge row (ADR-0081/0084). A DM needs
that reach within the scene, rather than across the whole world.

## The mechanism: an extent-bearing grant

```toml
[[role_bindings]]
binding_id = "campaign/alice-dm"
bundle_id = "campaign"
subject = "$sender"
role_id = "dm"
extent_kind_ref = "place_graph"
extent_ref = "campaign/region"
description = "Alice oversees the campaign region."
```

The applying connection must already be admitted to manifest apply. D6 binding
admission separately decides whether this row is realised or remains inert.
Publisher/genesis, covering `frontier.bind.dm`, or covering live grants of every
merged DM capability can realise it. The holder paths refuse extent-blind
capabilities; `dm` contains read authority, six scoped mutation capabilities, session setup
and bounded impersonation. Pacing and
manifest apply have separate grants.

A realised row creates a presence entity and actor, derives grants from the
merged role, and durably mirrors the subject's identity bindings with
`role = "presence"`. `frontier.read_internal` derives `elevation_class =
"internal"`; otherwise the derived class is `"hidden"`, including roles with
no read capability. This preserves the existing extent-grant Hidden floor. This bridge is implemented in
the world API; the .35 compatibility stage also reads the `frontier.read_internal` ID
directly. Legacy authored and derived classes remain active until hosted
backfill (.67) and cutover (.82). The scoped reader (.44) delivers admitted
authored instances and runtime tags with explicit completion metadata; pending
briefings retain separate coverage and redact opaque payloads. See
[reading a world](reading-a-world.md) for the supported reader contract.

The ordinary extent-bearing grant in
[`examples/dm-oversight.toml`](./examples/dm-oversight.toml) remains a valid
worked example of the visibility substrate. It explicitly grants
`dm_oversight/oversee` with `elevation_class = "internal"` to an ordinary
actor body. It does not demonstrate role-binding admission. Gameplay grants
can still author `elevation_class`; role-binding authors choose a role and
receive the derived class instead.

The core extent kinds are authored vocabulary rows:

- `place_graph`: members occupy nodes of the named graph, including child
  combat grids whose parent graph is in the region.
- `party`: the named membership tag and current session peers resolve members.

A non-empty `extent_ref` widens read scope. Extent shape resolves members;
`frontier.read_internal` sets Internal depth, alongside legacy
`elevation_class` during compatibility. An ordinary communicate or act grant can
also use extent membership to admit targets across graphs, independent of
metric range. Keep ordinary read-only watch capabilities out of action and
affordance capability requirements so they do not acquire act reach.

## How to author one

1. Author the region and its place nodes.
2. Choose `dm` or define a role containing the needed read capabilities.
3. Author one `role_bindings` row per desired scope, using an identity hex,
   `$sender`, or an unambiguous non-playable NPC entity key as `subject`.
4. Apply with an admitted author and sufficient D6 authority to realise it.
5. Inspect the exact row with `sk explain binding <binding_id> --target live`.
   An inert row has no presence body or grants; a realised row has both.

The `spellkave_write_rows` tool accepts `kind = "role_bindings"`; the frozen
natural key is `binding_id`. Binding explanation reports scope, merged
capabilities, expiry and derived elevation. An ordinary connected caller sees
its own identity mirrors; foreign identities are redacted. The publisher's
opt-in owner subscription permits fuller inspection. This is explicit binding
inspection (AUTH-34-01), before owned-actor selection (.45).

## Invariants worth knowing

- An empty extent broadens no read scope. Any extent-bearing grant retains
  the existing Hidden floor; Internal requires `frontier.read_internal` or the higher legacy derived/authored
  class during compatibility (`elevation_ceiling` and `owner_delivery_admits`).
- A positive binding expiry is exclusive: `expires_at_tick <= now` confers no
  live authority. Omitted or zero binding expiry means permanent. Both scope
  reads and capability gates ignore expired grants.
- Roles and aggregations are configuration, not authority by themselves.
  An inert binding stores configuration without creating capabilities.
- Authority resides on the separate presence body. Caller resolution unions
  capabilities across its owned bodies; moving or possessing a character does
  not copy role authority onto the new character body.
- An NPC subject is linked through runtime-only `subject_actor_id`, so its
  stable principal survives possession. Only durable primary identity bindings
  are mirrored; connection-scoped player claims are excluded.
- The binding table identifies presence bodies. Claim, release, possession,
  direct binding and forged `role = "presence"` declarations cannot turn those
  bodies into player characters (`role_binding.rs`, actor claim/release gates).
- Scope remains bounded. Use distinct binding IDs for two regions. Changing
  an existing realised binding requires authority over its old and new scope.

## Acting through the presence

A local host selects its caller-owned presence as the acting body. Its
`manipulation_context` discloses the extent's place nodes, including empty
clearings; the presence itself has no physical location. The shared manipulate
tool dispatches the authored `core/act/*` actions described in
[privileges](./privileges.md#privileged-runtime-acts). The exact selected binding
must still be live and cover each write's landing and subject. A second identity
cannot act through that presence, and another body owned by the same identity
does not lend its grant to the act.

An NPC host can explicitly pass `presenceActorId` to `createNpcSeat`; discovery
and dispatch then use that presence rather than the host session's character.
The host hydrates `presenceActRequiredTables` on its existing caller connection.
The real local-node proof is `spellkave-npc-tests/src/live/presence-act.test.ts`;
[recorded SDK, CLI and NPC evidence](../../../sandbox/privileged-acts-as-affordances/README.md)
names the exact supported routes and their measured cost.
Hosted selection and MCP composition remain transitional under `.45`.

## Controlling the shared clock

Bind `timekeeper` separately when a person should pause, resume, step or set
the shared clock's cadence. This is an explicit global effect, even if its
binding names a region. The ordinary `dm` role grants no pacing authority.
The publisher alone loads adventure aggregations that add pacing authority.

The local `createPaceTimeTools` factory offers `spellkave_pace_time` with
`op = pause | resume | step | interval` on the caller's own connection.
`step` accepts `ticks` (default 1, maximum 10000); `interval` requires
`seconds` within the world's configured bounds (default 5–86400).
The factory omits the tool without a current pacing presence and rejects
publisher execution. Revoking a binding removes pacing authority immediately,
including while the clock is paused. Hosted composition belongs to
`authority-tools-over-mcp` (.45); these parameters describe the local tool
contract, not an available hosted invocation.

`spellkave clock status` reports paused state, tick, configured and armed
cadence, an estimated next fire time, and publisher-only pacing attribution in this compatibility stage. Ordinary
timekeepers and `read_internal` callers receive no private pacing rows; the
read extension is deferred to `sk-jay0.3.24.86` after ADR-0151 acceptance. The
estimate comes from the timer's arming time; it is not the host scheduler's
actual next deadline. Pacing events record each admitted call, including
no-ops, while the durable last-pacer row survives event retention. See the
[local acceptance evidence](../../../sandbox/time-control-tools/README.md).

## Authoring safety

A missing extent reference is rejected by the shared FK closure check
(`MF-VAL-101`). `spellkave doctor` also checks live capability extent references
and reports expired extent grants. The report-only
`elevation_class_internal_leftover` check inventories visible stored Internal
rows; run as publisher to see the complete migration inventory and retain
those rows until role backfill and cutover are complete. NPC subject keys must resolve unambiguously
to non-playable NPCs; player bodies are not binding subjects.

Binding and role edits reconcile their realised grants together in one atomic
authority segment. Oversized authority work is refused before enqueue, rather
than partly realised. Earlier structural writes in a segmented live apply can
remain after a later refusal: consult the [apply contract](./getting-started-with-verbs.md#authority-reconciliation-during-live-apply)
and preserve quarantine/unknown-base recovery state.

## Handing the seat to a real occupant

For role authority, edit `role_bindings.subject` to the intended identity or
NPC principal. Do not move its grants onto a character or use a player claim
as a DM handover. The writer must have covering binding authority over the
existing and replacement scope. Retraction or expiry revokes the realised
configuration.

Character-seat writers remain distinct:

| Occupant | Writer | Durability |
|---|---|---|
| An NPC host before startup | publisher-authored `actor_identities` naming the host identity | durable (`connection_id: None`) |
| An ordinary character handed to another identity | operator `r_bind_actor_identity` | durable; presence bodies excluded |
| Host-signed or anonymous player | `r_claim_actor`, eligible primary character only | released on disconnect |
| Player from a trusted identity issuer | `r_claim_actor`, eligible primary character only | durable (ADR-0102) |

### The default: the publisher bootstraps the NPC host

The host first retains its credential and shares its identity with the local
publisher/operator. Before starting the host, that publisher applies:

```toml
[[actor_identities]]
bundle_id = "campaign"
entity_key = "campaign/aldwin"
identity = "<retained-host-identity-hex>"
role = "primary"
```

This durable membership creates the NPC subject's presence mirrors. The host
then claims its existing primary binding; the claim does not demote durable
membership. Re-declaring an already durable self-binding is unnecessary and
can be a no-op. An anonymous connection-scoped claim alone receives no presence
authority, and cannot apply a self-bind delta to bootstrap it (`MF-APPLY-015`).
Even a separate apply grant does not waive D6 for changing a role-bound NPC's
durable primary membership. Use the publisher-mediated bootstrap rather than
putting publishing credentials in the host. The host integration lives in
`packages/spellkave-adventure-kavemouth/scripts/host.ts`; this source pointer
is not a hosted acceptance claim.

### The exception: an operator hands over a seat

The publishing identity can bind an ordinary character through
`r_bind_actor_identity`. That reducer refuses presence bodies and the reserved
`presence` label. Giving someone DM authority instead means authoring or
editing the role binding; it does not require putting publishing credentials
in the recipient's client.

`spellkave doctor` flags placeholder character identities as an operator FYI.
A fixed illustrative identity hex is not evidence of a real occupant.

## See also

- [Roles and bindings](./roles.md) — authored fields, D6 admission and rollout.
- [Privileges](./privileges.md) — current gates and temporary bare-grant lane.
- [Manifest format](./manifest-format.md) — role-binding and ordinary grant rows.
- [Ordinary extent example](./examples/dm-oversight.toml) — the visibility substrate.
- ADR-0007, ADR-0081, ADR-0084 — extent membership and elevation ceilings.
- ADR-0097, ADR-0102 — connection-scoped and durable character bindings.

## Working around prepared places

A seal marks a prepared region that regional privileged edits must respect.
Choose an unsealed destination, or let its bundle author make the correction.
A wider PlaceGraph extent does not bypass an ancestor seal. Before applying,
inspect the destination with `sk explain place <graph-or-node>`; a private live
policy is reported as `server decides`, and admission remains authoritative.

A publisher export joins the durable break overlay as `broken = true` and
`break_reason`. These fields participate in drift hashes and cannot be authored.
A whole-bundle reload preserves the break when it reinserts that authored seal.
An applyset or delta upsert explicitly re-seals it by deleting the break overlay;
retraction and despawn remove both rows. A copied instance seal belongs to the
cause of the instance, including the world for runtime instances, so its lifetime
follows that instance. Session grids inherit without storing another seal row.

When live drift cannot be read for a `place_seals` upsert, `sk apply -k` exits `2`
and names the unread seal rows. Review with the publisher or deliberately use
`--force`; the receipt records `world_changed`. An exempt raw delta is an
accepted lower-level route that re-seals without that client decision. The
authored `core/act/break-seal` uses a warden presence with a covering PlaceGraph
binding and an explicit `dispatch_text` reason. It changes one selected seal,
records a Public trace and preserves the ordinary consequence provenance; a
generic forced edit does not invoke it. See [the authored break guide](roles.md#break-a-prepared-boundary-through-an-authored-act)
and [local evidence](../../../sandbox/seal-break-as-affordance/README.md).

## Steering and held NPC control

A live DM presence with `frontier.impersonate` may act as an ordinary Actor
body inside its complete place/entity extent. Read authority alone does not
admit steering. A Person primary offers its exact DM login through
`spellkave_offer_control`; `spellkave_withdraw_control` removes that consent.
These PLAYER tools create no direct control or sight. Authored Service rows
may declare backup co-pilots; manifests cannot consent on behalf of a Person.

The canonical manipulate, move, sense and manipulation_context tools offer `as_body_id`
when the caller owns a current impersonation presence. Preview refreshes the
puppet's derived discovery. An NPC act carries the `control_token` observed
with perception; preview never replaces it at dispatch. SessionMove and
compound-intent steering use the current actor's same admission through the
SDK reducers. Their admission and step composition are proved at the server
tier, with live refusal cases; the positive production walk remains
transitional until `sk-jay0.3.24.147` supplies its compound-intent bootstrap and
authoring path. These calls remain subject to authored action gates and seals.

`spellkave_take_npc_control` acquires an eligible Service-driven NPC using an
observed world/generation, caller-owned presence, request id and reason.
`spellkave_return_npc_control` explicitly surrenders the recorded hold. Idle,
disconnect, host restart and loss of the granting role do not resume the AI;
the recorded holder may still return after role loss. Another DM cannot inherit
that hold through role transfer. Publisher recovery is the separate installed
CLI `actor control recover` operation. Every transition bumps generation, so
work perceived before takeover remains stale after return. The Service identity
binding stays in place throughout.

When the publisher directly drives several Service participants, session
completion requires an original observation for each of them. The installed
`spellkave session close` accepts an explicit `--control-tokens` JSON array;
a single deciding-body token remains authoritative for its own body and cannot
be replaced by a newer value in that array. A stale or held participant refuses
before termination writes. The local multi-Service proof captures the exact
installed command and independently verifies completion and atomic refusals.

`spellkave actor control list|transitions|work|audit|events` reports authorized
private control state, history, frozen continuations, publisher refusal audit and
steering attribution. Driver-only and sight-only callers do not receive the
DM's steering login. The local synthetic MCP/CLI consumer proof is
`packages/spellkave-tool-player/src/__tests__/act-as-consent.local-node.test.ts`.
Proximity host integration remains transitional under `sk-jay0.3.24.144`;
persistent hosted activation and legacy backfill/classification are owned by
`sk-jay0.3.24.145`. A local proof does not certify public availability.


The [versioned local control walkthrough](../../../sandbox/act-as-and-consent/evidence/2026-10-06-local/index.json)
contains exact successful MCP parameters, installed CLI calls and atomic
refusal/recovery traces. For example, the verified MCP route offers
`spellkave_take_npc_control` with `presence_actor_id`, `actor_id`,
`expected_generation`, `world_instance_id`, `request_id` and `reason`; explicit
surrender uses `spellkave_return_npc_control` with the recorded actor, world and
generation. Copy observed values from the current scene rather than reusing
illustrative actor IDs or generations. Multi-Service `spellkave_session_close`
also accepts explicit `control_tokens` carrying each original participant
observation; these values do not refresh the deciding body's original token.

The installed package exposes this full guide through
`sk docs --doc dm-oversight --full`; `sk docs --query "held NPC"` finds the
relevant control guidance. Both invocations were executed outside the checkout.
The captures measure scripted elapsed time, bytes, calls and developer setup
separately, with zero model calls. They do not measure unaided discovery or
certify hosted tool availability; `.45`/`.56` own that composition/publication.
