# Installed CLI workflows

`sk` is a command-line surface over a Spellkave world's tool registry. For
**registry tools** (the AUTHOR and PLAYER groups below) `sk` names no tool
and hand-writes no flag: their commands, flags, and help text are derived at
runtime from the registry, so that part of the surface stays accurate as the
registry grows. The file commands, `session`, `events`, `config`, and the
global flags are `sk`'s own and hand-written. Use `sk --format jsonl list`
for the machine-readable registry, `sk help` for a human summary of every
group described below, and `sk help <tool>` for one tool's schema-derived
flags.

Except for `explore`, which defaults to TOON, results default to human Markdown
only when stdout is an interactive TTY;
captured, redirected, or piped stdout stays canonical JSONL, one object per
line with a snake_case `kind`. Agents and scripts should pass `--format
jsonl` when terminal detection is not under their control. `--format human`
forces the same structured records through the generic Markdown/table
projection. Usage, one-tool help, and ambient-state announcements like
"using profile X" remain on stderr.

Before relying on ambient author defaults, run `sk --format jsonl config show`.
It reports each effective value and source. Resolution is deterministic:
flags > environment > project `.spellkave/config.toml` (gitignored, optional) >
global XDG (`~/.config/spellkave/config.toml`) > built-ins.
Do not infer a bundle from the working directory or
write “last used” author state; use an explicit flag or reviewed project config.
The world a `--live` flush reaches is separate: `sk --format jsonl config view`
reports it and its source (flag, environment or the worktree's current
context, selected explicitly with `sk config use-context <name>`).

`sk` has four groups of commands, and knowing which one you are in explains
most of its shape:

| Group | What it is | Connection | Examples |
|---|---|---|---|
| **AUTHOR tools** | edit a world's *content* — place entities and actors, define capabilities, write typed rows, query schema; read admitted authored instances on publisher or role-scoped sessions | offline, except the connected tools (`get` / `describe` and `can-i` / `diff -k` / `apply -k` on the author path; `apply_manifest_delta` when it flushes `--live`; `export`) | `sk query`, `sk get`, `sk describe`, `sk place_entity`, `sk place_actor`, `sk define_capability`, `sk write_rows` |
| **PLAYER tools** | perceive and act *as* one connected in-world actor | always connected, through a session daemon | `sk scene`, `sk move`, `sk inventory`, `sk react_option` |
| **File commands** | take a manifest PATH; read commands may use configured `author.target` (a manifest file or directory), including its `[[include]]` closure; dependency manifests are explicit `--dep` inputs | none (local files) | `sk validate`, `sk lint`, `sk patch`, `sk render`, `sk inspect`, `sk map-inspect`, `sk map-render`, `sk skill` |
| **Plugin groups** | a command group from a workspace package listed in `sk.plugins` (`sk plugin list`); flags derive from the verb's schema like a registry tool's | per verb | `sk plugin list`, `sk help dev`, `sk dev up --seed <manifest>` |

**Spatial graph:** `sk map-inspect` (human) draws the shared SVG place-graph
inline. `--images auto` (the default) tries the Kitty graphics protocol, then
falls back to timg quarter blocks when `timg` is installed, else a text
inventory; `--images kitty|iterm2|half|quarter|sixel|timg|off` forces a mode.
`sk map-render --out map.svg` writes that SVG. Registry tool `sk map_graph`
(`spellkave_map_graph`) builds the same SVG from `spellkave_query` sources only.

**Who is where (occupancy):** map badges are **counts only**. Default path
(usually two calls — do **not** N× detail):

```text
sk map_graph                              # picture + density
sk query --kind entities --fields preferred
# registry: spellkave_query { kind: "entities", fields: "preferred", target?: "local" }
# → group by place_node_id
```

Deeper playbook (gotchas, optional third call): `sk docs place-graph-occupancy`
/ `spellkave_docs { doc: "place-graph-occupancy" }` — pull only if needed.
Default list stays ids-only; `actors` rows carry no location (the location is
the separate `actor_spatial_locations` row).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | usage or infrastructure error (bad flags, unresolvable connection, a tool that threw) |
| `2` | in-world rejection — a tool ran correctly and reported `ok: false` (invalid manifest, refused delta, validator diagnostic) |
| `3` | `sk lint --strict` — root-bundle findings present; `sk diff -k` — differences found (not `1` as in `kubectl diff`) |

A tool that **throws** is infrastructure (`1`), never an in-world rejection.

---

# Part 1 — Authoring (AUTHOR tools + file commands)

A clean `sk validate` runs the same validator crate the server runs at
admission, but the server validates against the definitions already applied
to the target world; locally only the bundles you pass with `--dep`
approximate that closure. A clean run is the deterministic **floor**, not
proof of admission or of correctness. Two whole classes of fixture-correctness
failure pass `validate` clean:

- **Silent-at-seed**: generator/hand id collisions, duplicate
  `(entity, state)` last-write-wins, above-`max` clamp. The validator cannot
  see seed-time commit behaviour — these surface only once the manifest is
  actually applied/seeded against a live world.
- **Semantic**: a predicate or DC that *parses* but *mis-evaluates* at
  runtime. No general static gate exists (`sk lint`'s `dead-target-capability`
  catches one such class). For an isolated formula, `sk eval` / `spellkave_eval`
  is the offline oracle: evaluate the expression against supplied facts and
  trace which operand evaluated false, short-circuited, or exhausted dice without
  touching a live node. For holistic game-loop behavior (affordance disclosure,
  niche occupancy, act resolution), observe the effect on a live, connected
  world (see Part 2).

"Repair only from diagnostics" applies to the deterministic class. For
silent-at-seed collisions there is no diagnostic to repair from — you seed and
observe, or you connect and prove it live. For a mis-evaluating predicate or DC,
bench it offline with `sk eval` before touching a live node.

## Query first — before reading prose

The compact machine surfaces below are generated from the same crates the
validator runs. A prose read is the
fallback for a *named, unresolved* question — never the default first move.

| You want | Run | Not |
|---|---|---|
| Does it already exist? (**step 0**, before ANY authoring) | `sk docs --query "<concept>"` + grep the owning content directory for the slug | authoring a duplicate identity |
| Row kinds / field names | `sk query --schema --kind <row_kind>` | reading the whole manifest-format doc |
| DSL operators / arg shapes | `sk docs dsl-grammar` | reading the whole DSL grammar doc |
| Why did a formula evaluate false? | `sk eval "<expr>" --facts '<json>' --dice <faces>` (or `spellkave_eval`) | seeding and guessing why a predicate failed |
| Start here | `sk docs onramp` (AUTHOR + PLAYER tools; TOML as model) | dumping the whole corpus |
| A known shape for a mechanic (consume an item, grant XP, gate on a capability, …) | `sk docs patterns` (the pattern catalog), then the pattern page it names | inventing a shape, or filing a kernel gap before the catalog says there is none |
| Examples / how-to | `sk docs --query "<intent>"`, then `sk docs <id>` | reading the whole docs corpus |
| Failure symptom | `sk docs --query "<error or DSL name>"` (repair sheets) | scrolling onramp gotchas |
| Current world/bundle state | `sk inspect <root> --bundle` | reading whole fixture files by hand |
| Find a place, definition or placed instance by name, then follow it | `sk --target <manifest> explore search "<text>"`, then run the printed `next` commands as printed (`explore detail`, `neighbors`, `references`, `field`) | guessing row ids, or hand-writing a `sk query --json '{"explore":...}'` request |
| Authored instance on the live world | `sk get <kind> [<key>]` / `sk describe entities <key>` | export or `sk query --kind entities` without a live author connection |
| A question the queries can't resolve | `sk docs <id>` for the named doc, targeted | a full-corpus read |
| May this actor do this, and why not | `sk can-i <action> --as <body> --target <target>` | performing the act, or recomputing the checks offline |

**Step 0's rule is binding: found → extend, grant, or reference — never
re-author** a twin identity. Re-authoring an identity that already exists
wastes a full authoring round-trip at best; at worst it lands twin
identities a lint pass flags only as an advisory smell, and seed-time
resolves by last-write-wins collision.

## Loop

0. **Check it already exists** (mandatory): `sk docs --query "<concept>"` +
   a targeted grep of the owning content directory. Found → extend/grant/
   reference the existing identity — never re-author a twin.

1. **Inspect** what's there before editing:

```bash
sk inspect <manifest.toml>
sk inspect <manifest.toml> --bundle
sk inspect --kind <row_kind>
sk inspect --kind <row_kind> --id <row_id>
```

Use `--bundle` when the root manifest has `[[include]]` fragments; without
it, an include-heavy bundle looks empty because the root only names
fragment paths. For interactive exploration, stay on `inspect`: the overview
prints each exact row-kind key, `--kind` lists its rows, and `--id` opens one
row plus its references. `sk query` remains the registry-level equivalent for
agents and scripts. To find a row by what it is called or described as, run
`sk explore search "<text>"` (files with `--target` or configured `author.target`, otherwise the connected world);
search output defaults to TOON with up to five matches. Run the printed `next`
commands as written to inspect a result, continue a page or widen the limit when
offered. Lists are bounded by both the requested row count and a 16,384-byte JSON
answer budget; a larger `--limit` does not remove the byte budget. Source and
coverage metadata identify non-default or incomplete reads; `--format jsonl`
before `explore` gives the underlying JSON projection.

Live exploration labels its scope as `caller-visible rows`: totals and
`completeness` describe that admitted scope, including when the connection also
reports `reads_as_publisher: true`. They do not establish equality with the
authored file catalog. A definition such as `Creation Candidate` is a blueprint;
finding it under `--collection definitions` does not prove that an instance
exists under `--collection instances`. The current live instance projector
reports `incomplete` with the existing `authored_entities_only` limit and no
inventory total: runtime-born bodies lack authored keys, and graph extents can
omit containment-only descendants. Empty matches therefore do not prove an
empty world. Paging still walks the admitted projected rows; an unchanged retry
does not broaden this fixed limit. The live 84/81 regression is in
`behaviour/exploration/visibility.feature` and runs in the kernel-live CLI lane.

For authored inventory inside containers, an appropriate existing Bundle read
grant includes those authored descendants. The live BDD proves 81 directly
placed bodies under a graph grant and all 84 under the Bundle grant, without
changing admission. An authorized operator can grant the world's existing role:

```sh
sk --live grant --role dm --subject <identity> --extent-kind bundle --extent elven_mini --bundle elven_mini
sk explore search --kind entities --bundle elven_mini --source live
sk explore search Candidate --kind entity_definitions --source live
```

Use the intended caller's identity and an existing role with the required read
depth; configuration does not grant authority by itself. This fixes contained
authored inventory, while runtime references remain unsupported by the current
projector. The matching live scenarios are in `visibility.feature`.

Native command names resolve to their existing schema-derived help, and a help
flag is handled before invoking a command. These work without a world connection:

```sh
sk help grant
sk help can-i
sk session stop --help
sk dev publish --help
```

The installed CLI process scenarios in `configured-world.feature` prove the
native aliases, grant subcommands and post-verb help with an unreachable world
configured. Help stays on stderr and leaves stdout empty.

Text relevance comes first: an exact mechanism name beats an entity-name prefix.
Within an equal text relevance tier, broad definition searches show entity
blueprints before supporting mechanisms. When a single-definition answer offers
a relationship follow-up, it uses `references` instead of spatial `neighbors`,
following authored links such as initial capabilities. Continuations from the previous ordering are refused
as stale; use the printed restart. These journeys are proved in
`behaviour/exploration/candidate-discovery.feature`.

An explicit `--kind` selects its collection from the static schema, so
`sk explore search --kind entities --field name --field kind` needs no
`--collection instances`. Without either flag, search defaults to places. An
explicit collection that disagrees with the kind is a usage error, with the
matching collection named in the response. The real CLI scenarios in
`behaviour/exploration/reusable-definitions.feature` cover these cases.

Instance search totals count matching **rows**, not distinct objects. A complete
search with matching rows from multiple instance kinds adds `counts_by_kind`; an entity body
and its actor facet can share a key and still count as separate rows. These
counts cover the whole filtered result, remain stable across pages of the same
snapshot, and are omitted when coverage is incomplete. Narrow to `--kind entities`
to count bodies, or `--kind actors` to inspect steering facets.

To inspect authored body classifications without losing the row identity:

```bash
sk explore search --collection instances --kind entities --field name --field kind
```

TOON keeps `kind` for the row kind (`entities`) and shows the authored scalar
as `fields.kind` (`player`, `npc`, or `item`, for example), in lists and details.
Other scalar names that collide with navigation columns use the same
`fields.<name>` prefix. JSON keeps its nested `fields` object. A `player` body
classification alone does not establish a current human player claim. The
real-CLI regressions are in `behaviour/exploration/reusable-definitions.feature`.

To enter an unfamiliar place graph, search by its name:

```bash
sk explore search "<graph-name>" --kind place_graphs
```

For one match, run its printed `neighbors` command. For several matches, use the
printed detail template for the chosen graph, then its printed `neighbors`
command. A graph's neighbors include its rooms and stored parent/child graph
links. Open a chosen room with its detail template, then follow `neighbors` to
see linked rooms and admitted occupants. Each link names its stored relationship;
the printed commands carry bundle and source identity. This walk is read-only and
does not expand the whole world. The graph-to-room-to-occupant journey is proved
in `behaviour/exploration/find-places.feature`.

An incomplete answer with `examined_row_bound` means the source reader reached
its examination limit. Paging continues over the examined subset. A family with
`no_live_projection` is not supported by that live reader. TOON explains these
fixed limits and omits an unchanged retry when all gaps have either reason,
including mixed answers. Transient or unknown gaps and refusals retain their
recovery routes; page continuations remain available. The underlying JSON
projection retains its original recovery metadata. Regression coverage is in
`src/__tests__/explore-toon.test.ts`,
`behaviour/exploration/search-ranking.feature` and the small live CLI scenario
in `behaviour/exploration/visibility.feature` (also run by the existing kernel
scoped-read CI row).

For adventures and rules in separate packages, configure the local manifest and
each dependency once. From the checkout root, for Elven Mini:

```bash
sk config set --project author.target packages/spellkave-adventure-elven-mini/fixtures/adventure.manifest.toml
sk explore search --kind place_graphs --limit 20
sk map-inspect --images off
```

This checkout tracks `.spellkave/defaults.toml`, which maps the `srd` and `dm`
bundles, so the adventure's dependencies resolve with no extra flags. Defaults are
the lowest layer (flag, then project, then global config, then defaults) and may
only set `author.dependencies`, with repository-relative paths; set a project
mapping with `sk config set --project author.dependencies.<bundle-id> <manifest>`
to override one. Project paths resolve from the project root, including from subdirectories.
Dependency mappings apply to local registry reads (`explore`, `query`, `map_graph`)
and follow transitive `depends_on` links. Unmapped IDs retain the conventional
`<fixtures-root>/<bundle-id>/manifest.toml` lookup. An explicit `--fixtures-root`
overrides configured mappings for that call and warns on stderr when mappings
are present. `config show` reports each mapping
and its source; `config unset --project author.dependencies.<bundle-id>` reveals
its global default, if any. Global dependency paths resolve from the global
config file's directory. A relative global `author.target` instead resolves from
the invocation's working directory, so use an absolute global target for reuse
across directories. Literal `~`-prefixed dependency paths are rejected; use an
absolute or appropriately relative path. These settings configure files; connection profiles
continue to select live worlds. The configure-once behaviour is exercised by
`packages/spellkave-cli/behaviour/exploration/configured-world.feature`.

For player-facing places, inspect both graph and node descriptions: a graph
blurb does not supply a node's arrival prose (`author_place` has separate
`description` and `nodes[].description` fields). Keep generator rationale and
operator decisions in source comments or developer docs. Check spatial claims
against the composed scene, including edges added by other fragments or at
runtime; an empty edge list in one helper does not prove an isolated place.
After a prose change, read the rendered PLAYER scene on the updated world.

2. **Query** only the context the edit needs:

```bash
sk docs --query "<intent>"
sk docs <id>                           # prose + a copyable example TOML
sk query --schema --kind <row_kind>    # one row kind's fields
sk docs dsl-grammar                    # operators + arg shapes
```

Never guess game-mechanical numbers (stat blocks, DCs, damage dice). If a
value isn't in the authored bundle or a cited source, say so and stop —
don't invent one.

3. **Edit** structurally. Prefer a first-class patch op over freehand TOML —
   each op writes the typed round-trip and validates:

```bash
sk patch <manifest.toml> \
  --op add-entity \
  --json '{"entity_key":"demo/guide","name":"Guide","kind":"npc","place_node_id":"village/village_green"}' \
  --output <manifest.toml>
```

An unknown op fails with `unknown patch op: <op>` (exit `1`) and does not
list the accepted ops. The op names are the arms of `dispatch` in the
`spellkave-authoring` crate (`src/patch/mod.rs`); that list grows with the
authoring engine, not with this skill.

For a bulk edit (many rows of the same kind at once), build one
schema-shaped JSON object and render it in a single call instead of looping
a patch op per row — the renderer fills row defaults and validates:

```bash
sk render --input <manifest.json> --output <manifest.toml>
```

`sk docs --query "<row kind> seed"` (or a nearby phrase naming the row kind)
surfaces a worked example and its doc id — reserve `sk patch` for
incremental single-row edits.

The registry write verbs (`author_place`, `place_entity`, `place_actor`,
`define_*`, `write_rows`) are the other edit path: they write into a
workspace scratch, not into a file or a world. `sk apply_manifest_delta` is
the transaction end — with no params it flushes that scratch to the active
target (`local` merges into the target folder's `manifest.toml`, `live`
dispatches `r_apply_manifest_delta`). Until then nothing outside the
workspace changes. `sk patch`, by contrast, writes the FILE you name.

Files of a root that is already on a world (a seeded root with an
`applyset = "<name>"` line) reach that world with `sk diff -k <dir>` and
`sk apply -k <dir>`, like `kubectl diff -k` / `apply -k`: `diff` classifies
every row against the world's applyset memory (`create`, `configure`,
`move`, `prune`, `unchanged`; exit `3` on differences), `apply` sends only
the changed rows in one call and retracts dropped rows only with `--prune`; a placed entity's one `bundle_id:entity_key` retraction covers its authored instance rows (tag rows stay).
With publisher closure on a played test world, `--prune` of an entity the player touched needs `--force` so the tool can retract world-added rows (a carried item, a claimed seat); without it the apply refuses and lists them. Caller-scoped entity prune refuses even with force because that closure is unavailable. Rows the world holds but the applyset never applied are left alone. Kinds
without a row identity are counted, not compared. Full rules, refusals and
limits: this package's `README.md`, "Applyset diff and apply".

4. **Validate** every write and repair from diagnostics, re-running until
   exit `0`:

```bash
sk validate <manifest.toml>
sk validate <manifest.toml> --bundle --dep <dep-manifest.toml>
```

Use `--bundle` for include-heavy content and repeat `--dep` once per
declared dependency so cross-bundle references validate against the same
closure a live server would admit. Fix only what a diagnostic's
`code`/`path`/`message` names — don't reopen the whole file.

5. **Lint** for author-time duplication / binding smells (advisory, never
   fatal on its own):

```bash
sk lint <manifest.toml> [--bundle [--dep <dep>]...] --strict
```

`sk lint`'s findings are the author-time mirror of dangling references and
duplication patterns the validator doesn't flag (twin actions, dangling
capability bindings, tag repetition, dead-predicate branches). By default
findings alone exit `0`; pass `--strict` in any flow that gates on `$?` so
findings on the root and its includes exit `3`. Dependency findings remain in
the report with their `bundleId`, but do not fail the root check. A finding
without bundle provenance still fails strict mode. The complete,
current rule-id list — regenerated from the lint engine's own rule table,
never hand-copied — is:
<!-- GENERATED:lint-rule-ids:start -->`twin-action`, `dangling-required-capability`, `orphan-spell-capability`, `spell-delimiter-drift`, `tag-repetition`, `dead-target-capability`, `dangling-ref-tag`, `ambiguous-ref-tag`, `duplicate-exit-label`<!-- GENERATED:lint-rule-ids:end -->.

6. **Audit before shipping.** `validate` + `lint` are the floor — by
   construction they miss the silent-at-seed and semantic failure classes
   named above. For anything non-trivial, prove the change by actually
   seeding/applying it against a live world and observing the effect (Part
   2) rather than trusting a green `validate` alone. For a new or changed DSL
   formula, bench its evaluation offline with `sk eval` before applying.

## When the tool fights you

Friction is a signal the *tooling* is missing something, not that you should
work around it by hand. If an edit no patch op expresses, if a diagnostic is
unclear or missing, or if answering a small question cost you a whole-file
read — note what you wanted, the command that fell short, and the workaround
you resorted to. Then route that friction to whoever owns the surface that
fell short (a doc-gap/inexpressible-edit report from inside an authoring
loop, or an issue against the tool) rather than silently absorbing the cost
every future session. Don't hot-patch `sk`, its registry, or the underlying
authoring engine mid-task — that path skips review and regresses easily; the
durable fix rides through the tool's own change process.

---

# Part 2 — Connected mode (PLAYER tools)

PLAYER tools (`sk scene`, `sk self_summary`, `sk move`,
`sk manipulation_context`, `sk manipulate`, `sk communicate`, `sk inventory`,
`sk react_option`, `sk end_turn`, and
more — `sk list` names the current set) let you perceive and act as **one
connected in-world actor**. Unlike AUTHOR tools, there is no offline PLAYER
mode: every PLAYER call needs a resolvable connection, because
subscribe-on-connect establishes the actor-scoped factual context. Until it
is ready, a caller must treat discovery as unavailable rather than infer a
blocked gate from an empty result.

## The session daemon

A PLAYER call doesn't hold its own connection — it dispatches through a
background **session daemon**, keyed by the `(url, db, identity, actor)`
binding this invocation resolves:

1. `sk` resolves the binding (see "Connection resolution" below).
2. `sk` attaches to the ONE daemon already listening for that exact
   binding, or spawns one if none is running yet.
3. `sk` sends one request over the daemon's socket, reads the response, and
   disconnects — the **daemon** keeps the live session open, not `sk`
   itself. Successive `sk` calls against the same binding (`sk scene`, then
   `sk move ...`, then `sk scene` again) reuse that one live session
   instead of reconnecting each time. The daemon also holds one ADR-0093
   `WorldEventBuilder` for that lifetime and piggybacks pending world-push
   events (hits, XP, turn transitions) on every invoke; `sk` prints each as
   its own JSONL line (`kind: "push"`) after the `tool_result`.

The daemon persists past the invocation that spawned it (an idle timeout
shuts it down after a period of no activity), or you can manage it
explicitly:

```bash
sk --format jsonl session list # one JSONL line per known daemon, status, and observability mode
sk session stop                # stop the daemon THIS invocation's binding resolves to
sk session stop <hash>         # stop the daemon named by sk session list's own `hash` field
sk session stop --all          # stop every daemon this host knows about
sk events --drain              # drain pending world-push events without running a PLAYER tool
```

## Connection resolution

`sk get` and `sk describe` use the **AUTHOR** path and connect on their own
(no `--live`), the same ladder as `sk can-i` / `sk diff -k` / `sk apply -k`.
They do not open a second owner subscription and they do not call
`r_export_manifest`.

Both a PLAYER call and an AUTHOR `--live` flush need a connection, but the
two paths resolve it differently.

**PLAYER tools** — the precedence, in order:

1. **Explicit flags** — `--actor <id>` for the connected actor.
2. **`--profile <name>`** — resolves `url`/`db`/`actor`/token from a stored
   persona profile.
3. **The plain env chain** — `$SPELLKAVE_URL` / `$SPELLKAVE_DB` /
   `$SPELLKAVE_ACTOR`.
4. **The remembered last-used profile** — a bare invocation with neither an
   explicit `--profile` nor a resolvable env chain falls back to whichever
   profile was last successfully used, **announced on stderr** so ambient
   state is never silent (`sk: using profile 'kira' (last used)`). A script
   that must not depend on machine state should pass `--profile`/the env
   vars explicitly instead.
5. **Nothing resolvable** — a loud usage error naming every remedy.

**AUTHOR `--live`** — `--profile <name>` supplies url/db/token outright;
without it the plain env chain (`$SPELLKAVE_URL` / `$SPELLKAVE_DB`) resolves;
without that, the worktree's **current context** (`sk config use-context
<name>`, or the `local-<worktree>-<hash>` profile `sk dev up` selects). When
the environment and the context name different worlds the environment wins and
stderr carries one warning naming both. There is no `--actor` step and no
last-used-profile fallback: `play-stage` and PLAYER `--profile` never move the
author target. On both paths an explicit `--profile` beats the ambient env, so
the same flag never means opposite things. Check the target before a write
with `sk --format jsonl config view`.

A connected author answer (`sk get`, `sk describe`, `sk can-i`, `sk diff -k`,
`sk apply -k`, and `sk tool <name> --live`) includes `reads_as_publisher` and
`connected_identity`. `reads_as_publisher` is true only after the publisher
subscription has applied. False means `sk get` / `sk describe` return no rows
(`ok: false`, exit 2) — they do not fall back to `visible_*` or export. Other
tools keep their reader-cache result and add a note naming `connected_identity`.
It does not claim the identity is not the publisher. Remedy: `sk config view`.
As a last resort, set `SPELLKAVE_CONNECT_TOKEN` from the node's `cli.toml`.

Instance facts (containment, place, capabilities, equipment, object state) are
`sk get` / `sk describe`, not operator-only SQL or observability commands.

Every `--live apply_manifest_delta` is journaled: the applied TOML as
`.local/live-deltas/NNN-<utc>.toml` plus one line in
`.local/live-deltas/journal.jsonl` (binding, source, ok, MF detail, duration,
sha256), failures included; stderr names the file. `SPELLKAVE_LIVE_DELTA_JOURNAL=0`
turns it off, `SPELLKAVE_LIVE_DELTA_JOURNAL_DIR` relocates it.

`sk help` shows the current global-flag surface; this package's own
`README.md` (shipped alongside this skill file) carries the complete
flag/env-var reference table.

## Live-proving a change

The oracle for a semantic authoring claim (a predicate/DC that parses
but might mis-evaluate) is a server-observed effect: connect (PLAYER tools,
or the installed observability CLI if one is available), trigger the
behavior, and read the actual result off the live world — an HP delta, a
materialised affordance, a state row — not an exit code and not row
existence. Capture the failing ("RED") signature first, fix, re-run the same
case, and confirm the signature is gone. Never author a test that
re-implements the production logic inline as its own "verification" — that
pattern has produced false-positive "verified" verdicts before.

When an act (`sk manipulate`, `sk move`) fails or resolves a check, its receipt
carries `provenance_id` matching the server evaluation record. Query the record
directly via:

```bash
sk self_states --kind evaluation --provenance-id <id>
```

This returns the exact failure details (`failure_kind`, `failure_detail`), the
gate formula (`expression_ids`), and any resolved dice rolls (`draws`,
`selected_template_ids`). To inspect a failing formula offline, feed its
predicate, dice faces, and facts to `sk eval` (see Level A rule benching in
`sk docs rule-bench`).

## Observability

The session daemon emits run events for its own lifetime (one run per
daemon session, one event per dispatched call) plus reducer-attempt
tracing, controlled by `$SPELLKAVE_RUN_EVENTS` (`off|jsonl|otlp|jsonl+otlp`,
default `jsonl`) — captured at daemon **spawn** time, so changing it needs
`sk session stop` followed by the next call respawning. `sk session list`
reports the active mode per daemon, so this is never invisible ambient
state. This package's `README.md` names every observability env var.

---

# Self-contained by design

Everything above holds wherever `sk` runs — this skill file ships packaged
with the `sk` CLI itself (`sk skill path` prints its own location) so it
travels with the tool, not just with one repository checkout.
