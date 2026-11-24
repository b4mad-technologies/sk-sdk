# Author or run a session through hosted tools

Public help uses `spellkave_docs` without a character or author grant. It reads
curated package content; it never selects a role, opens a file or executes an
example. The connector still requires its normal authentication. Start with
`query: "container loot"`, retrieve `doc: "patterns/container-with-loot"` and
use `section` or `full` when needed. Replies identify the corpus and document.

## Choose your context

Inspect the tools offered by this connection. A presence-only author can have
authoring tools without PLAYER movement tools. A DM's abilities come from the
current role and extent, not the persona name. Call `spellkave_acting_context`
to read your admitted choices, then pass its returned `binding_id` to that same
tool when you need a particular presence. Use returned identifiers; examples do
not supply a real world or binding ID. Foreign and revoked presences are refused.

A caller without live authority can still read public help. A missing live tool
means this connection cannot run that operation. Help grants no rights; do not
substitute a publisher credential. Multiple candidate worlds produce the typed
`ambiguous_authority_world` refusal. Its `public_tools` descriptor still identifies
public help; a direct `spellkave_docs` call remains available without world routing.

## Prepare a portable change

The non-publisher MCP diff/apply workflow is temporarily unavailable after the
private applyset baseline cutover. HTTP and local stdio author callers receive
the typed `baseline_unavailable` refusal before baseline subscription or enqueue,
including for a new logical root or `force`. Tool discovery does not grant
baseline access. Publisher reconciliation retains its operator-view route;
regional comparable baseline delivery is tracked in sk-jay0.3.24.160. Scoped
instance reads and direct binding tools retain their separate admission checks.

With publisher baseline access, use the offered `spellkave_applyset_diff` and
`spellkave_applyset_apply` contracts.
Hosted input supplies `source` with `root_path`, `root_toml` and `fragments`.
These are logical file names and content, not server paths. Supply every include
fragment. A path-only request is refused with payload recovery guidance; source
is bounded to 1 MiB decoded UTF-8 and 128 fragments. Read the returned diff and
coverage before applying. Missing scoped observations cannot be overridden by
`force`; the live server rechecks the caller's current authority.

The selected container example is an excerpt with bundle, place, SRD and actor
prerequisites. Retrieving it does not assemble its dependency closure or prove
live pickup. Use the guide's explicit prerequisites and the offered schema.

## Read or act within your scope

Use the offered instance-read and gameplay tools. Scoped reads admit only the
caller’s current read depths and extents. Selecting a presence does not turn
public docs into a world reader. Mutation, time control, steering and consent
retain the feature's server checks; tool discovery is not an authorization grant.
The [player loop](../../spellkave-tool-player/docs/player-loop.md) explains
ordinary observation, attempt and refusal recovery.

## Evidence and limits

The [authority transport proof](../../../sandbox/authority-tools-over-mcp/README.md)
records AUTH-45-01/02 on a disposable node with real caller HTTP and local stdio
MCP, portable inputs and independent state assertions. Its named historical
captures predate private baselines. The current AUTH-45-01 and local stdio cases
require typed baseline refusal and unchanged publisher reconciliation and role
inventories. The paused-revoke case owns its retained viewer binding through
publisher setup, preserving its revocation assertions independently of payload
apply. AUTH-56-01/02 extend that consumer route with public-docs search,
no-authority/presence-only/DM retrieval, private-state absence, planned status and
refusal recovery. These native transport proofs do not certify a deployed
connector, live WorkOS login, external Claude application or unaided discovery.
Documentation revisions do not certify world behavior. Missing server version
evidence remains `unknown`.

[Scene setup](./parameterized-scenes.md) under `parameterized-scene-setups` (.50)
has installed CLI and real caller HTTP MCP proof on a disposable local node;
its captures do not certify a persistent hosted deployment. Atomic DM hand-over
under `role-binding-hand-over` (.47) remains
[planned](./hosted-authoring-guidance.md), with no passing badge for that
unexecuted story. Inspect this connection's offered tools before attempting either
operation.

## Scenario evidence

AUTH-56-01/02 cover public discovery, caller-owned context, planned stories and
refusal/recovery through the native real-caller route. Retrieve
`evidence/auth-56-hosted-mcp` for its named implementation and surface, independent
assertions and complete journey cost; `evidence/auth-56-hosted-mcp-transcript`
contains the complete sanitized guidance RPC frames. These scoped historical
captures remain distinct from the current corpus that embeds them and do not
certify a deployed service or external login.

## Delegated live definition edits

A hosted world's live `adventure-author` may use the Account API publisher Job
service with their own JWT bearer. `adventure-author` is full trust in that world:
this delegation covers definitions and descriptions as well as instances, across
the selected world even when the binding names a smaller extent. ANY live
`adventure-author` binding grants world-wide publisher-level delta authority
through this service; grant only to fully trusted accounts. An Account owner,
operator, DM without author role, or author of another world has no implicit right.

From a shell with the repository tools installed, provide your own bearer through
`SPELLKAVE_OPERATOR_TOKEN` (do not print it) and run:

```bash
bin/skop --jwt world-delta <world-slug> /path/to/delta.toml
```

The CLI submits `POST /v1/worlds/:slug/manifest-deltas` with `{ "toml": "…" }`,
then follows `GET /v1/worlds/:slug/manifest-delta-jobs/:jobId`. This is the hosted
alternative when `spellkave_apply_manifest_delta` refuses a definition edit;
the MCP tool itself retains its scoped admission. Portable applyset diff/apply
still needs regional baselines and may return `baseline_unavailable`.

Supply a complete delta, including `schema_version` and the full `[[bundles]]`
header for the changed bundle. Canonical ADR-0085 validation/upserts still apply.
Re-declare a containment parent (`MF-APPLY-026`); entity retractions use
`bundle:entity_key`. Missing apply authority (`MF-APPLY-015`) or a drain watchdog
(`MF-APPLY-029`) is a refusal/uncertain outcome, never permission to retry blindly.
The payload limit is 16,384 characters. Publisher credentials stay in the Job.

Admission is valid for five minutes for that exact delta and world instance.
Revocation stops subsequent admissions; it does not cancel already admitted work.
A 202/job ID is not success. Wait for the bounded `world-delta/v1` receipt: CLI
exit 0 means confirmed apply; exit 2 means refused or unconfirmed. Only the caller
can retrieve its receipt. Save the delta hash and Job ID, inspect uncertain world
state before retrying, and have a player observe the next ordinary read. Patches
are silent; author an in-world signal when a player should notice the DM's change.

Delegated content deltas refuse role bindings, definitions and aggregations,
including their retractions, with `delta_role_changes_forbidden`. Use the explicit
role-management path for role changes. Capability definitions remain content and
may be edited. Invalid TOML is refused at admission with `delta_invalid_toml`;
ordinary content still receives canonical manifest validation in the Job.

The status route retains your original TOML, delta SHA-256 and terminal receipt
after executor Job expiry. Evidence lives in the publisher-only control journal
and is returned only to the requesting account.
