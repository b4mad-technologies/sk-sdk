# Granting and recovering runtime roles

Use `spellkave_grant_role` for live role authority and `spellkave_bind_actor` for
character identity and ordinary capabilities. A realized role binding has its
own presence body. The server evaluates D-6 from the caller's current directly
bound primary/presence bodies: exact `frontier.bind.<role_id>` over the binding
extent, or every nonempty final merged role capability over that extent.
Summoner edges and extent-blind `frontier.apply_manifest` grants supply no D-6
right. Publisher admission remains available. Discovery is advisory; each call
checks current authority again. See [roles](./roles.md) for the ordinary-content
inert insertion and transitional author lane.

## Grant and revoke

A connected publisher or admitted grantor can run:

```bash
sk --live grant dm 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef forest --extent-kind place_graph
sk --live grants list --role dm
sk --live revoke '<binding_id from the grant receipt>'
```

These are synthetic subjects/extents; replace them with existing world facts.
A community grantor needs D-6 for the chosen role and extent, without separate
apply/prune privileges. Rewrites need both old and new authority. A mixed delta
still needs ordinary author admission for its other rows. Runtime requests are
world-owned (`bundle_id = ""`) with no applyset memory or reserved grants bundle,
following ADR-0154 D-2/D-6 (Proposed planned canon). Workspace grant composition
retains the selected authored bundle. Runtime grants survive authored bundle
reapply; scripted bindings follow their bundle replacement/retraction contract.

The `grants/v1/` natural key encodes role, concrete subject, extent kind and
reference unambiguously. `$sender` becomes the authenticated caller before key
construction. Repeating an authorized unchanged grant is idempotent; expiry or
description changes update that tuple. Requests check at enqueue and immediately
before one atomic mutation. The batch bound is 128 mutations and 256 KiB of
canonical serialized manifest JSON. Oversized expansions refuse before staging.
The live test `grant-verb.live.test.ts` checks direct/tool transport parity,
revocation, mixed edits, authored storage refusal and queued loss of authority.

A revoke confirms the binding is absent from its caller connection before
reporting success. If it reports `binding remains`, treat that grant as active
and inspect `sk --live grants list`; an earlier successful revoke does not
confirm removal after the same binding was restored. The command reports
failure instead of silently treating the earlier request as a new removal.
If current read authority cannot confirm absence, it reports an unconfirmed
failure; inspect with a principal that can still read/manage that binding.

## Whole-world snapshot

```bash
sk --live grant dm '$sender' '*' --extent-kind place_graph
```

`*` is tool input only. The tool requires the server-computed complete expansion flag for the selected role and expands the admitted current root-graph and bundle inventory into explicit bindings, sorts/deduplicates it, previews every
row, and submits one batch. Missing or incomplete inventory, one denied extent or an
oversized batch refuses the entire operation. No world extent is stored. Later
loaded roots/bundles require another grant. The receipt records tick, digest and
covered extents. Individual descriptions mention only their own extent, so a
recipient does not learn unrelated inventory through a binding description.

## Private list and export

`sk --live grants list` reads the server-filtered binding view. The publisher
sees every row. Other callers see their own identity bindings, durable-primary
NPC bindings and bindings manageable by D-6; inaccessible rows, counts and metadata are omitted. Grant inventory likewise omits root places the caller cannot bind; metadata-only role headers reveal completeness without naming omitted places. Subject-only descriptions are stripped. Opaque revocation
refuses absent and inaccessible IDs identically. `spellkave role-binding
list|inspect|inventory` and `spellkave doctor` provide the observability triplet.

```bash
sk --live grants export --out runtime-grants.json
```

The portable `spellkave-grants/v1` export contains world-owned authored binding rows,
concrete subjects and a receipt with source endpoint, existing world instance,
source tick, original expiry, coverage and digests. It excludes derived presence,
capabilities and actor identity state. A publisher export is complete; a
nonpublisher export is scoped and cannot be a full-world backup. Hosts without a
filesystem receive the artifact in the canonical tool result. Hosted MCP routing
is transitional under `authority-tools-over-mcp` (`sk-jay0.3.24.45`); this guide
claims the local CLI/Pi contracts and portable artifact only.

## Restore after reset

```bash
sk --live grants restore runtime-grants.json
sk --live grants restore runtime-grants.json --rebase-expiry
sk --live grants restore runtime-grants.json --rebase-expiry --apply
```

The default is preview. Same-instance restore preserves absolute expiry. A
changed world instance requires explicit `--rebase-expiry`; expiry becomes the
destination tick plus remaining simulated ticks at export. Export tick 90,
expiry 100 and destination tick 3 becomes expiry 13. Permanent rows remain
permanent; source-expired rows refuse. Downtime advances no simulated ticks.
The artifact/plan digests and destination identity, endpoint and instance are
pinned; application rechecks current D-6 and the expected instance on the server.
Raw TOML replay has no export epoch receipt and cannot establish this recovery
policy. Restoration refuses tampered artifacts, changed destinations and
unauthorized callers; it never silently extends expiry across resets.

Before a hosted reset, the release operator must obtain a complete publisher
export, preserve its receipt, seed required vocabulary, preview against the new
instance, then explicitly apply. Reset and restore are operator decisions, not
automatic tool side effects. See the change's release evidence for preservation,
feature disable and privacy-preserving compatibility constraints.

## Hand over one binding

Preparation reads the current row under the caller's own credentials:

```sh
sk --live grants prepare-hand-over '<binding_id>' '<backup identity or authored NPC key>'
```

Copy its `expected_digest`, `expected_merged_role_digest`, `expected_incarnation`
and `expected_revision` into the explicit commit. Generate a fresh UUID once for
this operation and retain it across retries:

```sh
sk --live grants hand-over '<binding_id>' '<backup subject>' \
  --expected-digest '<reviewed digest>' \
  --expected-merged-role-digest '<reviewed merged role digest>' \
  --expected-incarnation '<reviewed incarnation>' --expected-revision '<reviewed revision>' \
  --request-id '<retained UUID>' --reason 'Backup takes over this region'
```

The shared tool contracts are `spellkave_prepare_hand_over` and
`spellkave_hand_over_role`. Hosted MCP routing is transitional until
`authority-tools-over-mcp` (`sk-jay0.3.24.45`); portable guide publication belongs
to `.56`. The CLI uses the same execution body and actual caller identity.
The server checks D-6 over both values at enqueue and atomic commit. Being the
current holder alone supplies no bypass. Before admission, missing bindings,
correct-holder guesses and stale pins produce the same private refusal. There
is no recipient accept step in this version: covering old/new D-6 admits the
transfer, and the recipient can resign a runtime binding with the existing
`sk --live revoke` command. Future recipient acceptance is an explicit operator
decision in `sk-jay0.3.24.163`; personal control still requires its own consent. Transfer changes only subject and
preserves the presence, role, extent, note and exclusive expiry. It cannot be
combined with another row, retraction or scope edit. An unchanged/inert row or
new grant does not require transfer preconditions.

`binding_preconditions` is a typed optional manifest array containing those
four reviewed values, `binding_id`, `request_id` and `reason`. Digests use
64 lowercase hexadecimal characters; revision is a decimal u64 wire string.
Reason must contain non-whitespace text within 1024 UTF-8 bytes. Incarnation and
revision are server-owned; every binding upsert advances revision, and a newly
created row gets a fresh incarnation. A restored export supplies neither.
A stale role, binding, expiry, away-and-back transition or natural-key reuse
requires a new preview. A successful receipt is the completion boundary;
preparation and enqueue alone are not completion. An identical retry returns
that sender-bound receipt; altered request content refuses.

The optional authored `handover_note` contains shared plain text, bounded to
16384 UTF-8 bytes. Its edits use ordinary old/new D-6. It is private metadata
and cannot grant authority or execute instructions. Grant export includes it
only for caller-visible bindings; default export includes no transfer receipts
or personal client conversations. A default grant backup preserves expiry;
reset/restore never fabricates old receipts or old concurrency stamps.

Preparation reports its source tick and separate request/job coverage.
`outside_read_scope`, `reader_unavailable` or `incomplete` means unavailable or
partial context; an empty list under such status is not evidence of no work.
`payload_redacted` gives authorized headers with private payload withheld.
The projection intersects caller-authorized regional reads with the selected
binding's bounded spatial closure. Held blockers likewise report only admitted
bodies in that closure. A preview is not a frozen snapshot.

| Context | After transfer |
|---|---|
| Shared note, presence and grants | Attached to the same binding |
| Pending requests and authority-only jobs | Same IDs and deadlines; landing rechecks current authority |
| Independent grants and character claims | Retained by their original principal |
| Personal steering and queued co-pilot work | Old selected generation invalidated; recipient needs their own consent |
| Held NPC control | Remains suspended for the old holder; explicit return or publisher recovery precedes a new acquisition |
| World pause and timekeeper | Unchanged; handover creates no independent clock authority |

Inspect history using `spellkave role-binding hand-over list` or
`spellkave role-binding hand-over inspect '<request_id>' '<binding_id>'`.
`Line::RoleBindingTransfer` and doctor `role_binding_transfer_integrity` use the
private caller projection. Publisher, immutable old/new principal parties and
current D-6 administrators can inspect permitted metadata. An old receipt gives
no current briefing right. Deleted bindings and expired transient apply records
remain valid history; runtime reset clears it. Receipt logs contain only binding,
request and revision references, without shared-note text or a copied briefing.

Publish the schema/server before consumers send the new optional fields;
consumers feature-detect both handover views and refuse unsupported modules.
Incremental publication preserves legacy binding rows with defaulted runtime
columns and the existing held-control stamp of an untouched migrated row. Its
first binding write permanently advances to a versioned stamp; new or recreated
bindings cannot restore the legacy sentinel. Deploy matching generated bindings
after the schema upgrade: current bindings decoding predecessor row layouts are
unsupported, and tool feature detection does not promise that decoding.
Take an operator backup before a persistent deployment and verify
binding/presence/seat counts afterward. Rollback disables new tools first and
uses a compatible build retaining guarded subject edits, privacy and receipt
storage; reopening the unguarded predecessor violates the security floor.
Freeze grant writes if no compatible rollback exists, then forward-recover.
The hosted activation/pairing, rollback and eventual legacy-stamp branch retirement
obligations are tracked in `.145`; retirement requires an inventory showing no
untouched migrated sentinel rows remain.
Local production/queued captures and the preservation/compatibility-build
rehearsal are linked from the [handover evidence report](../../../sandbox/role-binding-hand-over/README.md).
The examples prove the named local caller surface; `.45` and `.56` own hosted
routing and portable publication, respectively.
No hosted reset is required or authorized by these local changes.
