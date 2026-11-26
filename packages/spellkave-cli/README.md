# `sk` — the registry-driven Spellkave CLI

`sk` is a command-line surface over the shared role contracts and their
session/authoring implementations — the same contracts an in-process agent
host (the Pi extension) binds directly. Registry tool commands, flags, and
schema-derived help come from that registry at runtime. Adding a tool to the
registry makes it callable from `sk` without edits in this package
(`src/__tests__/registry-parity.test.ts`). File commands and repository
maintenance commands are declared separately in `src/cli.ts`.

Agents: `sk skill path` locates the packaged discovery skill. It routes to
the CLI-owned workflow guide (`sk docs cli/workflows`) and focused task guides
such as `sk docs find-an-authoring-pattern`. The same corpus serves MCP docs;
help supplies product knowledge and does not confer world authority.

## Prepare authoring artifacts in a source checkout

Run `sk authoring prepare` from an SDK source checkout to regenerate the
authoring corpus and verify the reviewed example diagnostics. It uses the
installed validator and can run offline.

The CLI starts with its core command set. To opt into plugins installed in
another workspace, set `SPELLKAVE_PLUGIN_MANIFEST` to that workspace's
`package.json`. Its `sk.plugins` array names each package and the command
group it mounts. The CLI resolves the plugin relative to that manifest.

## Portable candidate and evidence

`pnpm --filter @spellkave/cli run pack:portable <output.tar.gz>` builds a
platform-specific production dependency bundle with its corpus revision,
base revision, dirty-source status and SHA-256 receipt. This local candidate
does not publish a registry package. Registry publication is not required for
this installed-distribution proof.
`pnpm --filter @spellkave/cli run test:portable <output.tar.gz> <proof.json>`
runs its actual executable outside the checkout with isolated product config
and captures interactions, assertions, refusals/recovery and pinned text cost.
No world or credential setup is needed for documentation lookup. The consumer
needs a compatible Node executable; dependencies and the TypeScript loader are
inside the artifact. Preserve both artifact and receipt when reproducing a run.

After capturing a clean committed candidate, `bundle:portable <artifact.tar.gz>
<proof.json> <bundle.tar.gz>` assembles a versioned consumer handoff: archive,
receipt, checksums, sanitized proof, readable evidence and no-checkout install
steps. Unpack that bundle, run `shasum -a 256 -c SHA256SUMS`, then
`mkdir installed && tar -xzf cli.tar.gz -C installed`. Run
`installed/sk/bin/sk.js docs --query "container loot"` and retrieve
`patterns/container-with-loot` followed by `spatial-minimal-cell` for a separate worked example. Read
`evidence.md`/`proof.json` beside the archive for that exact candidate's trace.
The selected excerpt's prerequisites are explicit; this does not claim live pickup.
The bundle refuses dirty source receipts or mismatched/failed proofs. Producing
it requires the checkout; consuming it requires only the recorded Node/platform
and tar/checksum tools. Keep candidate directories side by side to roll back.

Persona/access routing is `sk docs personas/access`; the PLAYER-owned loop is
`sk docs player/workflows`. Hosted consumers use the offered `spellkave_docs`
operation with those same IDs.

The [historical installed-candidate evidence](docs/installed-cli-evidence.md)
is retrievable as `sk docs evidence/auth-56-installed-cli --full`. It identifies
the tested artifact; current release, hosted and live acceptance remain separate.
Guidance and adapter updates require no persistent-world reset or credential
migration. A rollback may omit additive metadata while retaining stable IDs and
existing `sk skill path`; it must retain truthful planned/historical labeling.

## What `sk` is for

Two audiences, two registries, one CLI:

| Facing | What it is | Connection | Examples |
|---|---|---|---|
| **AUTHOR** | edit a world's content off a manifest — place entities and actors, define capabilities, write rows, evaluate DSL formulas offline, validate/lint/render TOML | offline by default; `apply_manifest_delta` needs a flush destination and `export` a live connection | `sk query`, `sk eval`, `sk place_entity`, `sk define_capability`, `sk validate`, `sk patch` |
| **PLAYER** | perceive and act as one connected in-world actor — see the scene, check inventory, take an affordance action, react | always connected, through a background session daemon | `sk scene`, `sk move`, `sk inventory`, `sk react_option` |

Run `sk list` for the registry, `sk help` for a summary of both halves, and
`sk help <tool>` for one tool's schema-derived flags. Plugin command groups
(see "Plugins" below) appear in the same listing with their full path.
`sk tool <registry-name>` is the explicit form of any registry tool. Results render as
width-aware Markdown when stdout is an interactive terminal and remain
canonical JSONL when redirected or piped; `sk explore` answers in TOON unless told
otherwise. `--format human|jsonl|toon` makes the choice explicit (see "Output contract"
below).

`sk inspect`, `sk validate`, `sk lint`, and `sk map-inspect` use the effective
`author.target` and its complete include closure when no manifest path is
given. Pass an explicit `manifest.toml` to read a different file without
changing configuration; add `--bundle` there when its includes belong in the
result. Human results end with contextual next commands, while empty session
and map states explain how to create the missing state.

When `--bundle --dep <manifest.toml>` combines bundles, only the selected root's
metadata enters the flattened validation document. Each dependency's complete
root metadata tree and each include's metadata stay local to their source file;
they do not overwrite the selected root's documentation. Metadata attachments
remain catalog rows. The bundle reader retains original root text and pairs
include metadata with its declared path (`src/__tests__/bundle.test.ts`).

`sk inspect` is also the human exploration path from overview to detail. Its
overview shows the exact key beside every populated row kind; feed that key
back into `sk inspect --kind <row-kind>` to list rows, then add `--id <row-id>`
to inspect one row and its references. The registry-level `sk query` command
remains available for agents, scripts, and compatibility, but people do not
need to switch command vocabularies while exploring.

`sk explore` finds and inspects rows of one world source, read-only:

```bash
sk explore summary                     # collections, coverage and row counts from one source
sk explore search loft                 # with `[author] target` set in .spellkave/config.toml
sk --target ./adventure.manifest.toml explore search loft
sk explore search inn --kind place_nodes --field description
sk explore detail <kind> <key> --source-id <id>      # <kind> <key> as in `sk get`
sk explore neighbors|references <kind> <key> --source-id <id> [--direction inbound]
sk explore field <kind> <key> <field> --source-id <id> [--offset n]
```

`summary` reports all three collections from the same snapshot. Complete collections
carry totals and populated row-kind counts; an incomplete collection has an unknown
total (`null` in TOON) and no kind counts. An actor row and its entity body can describe
the same being. The summary links to `sk docs playable-seats`: authored inventory does
not establish current live seat availability. Explicit `--help` and `sk help` print
plain text on stdout in every output mode; stderr remains diagnostic output.

For an edit-impact check, find the definition, run `explore references` with
`--direction inbound` and follow the returned instance detail and neighbors commands.
Each hop keeps its source binding and coverage. This is a one-hop reference check,
not a guarantee of all transitive effects of changing a rule.

The source is `--source local|workspace|live`; the default is `local` when a `--target`
is set and the connected world otherwise. Sources are never unioned. List flags repeat
(`--field a --field b`, `--tag x --tag y`). A reference needs the `source_id` of the
answer that returned it, so run the commands an answer prints under `next` exactly as
printed: each is one complete line carrying the source, the `--source-id`, the
reference and the global flags you passed (`--target`, `--fixtures-root`, `--workspace`,
`--profile`); with those set in `.spellkave/config.toml` the lines carry none. `recovery`
is printed the same way.

`sk explore` answers in [TOON](https://toonformat.dev) by default, on a terminal and in a
pipe. A search is a first look: it returns the best five matches (`--limit` up to 100 sets
another page size), ranked by the label (equals the text, starts with it, contains it, then
rows that only mention it elsewhere; equal ranks keep their stable key order), with the
`total`, a `more` line and the `next` commands that page on or widen the page:

```text
total: 7
more: showing 5 of 7; the next commands show more
items[5]{kind,key,label,context}:
  place_nodes,elven_mini/inn/bar,Bar,place_graphs elven_mini/inn
  place_nodes,elven_mini/deep_tomb/warden_gate,Warden Gate,place_graphs elven_mini/deep_tomb
  ...
next[2]{command}:
  sk explore search bar --source local --source-id cc389a60e78b09bd --cursor eyJ2IjoxLC...
  sk explore search bar --source local --source-id cc389a60e78b09bd --limit 20
```

Every successful answer and exploration refusal prints `completeness`. The `source`, `source_id`, `world` and `coverage` lines are printed only when
they matter: the answer is from a source other than the one you would get without
`--source`, or a family the search reads is not complete (then `coverage` names it and
`total` is left out). A search for places never warns about incomplete definitions. Every
printed `next` command carries `--source` and `--source-id`, so a follow-up never reads
another world. A reference follow-up looks like this:

```text
completeness: complete
total: 1
items[1]{kind,key,label,context}:
  place_nodes,town/a,Straße,place_graphs town/town
next[2]{command}:
  sk explore detail place_nodes town/a --bundle town --source local --source-id cc389a60e78b09bd
  sk explore neighbors place_nodes town/a --bundle town --source local --source-id cc389a60e78b09bd
```

An empty search names its scope, for example `items: 0 matches in places; complete for this scope only`,
and offers searches of the other collections when no kind or container restricts it.
These follow-ups preserve text, bundle, tags and source; they do not count or read the other collections until run.
An unreadable
source is one `error:` block with `reason`, `error_class`, `cause` and `hint`. Choose the
form with `--format toon|jsonl|human` before `explore` (an explicit `--format` always
wins; every other command keeps its default). `--format jsonl` prints the canonical JSON
record (always with the full `source` and `completeness`), which also carries the stored relationship keys and every reference's bundle. A source that cannot be read (a
missing `--target`, a missing `depends_on` bundle) answers `source_unreadable` with the
cause and the flag to fix it; it is not retried. Dependencies are looked up as
`<fixtures-root>/<bundle_id>/manifest.toml`.

`sk query --json '{"explore":{...}}'` takes the same request as JSON and stays the
form for scripts and MCP; the verbs build exactly that request. Changed files
invalidate cursors. Definitions and placed instances are separate collections, and
descriptive matches require explicit selection before placement. Live exploration
reads through the caller-scoped reader and never falls back to a publisher read; this
file path does not certify installed/hosted placement, live privacy or calibrated
journey cost. Exit codes are interim: `error_class` in the answer is authoritative.

A bare `sk` is a successful quick-start screen rather than a usage error. It
starts with `docs onramp` and the topic-bundled `docs` index, then points humans
at `inspect`, `validate`, `list`, and the full help without front-loading every
global option. It also makes the output contract explicit: `--format human` for
readable terminal output, `--format jsonl` for agents and scripts (`--format toon` for
the compact text form), and automatic
TTY/pipe detection when neither is selected. Before the commands, a local-only
current-context summary shows the author workspace, configured local target and
default bundle used for writes, the source of each setting, plus any connected
PLAYER session; it never creates a connection merely to render the quick start.
Project-local `.spellkave/config.toml` is **gitignored** (personal target/
workspace). Copy `.spellkave/config.example.toml` or set values globally under
XDG (`sk config set --global …`). Without either, pass an explicit manifest
path or configure a target before path-less `map-inspect` / `inspect`.

`docs` declares its exact-doc parameter as a registry-owned positional
affordance, so these are equivalent:

```bash
sk docs onramp
sk docs --doc onramp
```

The bare `sk docs` index is grouped from general to specific—Start here, Guides,
Reference, Troubleshooting, Worked examples—and alphabetical within each topic.
It ends with copyable examples for exact lookup and free-text search.

## Invocation

```bash
sk [global options] <tool> [--flag value ...]
sk [global options] <tool> --json '{"param": "value"}'
sk <file command> <manifest.toml> [...]
sk explain role dm             authored role capabilities and bundle contributions
sk explain capability frontier.pace_time --target live
sk explain extent-kind place_graph --human
sk eval <expr> [--kind predicate|int|text] [--facts <json>] [--dice <faces...>]
sk session list                session-daemon inventory
sk session stop [--all | <hash-or-socket>]   stop one or every session daemon
sk events --drain              drain pending world-push events for this binding
sk config show                effective defaults and their sources
sk config path                project and global config locations
sk config set --project <key> <value>
sk config unset --project <key>     (or --global) drop a value; the next layer applies
sk config get-contexts        profiles to author against; marks this worktree's current one
sk config use-context <name>  select the world --live (and later diff/apply) uses here
sk config current-context     the selected context, or none
sk config view                the world connection the author path uses now, and why
sk skill path                  print the absolute path to this package's SKILL.md
sk list                        tool registry
sk help [<tool|command>]       this text, or one tool's schema-derived flags
```

Global options (must precede the tool name — see "Global options" below for
the full reference):

```
--format <mode>         auto (TTY human, pipes JSONL), human, jsonl, or toon
--workspace <dir>       scratch bundle dir      [$SPELLKAVE_AUTHOR_WORKSPACE]
--target <dir>          local bundle to resolve refs against and flush into
                                                 [$SPELLKAVE_AUTHOR_LOCAL_TARGET]
--no-target             ignore a configured local target for this invocation
--fixtures-root <dir>   sibling-bundle root for depends_on  [default: parent of --target]
--default-bundle <id>   bundle_id write verbs fall back to  [$SPELLKAVE_AUTHOR_BUNDLE]
--no-default-bundle     require write commands to name their bundle explicitly
--live                  flush against a running node instead of --target
                        (world: --profile > $SPELLKAVE_URL > current context)
--actor <id>            connected identity for PLAYER tools  [$SPELLKAVE_ACTOR]
--profile <name>        persona profile for connections (url/db/actor/token)
```

## Plugins

A plugin adds one command group, `sk <group> …`, from its own workspace
package (ADR-0144 D-3). Plugins are listed statically in this package's
`package.json`; there is no `PATH` scan and no user-installed plugin:

```json
"sk": { "plugins": [{ "package": "@spellkave/sk-dev", "group": "dev" }] }
```

A plugin package default-exports an `SkPlugin` built with
`@spellkave/cli-plugin` (`definePlugin`, `defineGroup`, `defineVerb`). A verb
is a typebox `parameters` schema plus a `run(params, ctx)` function that
returns an exit code — the same shape an author-facing registry tool has, so
flags, validation and help come from the schema exactly as they do for
registry tools. A group may name a child verb as its
`default`; a bare `sk <group>` then runs that verb instead of asking for a
command (`sk spire` lists the workflows). `ctx` carries the output sink, the injected host seam
(filesystem, processes, clock), the effective configuration, and connection
resolution; a verb never calls `process.exit`.

The root is one namespace: a plugin group that collides with a registry tool,
a file command, a core command or another plugin fails every invocation with
exit `1`, naming both owners, before any plugin is imported.

```bash
sk plugin list                 # one record per plugin, with every verb path
sk help <group>                # the group's commands
sk help <group> <verb>         # one verb's schema-derived flags
```

## Configuration

`sk config` (or the explicit `sk config show`) answers “what will this command
use?” by listing every effective value and its source. In a human terminal it
also shows copyable examples for using another bundle once, making it the
project default, changing the global output mode, and locating the config
files. `sk config path` prints the exact files:

- project (optional, gitignored): nearest ancestor `.spellkave/config.toml`
  — see `.spellkave/config.example.toml`;
- global (XDG): `$SPELLKAVE_HOME/config/config.toml`, or
  `${XDG_CONFIG_HOME:-~/.config}/spellkave/config.toml`
  (`sk config path` prints both).

The global file is the existing Spellkave app config used for
`default_profile`; `sk` adds `[author]` and `[output]` tables to that same
contract. Project paths resolve from the project root. Precedence is:

```
flags > environment > project config > global config > built-ins
```

```bash
# Configure Elven Mini once from this checkout's root:
sk config set --project author.target packages/spellkave-adventure-elven-mini/fixtures/adventure.manifest.toml
# srd and dm resolve through the tracked .spellkave/defaults.toml; no mapping needed.

sk explore search --kind place_graphs --limit 20
sk map-inspect --images off
sk map-render --out map.svg
sk config show
```

`author.dependencies.<bundle-id>` maps each `depends_on` ID to its manifest,
including transitive dependencies. The tracked `.spellkave/defaults.toml` supplies
this checkout's `srd` and `dm` mappings as the lowest layer (below global and
project config; `author.dependencies` only, repository-relative paths). Local registry reads (`query`, `explore`,
`map_graph`) use these mappings before the conventional
`<fixtures-root>/<bundle-id>/manifest.toml` layout. An explicit global
`--fixtures-root` flag overrides configured mappings for that invocation;
when mappings are present, a one-line stderr warning makes that override explicit.
File commands such as `validate` still take explicit `--dep` inputs;
`map-inspect` and `map-render` draw the target's include closure.

Project target and dependency paths resolve from the project root, including from
a subdirectory. Global dependency paths resolve from the global config file's
directory. A relative global `author.target` instead resolves from the invocation's
working directory; use an absolute global target to keep it stable across directories.
Literal `~`-prefixed dependency paths are rejected; use an absolute path or the
appropriate project/config-relative path. Project mappings
override global mappings per bundle ID, retaining other global mappings.
`sk config show` lists each effective mapping and its source.

```bash
sk config set --global output.format auto
sk config unset --project author.dependencies.srd  # reveal the global mapping, if any
sk config path
```

`set` requires an explicit scope and preserves unrelated settings. Choose project
configuration for checkout-specific manifests and global defaults for shared local
installations. The configured target is explicit configuration, with no
last-authored-bundle state. An explicit `--live` overrides a configured target;
passing both `--live` and `--target` as flags remains an error. Connection profiles
(`--profile`, `sk config use-context`) continue to select live worlds; local
dependency mappings do not change credentials or live authority.

The configure-once promises run against the real CLI in
[`configured-world.feature`](behaviour/exploration/configured-world.feature).

## Two halves: AUTHOR (registry tools that edit content) and PLAYER (registry tools that act in-world)

`sk`'s command surface splits along the same line the underlying registry
does:

- **AUTHOR tools** (`authorFacingToolDefinitions`) edit a world's *content* —
  place entities and actors, define capabilities and affordances, write
  typed rows, query the manifest schema, evaluate DSL expressions offline (`sk eval`). Every AUTHOR tool except the
  connected ones (`spellkave_apply_manifest_delta`, `spellkave_export`) runs
  **offline**, against a scratch workspace (`--workspace`, default
  `.local/sk-author-scratch`) with no connection at all.
  `spellkave_apply_manifest_delta` needs somewhere to *flush* an authored
  delta — see "AUTHOR flush destinations" below; `spellkave_export` reads a
  live world.
- **PLAYER tools** (`playerFacingToolDefinitions`) perceive and act *as* one
  connected actor — see the scene, check inventory, take an affordance
  action, react to something, end a turn. Every PLAYER tool is **always
  connected**: there is no offline PLAYER mode, because subscribe-on-connect
  is what makes an unbuilt affordance palette look like "the world hasn't
  built this yet" instead of silently looking like a blocked gate. See
  "PLAYER: the connected session daemon" below.

`sk help` marks unavailable tools (in either half) with a leading `!` and
names the missing piece; `sk --format jsonl list` carries the same `available`/
`reason` fields per tool, so a script can check availability without
attempting a call first.

Beyond the registry, `sk` also exposes **file commands** — `sk validate`,
`sk lint`, `sk patch`, `sk render`, `sk inspect`, `sk map-inspect`,
`sk map-render`, `sk delta inspect` — which take a manifest **path** and resolve
`[[include]]`/`depends_on` off disk, something no registry tool does (the
registry has no opinion on where content lives; a file command does, because
it needs to). File commands are a distinct third group from AUTHOR/PLAYER
registry tools, never a registry tool name shadowed: `sk` resolves a file
command **before** a registry tool of the same name, and refuses to ship a
file command whose name collides with one (`src/__tests__/file-commands.test.ts`).
`sk skill path` is the file-command group's packaged documentation lookup.

`sk seed <root>...` is the one file command that connects: it reads manifest
roots off disk like its siblings, then loads them into a running world over
the websocket connection (the HTTP call route refuses a large ruleset
manifest). See [Seed a running world](docs/seed.md) for the command sequence,
exit codes and the current world API epoch gap.

Before committing a content delta, run
`sk delta inspect <delta.toml> --against <dependency-roots...>`. Roots accept
manifest files or directories containing `manifest.toml`. The offline report
includes bundle validation, potential preservation-sensitive rows, git tracking,
unkeyed subset-regression kinds and census recapture guidance. Roots describe
authored context; they cannot establish live player progress or seat ownership.
See [the delta preflight reference](../../.agents/skills/sk-author/references/delta-preflight.md)
and `sk help delta` for exit codes and the JSONL contract.

## Offline rule evaluation bench: `sk eval`

`sk eval` (projected from the AUTHOR tool `spellkave_eval`) runs the production
DSL evaluator offline against author-supplied facts and predetermined dice,
without a running node or database connection:

```bash
sk eval "1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')" \
  --kind predicate \
  --facts '{"actor":{"stat":{"demo/bonus":3}},"target":{"stat":{"demo/threshold":15}}}' \
  --dice 12
```

- **Exit codes:** `0` on successful evaluation (predicates returning `true` or `false` both exit `0`), `2` on in-world rejection (missing facts, exhausted dice, bounds exceeded), and `1` on invalid arguments.
- **Trace inspection:** `--format human` renders a tabular AST trace showing child-first completion order, node IDs, intermediate values, stochastic draws, and highlighted failure points.
- **Full guide:** See `sk docs rule-bench` (`packages/spellkave-world-author/docs/rule-bench.md`).

## Remove a placed entity from author files

`sk --target <root> --workspace <scratch.toml> remove_entity --entity-key demo/torch`
immediately edits the local root and scratch. It removes the entity and its owned
instance rows, including containment, tags, object state, equipment references
and entity metadata. The result reports row counts separately for each file.
Other staged content stays in scratch; this command does not flush it. Clearing
the matching scratch rows prevents a later flush from restoring the removed item.
An absent key is an unchanged success.

The command refuses an include-owned entity or reference and names its fragment;
edit that fragment explicitly. It also refuses surviving rows that place another entity inside the removed
entity, assign ownership to it, or otherwise reference it. Remove its contents or
revise those references first. A refusal leaves both files unchanged. Persistence
failures attempt to restore the original bytes and report any restoration error.
[Local adapter regression tests](../spellkave-tool-node/src/__tests__/remove-entity.test.ts)
cover both write-failure paths.

This command requires a local target and sends nothing to the world. For a root
with applyset memory, inspect the proposed retraction with
`sk apply -k <root> --prune --dry-run`, then use
`sk apply -k <root> --prune` when the report is acceptable. World-added rows and
other prune admission rules still apply. The captured
[applyset guide](docs/applyset-guide.md) proves the file edit and dry-run plan.

## AUTHOR flush destinations

`spellkave_apply_manifest_delta` needs a place to commit an authored delta.
Exactly one of two mutually exclusive destinations:

- **`--target <dir>`** — a local bundle directory (a `manifest.toml` plus
  its `[[include]]` fragments). The delta merges into the root file;
  nothing leaves the local filesystem. An unchanged row already owned by
  an include stays there. A changed row whose natural key belongs to an include is refused with its
  fragment path; edit that file and validate the bundle before applying.
  Refusal leaves both the root and fragments unchanged. The
  [session regression tests](../spellkave-session/src/player-tools/__tests__/author-target.test.ts)
  prove this ownership rule across both files.
- **`--live`** — a one-shot SDK connection, opened for this one `sk`
  invocation and closed once the tool's result is in hand. `sk` never holds
  a session across calls this way — that is what `--profile`'s
  bare-invocation fallback and the PLAYER session daemon are for.

`--live`'s own connection ladder, the **author path** (independent of
PLAYER's, see below):

1. `--profile <name>`, if given, supplies `url`/`db`/token outright — the
   same "explicit flag beats ambient env" precedence PLAYER's binding
   resolution uses.
2. Otherwise, the plain env chain: `$SPELLKAVE_URL` and `$SPELLKAVE_DB`
   (default `spellkave-dev`). The `just` recipes export these through
   `scripts/dev/node-env.sh`, so they keep their target.
3. Otherwise, the **current context**: the profile this worktree selected
   with `sk config use-context <name>` (or that `sk dev up` selected for the
   worktree's local node). It is announced on stderr
   (`sk: using context 'staging' (--live)`).
4. Nothing resolvable — a usage error naming `--profile`,
   `sk config use-context` and the environment variables.

When the environment and the current context name different worlds, the
environment wins and `sk` prints **one** warning on stderr naming both
(`sk: environment wins over context 'staging' (...)`); `sk config view`
shows the same decision without connecting. A current context that names a
deleted profile is an error, unless the environment already supplies the
target, in which case it is only reported.

The current context is per git worktree
(`$SPELLKAVE_HOME/state/current_context/by_worktree/<hash>`), separate from
`last_used_profile` on purpose: `--profile` and `play-stage` move the
last-used pointer, and an apply target must not move with them. There is
**no `last_used_profile` fallback on the author path**. An AUTHOR flush's
identity is fixed (`sk-live-author`) regardless of which profile supplied the
connection.

Token precedence for `--live` when the environment supplies the connection,
or when a `sk dev up` local-node profile (see "Persona profiles") carries no
credential: an explicit `$SPELLKAVE_CONNECT_TOKEN`, then the credential file
the Rust `spellkave` client's own `manifest apply` persisted for this
`(url, db)` pair, then `$SPACETIME_CONFIG_PATH`'s token. `undefined` falls
through to an anonymous connection. Any other profile resolves its own
credential reference.

## Ask the world: `sk can-i`

`sk can-i <action> --as <body> --target <target>` asks whether that body may
perform the action now, and which check decides. It connects on its own.
An answered question exits 0, including a refusal. `--expect refused` exits
2 when the answer differs. No reachable world exits 1. See
`packages/spellkave-world-author/docs/can-i.md`.

## Read authored instances: `sk get` / `sk describe`

`sk get <kind> [<key>]` and `sk describe entities <key>` read placed instance
rows from the publisher `sk` session (the same connection `diff`/`apply`/`can-i`
open). They connect on the author path — current context, env, or `--profile`;
no `--live`, no `r_export_manifest`, no second `ownerTables`. The eight kinds
are `entities`, `actors`, `actor_spatial_locations`, `actor_capabilities`,
`actor_equipment_slots`, `entity_containment`, `entity_tag`, `object_state`.
Answers carry session `world_time` as `tick` and the label `authored_entities_only`.
Keys are the authored `entity_key` (MAE `{bundle}:` prefix stripped), not
`manifestKey`. `--bundle` disambiguates when the same stripped key exists in
two bundles.

A listing or row exits 0 (including an empty listing). Not the publisher, an
unknown authored key, or a bundle clash exits 2. Usage (wrong kind, `describe`
of anything but `entities`) or an unreachable world exits 1. `sk query --kind
entities` without `--live` still does not connect — that path is workspace/
target catalog, not the owner cache.

Do not use `just sql` or the observability CLI for these instance facts; `sk
get` / `sk describe` are the publisher read. The loft chest (`elven_mini/adventure/item/loft_chest_1`)
is the worked containment example: describe the chest for belonging by authored
key; after pickup, describe the potion for the hero body and place.

## Applyset diff and apply: `sk diff -k` / `sk apply -k`

`sk diff -k <dir>` and `sk apply -k <dir>` compare a root manifest and its
includes with what the world remembers applying from that root (the
**applyset memory**, ADR-0145), the way `kubectl diff -k` / `kubectl apply -k`
compare a kustomization with the cluster. They are projections of the
registry tools `spellkave_applyset_diff` and `spellkave_applyset_apply`, so a
Pi or chat author gets the same result through the tools. Both connect on
their own (no `--live` needed) through the author path above. `<dir>` is the
directory holding `manifest.toml` or the root file itself; the root must name
its applyset (`applyset = "<name>"`). Plain `sk diff <left> <right>` is still
the offline two-file diff.

Every row of the root and its includes is classified by the Rust manifest
core, with the same row identity and hash the server records:

| Class | Meaning |
|---|---|
| `create` | absent from memory and a complete readable live observation: applied for the first time |
| `adopt` | absent from memory, already live: records ownership and comparable hashes without an upsert |
| `configure` | in the memory with another hash: its content changed (also when it moved to another file) |
| `move` | same content, another file: only the memory changes |
| `prune` | in the memory, in no file any more: a candidate to retract |
| `unchanged` | same content in the same file |

The three-way rules follow kubectl client-side apply:

- **Files against memory decide.** Rows the world holds but this applyset
  never applied (for example a row added through `sk --live`) are not
  retracted by the builder, also with `--prune`; where the export can read
  their bundle they are listed as `live_only` information. Retracting an
  entity still removes world-added rows on that entity through ADR-0085 D-6's
  closure (ADR-0145 postscript of 2026-09-30).
- **A first apply adopts existing rows.** Readable live rows absent from this
  applyset's memory are `adopt`; rows absent from the readable export are
  `create`. The `MF-APPLYSET-ADOPT` warning explains the initial memory seal.
  Live-only rows absent from the files remain outside this applyset.
- **Observed conflicts require a decision.** The display separates file changes,
  world-added rows on pruned entities when previewing with `--prune`, and **authored, changed in the world since the last apply**. A configured row conflicts when its comparable live hash differs
  from the hash recorded at the last seal. Adoption compares live values with
  the files. `sk diff -k` exits `3` when differences exist; `sk apply -k`
  refuses conflicts before sending, exits `2`, and preserves memory. `--force`
  sends the conflicting file rows and records the new comparable baseline.
  An unchanged drifting row stays informational and is not sent.
- **Unavailable observations are explicit.** `not_checked` reports the reason:
  publisher-only export, an unexported bundle (`core` or the 8,000-row guard),
  a kind the export does not round-trip, unread live place, or no recorded
  comparable hash. These do not assert that the world is unchanged. Entity
  comparisons restore declared/live placement and normalize the exported
  definition surrogate; unsupported fields stay outside comparison.
- **Baseline access requires the exact publisher.** Shared `sk diff -k` and
  `sk apply -k` return `baseline_unavailable` for other callers before baseline
  subscription or enqueue, including with `--force`, until regional baseline
  delivery (.160). The publisher reads roots, parts and hashes in one required
  operator-view subscription. Missing secure views return `reader_unavailable`;
  cold clients have no raw-table or optional-hash fallback.
- **Duplicates warn**: when several files carry the same row, the last one
  in include order wins (`MF-APPLYSET-DUPLICATE`).
- **A split frame-write set warns too**: a `consequence_frame_writes`
  template whose blocks are spread across more than one file is not a
  duplicate — it is one row correctly assembled from every part, hashed over
  all of its blocks in `ordinal` order — but `sk diff -k`/`sk apply -k` still
  name every part holding a block (`MF-APPLYSET-SPLIT-SET`) so the author
  knows the template is not confined to one file.

Scoped get/describe retains the eight kinds in [reading a world](../spellkave-world-author/docs/reading-a-world.md).
Binding-only direct deltas retain their separate admission lane. Publisher
comparison and server admission remain optimistic against later changes.

`sk diff -k <dir> [--prune] [--dep <manifest>]...` sends nothing. With
`--prune` it also inspects every entity candidate and reports
`world_added_rows` under each affected entity, with `taken` and
`left_behind` lists. Differences exit `3`, including when world-added
rows would require a forced apply. An unreadable candidate exits `2`
with a cannot-look reason; entity-content inspection requires publisher
closure. The live scenario “Preview the world-added rows on every entity a
prune would remove” in
[the applyset evidence](docs/applyset-scenarios.md) checks the preview and
unchanged items, states and applyset memory.

`sk apply -k <dir> [--prune] [--dry-run] [--force] [--dep <manifest>]...`
sends only the `create` and `configure` rows (and, with `--prune`,
retractions for the `prune` rows) in **one** `r_apply_bundle` call, together
with the changed part lists and the generation it read, and waits for the
seal. An authored entity retracts by its recorded `bundle_id:entity_key` and
stands for its authored containment, state, resource-bound, equipment
(the wearer side; pruning an equipped item and its slot row while the wearer stays is refused),
actor, position, identity, and capability rows; those rows are reported as
`pruned` but carry no separate retraction (tag rows stay). A containment row
the files replace with another containment for the same contained entity needs
no retraction. A move-only change sends an empty
delta with the changed parts; nothing changed sends nothing. Each row is
reported as `created`, `adopted`, `configured`, `moved` or `pruned`; prune candidates
without `--prune` stay on the world and
are named with a `--prune` hint. `--dry-run` reports planned row changes
without sending; use `sk diff -k --prune` to inspect entity contents. `--force`
grants the following decisions in the same call. `force_used` is a list
of the decisions actually used (`root_takeover`, `world_added_rows`,
`world_changed`), omitted when none was needed:

1. **Observed world changes:** the file values win for configured or adopted
   rows listed as conflicts; the seal records their comparable hashes.

2. **Root-path takeover** (ADR-0145 D-1/D-4): this root takes over an
   applyset name the world records under another root path (a moved root).
   The world still refuses that without `--force` (`MF-APPLY-031`).
3. **World-added rows on a retracted entity** (change
   `applyset-prune-placed-entities` D-8): before `r_apply_bundle`, a prune
   that retracts an entity reads the owner-subscription rows on that entity
   and subtracts the expected set (memory rows that name it, definition
   seeds, and the place/position reconstructed from the unmasked live export
   plus the live `place_node_id`, hashing against the applyset memory hash;
   the export's `entity_def_id` surrogate `manifest_key(bundle_id, entity_key)`
   is hashed again with `""`). `$sender` in an identity key is the applying
   publisher. Extra live rows are listed as `world_added_rows: { taken,
   left_behind }` under the pruned entity (`taken` go with the closure;
   `left_behind` are conditions and occupants the closure does not delete).
   The live row "lists a world-applied condition as left behind and leaves
   the residue" in `src/__tests__/applyset-prune.live.test.ts` proves the
   condition listing and its persistence after the entity is gone. A publisher entity prune when those
   rows cannot be read is refused unless `--force` (proof:
   `packages/spellkave-tool-authoring/src/__tests__/applyset-tools.test.ts`,
   "refuses cannot look when worldRows is missing" and "when authoredEntityId
   is missing"). Container-side containment is a **multiset** keyed by the
   contained definition (or authored key), counted with seed `quantity`.
   D-8 **connection × `--force`** table:

| Connection | World-added rows | Without `--force` | With `--force` |
|---|---|---|---|
| publisher | none | sends, exit `0` | same |
| publisher | some | refuses, exit `2`, lists them, names `--force` | sends; reports each row under its heading |
| non-publisher | baseline unavailable until .160 | refuses with `baseline_unavailable`, exit `2` | same refusal |
| publisher, cache without the owner tables or the five `initial_*` tables | cannot look | same | sends |

D-8 **expected-set** table (Raw table / Expected from / World-added when):

| Raw table | Expected from | World-added when |
|---|---|---|
| `entity_location` | the `entities` row's `place_node_id` (none when a containment row places it) | the world's place differs or exists where none is expected |
| `entity_containment`, content side | the memory containment row; `entity_definition_initial_containment` of its container's definition | another container holds it |
| `entity_containment`, container side | memory containment rows naming it as container; its definition's `initial_containment` (multiset by contained def, counted with seed `quantity`) | another entity is inside it |
| `object_state` | memory `object_state` rows; its definition's `initial_state` | a state id neither names |
| `capability` | memory capability rows; its definition's `initial_capability` | a capability id neither names |
| `actor_identity` | memory `actor_identities` rows (`$sender` = applying publisher) | another identity is bound |
| `actor_spatial_location` | memory `actor_spatial_locations` row (none when the files never named one) | the position differs or exists where none is expected |
| `entity_equipment_slot`, wearer side | memory slot rows of the wearer; its definition's `initial_equipment` | a slot neither names |
| `entity_equipment_slot`, item side | a memory `actor_equipment_slots` identity `(wearer, slot)` — the memory key does not carry the item | another wearer holds it. A swap of the item inside an authored slot is not seen on the slot row; it is seen on the content side only when the item moved to another wearer. A swap between items the same wearer already contains is not seen (bead `sk-jay0.7.186.5.13`) |
| `target_condition` | its definition's `initial_condition` | a condition id it does not seed |

`--dep` loads a dependency root for
validation only; its rows are never sent. Without any `--dep`, `sk diff -k`
and `sk apply -k` load the root's `depends_on` closure from the configured
`author.dependencies` (`sk config`), as the `--target` verbs do. When the map
cannot resolve that closure, the argv stays as given.

Before sending, `sk apply` refuses with exit `2` when `spellkave-validate`
rejects the built root plus the built retractions (a retraction of a kind
the server cannot retract comes back as `MF-VAL-293`), or when an
instance row is pruned without the entity that owns it (the diagnostic says it
can be removed only together with its entity), or when `--prune` meets an
applyset whose base is unknown (`MF-APPLYSET-PRUNE-UNKNOWN`), or when a prune
that retracts an entity has world-added rows (or cannot look) and `--force`
was not passed (D-8 table above). Every
manifest row kind with a registered identity now has a matching server-side
upsert, so there is no longer a class of "kind has no upsert yet" pre-send
refusal (the former `MF-APPLY-021`/`DELTA_INSERT_ONLY_ROW_KINDS` and
`MF-APPLYSET-NOT-UPDATABLE`/`DELTA_NOT_UPDATABLE`, closed out by
manifest-natural-keys tasks 3.3, 4.1 and sk-jay0.7.174.23). The world's
entity closure still leaves tag rows, definition-seeded conditions, and
spawned child entities behind; that server-side cleanup is tracked separately.
A remaining row that names a removed entity is not refused until bead
`sk-jay0.7.186.5.1` lands. A metadata attachment, autonomy job, or edge
affordance that names a removed entity also stays: those kinds have no
retraction (`MF-VAL-293`) and the world's closure does not remove them
(change `applyset-prune-placed-entities` D-6, bead `sk-jay0.7.186.5.9`).
The world itself refuses a stale generation (`MF-APPLY-030`: another apply landed
after this one read the memory — diff again), another root owning the name without `--force`
(`MF-APPLY-031`), an apply still draining (`MF-APPLY-013`), or a world that
does not grant the author `frontier.apply_manifest` — all exit `2`.

`SK_EXTERNAL_DIFF` runs a program of your choice instead of the built-in
unified diff, like `KUBECTL_EXTERNAL_DIFF`: the live and file values are
written as JSON into two temporary directories (`LIVE`, `FILES`) and the
program gets them as its last two arguments (`SK_EXTERNAL_DIFF="diff -ru"`,
`SK_EXTERNAL_DIFF=meld`).

Limits, stated plainly:

- **Untrackable rows are not compared or sent.** A kind with no registered
  row identity is counted per kind (`MF-APPLYSET-UNTRACKABLE`); an edit to
  such a row does not show up in `sk diff`. Today every authored row kind has
  an identity, including `entity_definition_initial_state` and the set-level
  `consequence_frame_writes` (`crates/spellkave-schema/src/row_identity.rs`).
- **No previous content is stored.** The memory keeps hashes only, so a
  `configure` row the export cannot read shows no content diff; `sk diff`
  names its file for `git diff`.
- **A `configure` upsert writes the whole authored row.** It may reset
  play-time state the export snapshots as authored: the live placement of a
  moved entity, or `object_state` values such as HP or charges (ADR-0086
  Postscript 2026-08-18). This is a known, parked risk.
- **The root path is relative to the git worktree**, as `sk dev seed`
  records it; run both against the same checkout layout.

## PLAYER: the connected session daemon

Every PLAYER tool call dispatches through a **binding-keyed background
daemon** (`@spellkave/session`), not a connection `sk` itself holds:

1. `sk` resolves the `(url, db, identity, actor)` binding this invocation
   needs (see "Connection resolution" below).
2. `sk` calls `ensureDaemon(binding)`: attach to the ONE daemon already
   listening for that exact binding, or spawn one if none is. A stale
   socket file (a crashed daemon's leftover) is detected and unlinked
   before respawning.
3. `sk` sends one `invoke` frame over the daemon's unix socket, reads the
   one response frame, and disconnects. The **daemon** keeps the live
   SpacetimeDB session open — `sk` itself never does, so a shell script
   calling `sk scene`, then `sk move ...`, then `sk scene` again reuses
   one live session across three separate `sk` invocations instead of
   reconnecting each time. The daemon also holds **one** ADR-0093
   `WorldEventBuilder` for that whole lifetime (never recreated per
   invoke — finding #98) and piggybacks any pending world-push events
   (hits taken/dealt, XP gained, turn transitions, speech heard) on the
   invoke response. `sk` prints each as its own JSONL line (`kind: "push"`)
   after the `tool_result`.

The daemon persists past the `sk` invocation that spawned it: an idle
timeout (10 minutes by default) shuts it down when nothing has dispatched
through it for that long, or `sk session stop` shuts it down explicitly.

`identity` in the binding is a **SHA-256 hash of the resolved token**, never
the raw token — the daemon echoes its own binding verbatim in `hello`/
`status` responses, so the binding itself must stay safe to hand back over
the socket.

### `sk session list` / `sk session stop` / `sk events --drain`

```bash
sk session list                     # one record per known socket
sk session stop                     # stop the daemon THIS invocation's binding resolves to
sk session stop <hash>              # stop the daemon named by sk session list's own `hash` field
sk session stop --all               # stop every daemon this host knows about
sk events --drain                   # drain pending world-push events without running a PLAYER tool
```

`sk session list` connect-probes every socket under the daemon runtime
directory (`$XDG_RUNTIME_DIR/spellkave/`, or `~/.spellkave/run/` when
`XDG_RUNTIME_DIR` is unset) and reports a `status` frame for each live one —
including `observability.mode`, so ambient observability config is visible
without inspecting environment variables (see "Observability" below). A
socket file with nobody listening reports `status: "stale"` rather than
erroring; that is a reportable state, not a failure.

`sk session stop` with no selector stops the ONE daemon the **current**
global options (`--actor`/`--profile`/the env chain) would themselves
attach to — so `sk --actor hero-1 session stop` stops exactly the daemon
`sk --actor hero-1 scene` would have used.

## Connection resolution: `--profile`, the env chain, and last-used fallback

Every PLAYER tool needs a `url`/`db`/`actor`/token. (`--live` on the
AUTHOR side has its own ladder with the current context instead of the
last-used profile — see "AUTHOR flush destinations" above.) `sk` resolves
PLAYER connections in this order:

1. **Explicit flags** — `--actor <id>` for PLAYER's actor field (checked
   independently of `--profile`, so the two can be mixed: `--profile kira
   --actor scout-2` uses `kira`'s connection with a different actor).
2. **`--profile <name>`** — resolves `url`/`db`/`actor`/token through
   `@spellkave/sdk`'s shared persona-profile chain (`loadProfileFromDisk` /
   `resolveConnection` / `CredentialRef`) — the SAME file-format contract
   the pi-hosted Spellkave extension and the installed Rust `spellkave`
   client both consume (each has its own implementation; the profile
   **file format** is the shared artifact, never shared code).
3. **The plain env chain** — `$SPELLKAVE_URL` / `$SPELLKAVE_DB` /
   `$SPELLKAVE_ACTOR`, with no profile-chain filesystem reads at all when
   this alone already resolves everything a call needs (so a script that
   sets these three has zero profile-related I/O in its way).
4. **The remembered `last_used_profile`** — a bare invocation with neither
   an explicit `--profile` nor a resolvable env chain falls back to
   whichever profile was last successfully used, **announced on stderr**
   (`sk: using profile 'kira' (last used)`) so ambient state is never
   silent. A script that must not depend on machine state should pass
   `--profile`/the env vars explicitly instead of relying on this fallback.
5. **Nothing resolvable** — a loud usage error naming every remedy,
   `--profile` included.

A successful, **explicitly-named** `--profile` becomes the new
`last_used_profile` afterward (a convenience-state write; failure to write
it is never fatal to the tool call that triggered it).

### Persona profiles

A persona profile is one TOML file, `profiles/<name>.toml`, under the
Spellkave XDG config root (`$SPELLKAVE_HOME/config`, or
`${XDG_CONFIG_HOME:-~/.config}/spellkave` when `SPELLKAVE_HOME` is unset):

```toml
[connection]
url = "https://maincloud.spacetimedb.com"
db = "my-world"

[identity]
role = "player"
in_world_self = "scout-01"       # the exact durable actor identifier

[identity.credential]            # omit entirely to use the `spacetime login` token
kind = "env_var"                 # "env_var" | "file" | "inline"
name = "SPELLKAVE_TOKEN"
```

`sk dev up` writes one more kind of profile: `local-<worktree>-<hash>`, the
worktree directory name plus six hex digits of the same worktree hash that
scopes the pointers, naming this worktree's node on a loopback URL. It
carries no credential. When the profile name, URL and database match the
current worktree's node, author commands discover its SpacetimeDB CLI token
from the node configuration; no environment setup or token copy is needed.
An explicit profile credential, `SPELLKAVE_CONNECT_TOKEN`, or
`SPACETIME_CONFIG_PATH` takes precedence over this discovery. An existing node
configuration without a usable token is refused with a recovery command.
Other profiles cannot borrow this worktree's node configuration: local-named
loopback profiles retain the existing client-credential lookup, and other
profiles without a credential use the `spacetime login` rule above.

`identity.in_world_self` is passed to PLAYER tools **unchanged** as the
actor id; if no live actor row matches it, the tool fails closed rather than
guessing. `sk` never accepts a raw credential value as a CLI flag — only a
credential *reference*.

## Output contract

Every result starts as one structured record tagged with a snake_case `kind`
(`tool_result`, `tool_list`, `error`, `session`, `skill_path`,
`validate_result`, ...). `--format` controls only how that record is
presented:

| Mode | Behavior |
|---|---|
| `auto` (default) | human Markdown for an interactive stdout TTY; canonical JSONL otherwise |
| `human` | terminal-width-aware Markdown tables and sections, regardless of TTY detection |
| `jsonl` | one canonical JSON object per line, regardless of TTY detection |
| `toon` | one [TOON](https://toonformat.dev) document per record (blank line between), regardless of TTY detection; a generic record-to-text encoding, no command-specific rules |

A command may name a preferred format; it applies only while the mode is `auto`, on a TTY and
a pipe alike, and an explicit `--format` (or a configured `output.format`) always wins.
`sk explore` prefers `toon`; every other command keeps the `auto` default above. A command
that wants a tailored TOON shape builds it before the record reaches the sink (`sk explore`:
`src/explore-toon.ts`).

The human projection is generic: flat record collections become tables,
nested values become sections, and no tool name selects presentation code.
Record kinds become headings instead of data cells, standard errors read as
errors instead of tables, and large collections keep only common scalar
columns in their overview. Large numeric count maps omit zero-valued entries
and report how many were hidden. Any summarized fields are named together with
the `--format jsonl` escape hatch. When a `tool_result.text` field is only a
JSON copy of `details`, both modes drop it: human mode shows the record once,
and a JSONL line carries `details` alone (the duplicate cost a machine reader
every payload twice — 89 KB instead of 31 KB for one `spellkave_orient`
record). `text` stays on the line whenever it says something `details` does
not (prose, a rendered map hint).

Navigation-oriented command inventories (`sk list` and the command groups in
`sk help`) are alphabetical within their AUTHOR, PLAYER, and file-command
groups. Result data keeps its authored or runtime order.

Scripts can rely on redirection selecting JSONL automatically:

```bash
sk list | jq '.tools[] | .name'
sk --format jsonl list          # explicit when stdout may be a TTY
sk --format human list          # explicit for captured human-readable output
```

Usage, one-tool help, and "using profile X" announcements remain on
**stderr**. `sk ... | head` closing the pipe early is ordinary usage and never
a crash.

### Spatial graph (map) presentation

`sk map-inspect` and `sk map-render` share one SVG spatial-graph view built from
place-graph rows (the same model the registry tool `spellkave_map_graph` uses):

- **`sk map-inspect`** — human mode draws the SVG as an **inline terminal image**
  when Kitty/iTerm2 graphics are available (`@earendil-works/pi-tui`); otherwise
  it prints a plain node/edge inventory. JSONL keeps the structured summary
  (and optional `svg` / `inventory` fields) without requiring image decoding.
- **`sk map-render`** — with `--out map.svg` writes the SVG/HTML file; **without
  `--out`**, human mode paints the same picture inline in the terminal.
  Optional `--graph <place_graph_id>` filters one graph.
- **`sk map_graph`** / **`spellkave_map_graph`** — AUTHOR registry tool that
  sources rows only via the existing `spellkave_query` resolution path
  (workspace / local target / live) and returns SVG + inventory; human `sk`
  also paints that SVG inline.

**Terminal image backends** (human mode, no `--out`):

| `--images` | Backend | Best for |
|---|---|---|
| `auto` | Kitty if capable, else `timg -p q` | default |
| `kitty` / `iterm2` | graphics protocol via pi-tui | local Ghostty/Kitty |
| `quarter` / `half` | **timg** unicode blocks | **herdr --remote**, SSH |
| `sixel` | timg sixel | sixel terminals |
| `timg` | alias for `quarter` | same |
| `off` | text inventory only | pipes/CI |

```bash
brew install timg   # once

# Remote-friendly (recommended over herdr --remote):
sk --format human map-render --graph region --images quarter
sk --format human map-render --graph region --images half

# Local Kitty graphics:
sk --format human map-render --graph region --images kitty
export SPELLKAVE_TERMINAL_IMAGES=quarter   # durable default
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | usage or infrastructure error — bad flags, unresolvable connection, a tool that *threw* |
| `2` | in-world rejection — a tool that ran correctly and reported `ok: false` (an invalid manifest, a refused delta, a validator diagnostic) |
| `3` | `sk lint --strict`: root-bundle findings present (lint itself always exits `0` without `--strict`); `sk diff -k` (and `sk apply -k --dry-run`): differences found. Unlike `kubectl diff`, which exits `1` on differences, `1` stays usage/infrastructure here |

A tool that **throws** is infrastructure (`1`), never an in-world rejection
— the registry's own contract is "throw on failure instead of encoding
errors in the result," so a thrown error always means something outside the
world went wrong.

## Global options reference

| Flag | Env fallback | Meaning |
|---|---|---|
| `--format <auto\|human\|jsonl\|toon>` | — | result presentation; default `auto` uses human output only for an interactive stdout TTY (`sk explore` prefers `toon` while `auto`) |
| `--workspace <dir>` | `$SPELLKAVE_AUTHOR_WORKSPACE` | scratch bundle dir AUTHOR tools author into (default `.local/sk-author-scratch`) |
| `--target <dir>` | `$SPELLKAVE_AUTHOR_LOCAL_TARGET` | local bundle `spellkave_apply_manifest_delta` resolves refs against and flushes into |
| `--fixtures-root <dir>` | — | sibling-bundle root for `depends_on` resolution (default: parent of `--target`) |
| `--default-bundle <id>` | `$SPELLKAVE_AUTHOR_BUNDLE` | `bundle_id` write verbs fall back to when a call doesn't name one |
| `--live` | — | AUTHOR flush destination: a one-shot connection instead of `--target` (mutually exclusive with `--target`); every live `apply_manifest_delta` is journaled under `.local/live-deltas/` |
| `--actor <id>` | `$SPELLKAVE_ACTOR` | PLAYER connected identity |
| `--profile <name>` | — | persona profile name (see "Connection resolution" above) |

## Environment variables reference

| Variable | Used by | Meaning |
|---|---|---|
| `SPELLKAVE_URL` | `--live`, PLAYER | world connection URL — required unless `--profile` (or, for `--live`, the current context) supplies one; beats the current context with a stderr warning |
| `SPELLKAVE_DB` | `--live`, PLAYER | database name (default `spellkave-dev`) |
| `SPELLKAVE_ACTOR` | PLAYER | connected actor id, when not given via `--actor`/`--profile` |
| `SPELLKAVE_CONNECT_TOKEN` | `--live`, PLAYER | explicit connection token override — highest-precedence token source on both connected paths |
| `SPACETIME_CONFIG_PATH` | `--live`, PLAYER | path to a `spacetimedb_token`-carrying TOML file, consulted after the credential-file tier |
| `SPELLKAVE_AUTHOR_WORKSPACE` | AUTHOR | see `--workspace` above |
| `SPELLKAVE_AUTHOR_LOCAL_TARGET` | AUTHOR | see `--target` above |
| `SPELLKAVE_AUTHOR_BUNDLE` | AUTHOR write verbs | see `--default-bundle` above |
| `SPELLKAVE_LIVE_DELTA_JOURNAL` | `--live apply_manifest_delta` | `0` switches the delta journal off (default on: the applied TOML as `.local/live-deltas/NNN-<utc>.toml` plus a line in `journal.jsonl`, failures included) |
| `SPELLKAVE_LIVE_DELTA_JOURNAL_DIR` | `--live apply_manifest_delta` | journal directory (default `.local/live-deltas` under the cwd) |
| `SK_EXTERNAL_DIFF` | `sk diff -k` | program run on two directories of live and file row values instead of the built-in unified diff (like `KUBECTL_EXTERNAL_DIFF`) |
| `SPELLKAVE_HOME` | profiles, session runtime state | overrides the whole XDG root (`$SPELLKAVE_HOME/{config,state,cache}`) instead of the platform default |
| `SPELLKAVE_RUN_EVENTS` | PLAYER (session daemon) | `off\|jsonl\|otlp\|jsonl+otlp` — observability master switch, default `jsonl`; captured at daemon **spawn** time, so changing it needs `sk session stop` + the next call respawning |
| `SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT` | PLAYER (session daemon), `otlp`/`jsonl+otlp` modes | OTLP logs endpoint for run-event export |
| `SPELLKAVE_SESSION_IDLE_TIMEOUT_MS` | PLAYER (session daemon) | override the daemon's idle-shutdown timeout (default 10 minutes); read at daemon **spawn** time from whatever is exported when `sk` first spawns it |
| `CAMPAIGN_ARTIFACTS_ROOT` | PLAYER (session daemon) | when set, JSONL run-events land under `<root>/experiments/sk-daemon/runs/<run-id>/agent-run-events.jsonl` instead of the daemon's own runtime dir |
| `XDG_RUNTIME_DIR` | PLAYER (session daemon) | session-daemon socket/log runtime root (`$XDG_RUNTIME_DIR/spellkave/`); falls back to `~/.spellkave/run/` when unset |

## Observability

The PLAYER session daemon emits `agent-run-events/v1` events for its own
lifetime — one run per daemon session (spawn through shutdown or idle
timeout), one `tool_call` event per dispatched `invoke` frame — plus
reducer-attempt tracing through the same seam the pi-hosted extension uses.
Controlled entirely by `$SPELLKAVE_RUN_EVENTS` (see the env table above);
`sk session list`'s `status` frame reports the active mode for a running
daemon, so ambient observability configuration is never invisible.

AUTHOR-side `sk` invocations (offline or `--live`) are not actor runs and
emit no run events — the observability surface here is specifically the
PLAYER session daemon's lifetime.

## Tests

Run a script here, or `pnpm --filter @spellkave/cli run <script>` from the
repository root.

| Script | What it checks | Needs |
|---|---|---|
| `test` | the unit tests in `src/__tests__/`; the `*.live.test.ts` files among them skip without a node | nothing |
| `typecheck` | `tsc --noEmit` over `src/`, tests included | nothing |
| `test:portable` | a packed `sk` outside this checkout (see "Portable candidate and evidence") | a packed archive from `pack:portable` |

Which CI step runs each script and each live test file: `sk spire package
@spellkave/cli` and `sk spire check @spellkave/cli test --full` (Spire's check
page shows the same). Every test file starts with a comment that says what it
promises and what it needs to run; when you add one, follow
[`test-headers.md`](../../.agents/skills/sk-tests/references/test-headers.md).

## Inside the Spellkave monorepo

The above is everything `sk` needs regardless of where it runs. The
following is monorepo-local convenience, not part of `sk`'s own contract:

- **This worktree's world** — `sk dev up --seed <manifest>` starts a world
  for this worktree (by default a lease on the shared stdb pool; a local
  node with `sk config set --project dev.backend local`), publishes the
  module and seeds it. It also selects that world as `sk`'s author context
  when none is set, so `sk --live`, `sk get` and `sk diff -k` reach it
  without environment variables (`sk config view` says which world is in
  use). `sk dev status`, `publish`, `wipe`, `seed`, `save` and `stop` cover
  the rest; every verb: `sk help dev` or
  [`sk dev` at a glance](../../docs/development.md#sk-dev-at-a-glance).
  Never run `spacetime start` by hand: it skips the per-worktree isolation.
- **Workspace install** — `sk` needs the monorepo's workspace installed
  once per clone (`just bootstrap`); there is no build step after that: the
  `tsx` entry point runs the TypeScript sources directly:

  ```bash
  ./bin/sk <cmd> ...
  # equivalent direct package invocation:
  npx tsx packages/spellkave-cli/bin/sk.js <cmd> ...
  # or, once the workspace bin is linked:
  npx sk <cmd> ...
  ```

  `./bin/sk` says "workspace dependencies missing; run 'just bootstrap'
  first" when the install is missing; through `npx tsx`, the same gap shows
  as `ERR_MODULE_NOT_FOUND` for a `@spellkave/tool-*` or `@spellkave/session`
  package. Neither is a broken package.
- **`sk` is not `spellkave`.** The Rust `spellkave` binary (`client/`,
  `bin/spellkave`) is the repository's *observability* CLI: status, events,
  `watch`, `doctor` and a REPL against a running node. `sk` is the
  *semantic* CLI: the same tools an agent calls, plus the manifest file
  commands. Authored instance rows on a publisher connection are `sk get` /
  `sk describe`, not `just sql`. Different audiences, different JSON
  contracts, both intentionally present. The two share the persona-profile
  *file format* (`profiles/<name>.toml`), never code.
