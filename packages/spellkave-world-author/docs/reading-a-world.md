# Reading a running world

Files are read by `sk inspect`. The running world is read by `sk get` and
`sk describe`. Definitions and the workspace scratch are read by `sk query`.

The publisher uses its owner cache. A non-publisher with binding-held
`frontier.read_hidden` or `frontier.read_internal` uses an isolated snapshot of
server-admitted authoring views. The snapshot rechecks current grants and scope;
a write capability alone does not grant this read. Neither path calls the
manifest export.

| You want | Run |
|---|---|
| Authored instance rows of one kind | `sk get <kind> [key]` (compact listings; keyed get returns the whole admitted row) |
| One placed entity, admitted place or containment chain and belonging | `sk describe entities <key>` |
| Definitions / workspace | `sk query --target live` |
| Files | `sk inspect` |

The supported instance kinds are `entities`, `actors`,
`actor_spatial_locations`, `actor_capabilities`, `actor_equipment_slots`,
`entity_containment`, `entity_tag` and `object_state`. `object_state` listings
keep `value_int`/`value_bool`. Unsupported kinds return a usage error.

Keys retain `{bundle_id}:{entity_key}` in private storage. Publisher reads use
`operator_manifest_authored_entity`; scoped authoring reads use
`authoring_manifest_authored_entity`. Gameplay uses
`visible_manifest_authored_entity` with complete version-1 coverage.
Answers emit the stripped `entity_key`. Omit `--bundle` when that key is unique
within admitted rows; ambiguity reports admitted bundles only. A token that is
one entity's key and another admitted entity's numeric id is refused as usage.
Use an unambiguous authored key or numeric id. An inaccessible scoped key and
an absent key both return `not_found_in_scope`; missing view support or revoked
read authority returns `reader_unavailable` with a nonzero CLI exit.

Scoped answers include `source`: caller/world identity, connection and source
epochs, transaction tick, projection version, admitted binding IDs/read depths,
bundle scopes and coverage per kind. Coverage distinguishes complete, masked,
incomplete and outside-read-scope observations. Empty complete results certify
absence within admitted scope; masked or incomplete observations do not.
Enumeration examines at most 10,000 subjects/rows with one overflow sentinel.
Source epochs change when observations change even while the world tick is
paused. Snapshots are detached and immutable; each read retires the previous
subscription group before collecting the next transaction-complete group.

The `authored_entities_only` label bounds listings and keyed entry points.
Relationships need both endpoints admitted. An outside containment endpoint
ends a scoped chain with `outside_read_scope`, without exposing its label or
identity. Runtime instance tags, including tags on unauthored spawned objects,
use the separate caller-admitted gameplay membership view. They are not added
to authored comparison. Definition tags remain public vocabulary.

`sk diff -k`, `sk apply -k` and the shared MCP applyset diff/apply tools currently
require the exact publisher's baseline access. Other callers receive the typed
`baseline_unavailable` refusal before baseline subscription or enqueue, including
with `--force` or a new logical root. This temporarily removes the non-publisher
HTTP and local stdio MCP diff/apply workflow. Binding-only direct deltas and
scoped `get`/`describe` retain their independent admission lanes. Regional
comparable baseline delivery is tracked in sk-jay0.3.24.160.

Publisher comparison reads the root, parts and comparable hashes together through
one required operator-view subscription. Missing secure views return
`reader_unavailable`; there is no fallback to public storage or optional hashes.
The server checks generation and current extent admission at commit. Runtime
changes can still race an optimistic comparison.

Local installed CLI and migration evidence:
[role-scoped proof](../../../sandbox/role-scoped-world-read/README.md).
Hosted MCP transport and the complete exploration journey are proved by their
owning changes, `authority-tools-over-mcp` (.45) and
`persona-world-exploration` (.58). The publisher loft-chest example remains in
`sandbox/apply-loop/README.md`; its full dependency closure is broader than a
regional read.

The root, parts, comparable hashes and authored mapping bases are private.
`private-applyset-baselines` closes this historical channel; refusal receipts,
runtime-event satellites, validator audit and digest classification remain
separate follow-ups (.156, .157, .159 and .161). Complete authored-metadata
secrecy is not claimed. Hosted activation and .44 backfills remain release work
under .139.
