# Modding Spellkave — onramp

Start here. This page is the single door into authoring: what a world bundle
*is*, how you change it with **AUTHOR tools**, how you prove it live with
**PLAYER tools**, and where TOML fits underneath. For failure symptoms, query
Troubleshooting repairs (`sk docs --query "<error or DSL name>"`) — do not hunt
gotchas on this page.

Without a checkout, start with `sk docs find-an-authoring-pattern` or
`sk docs --query "<task>"`. `sk docs cli/workflows` supplies the installed CLI
loop; `sk docs personas/access` maps task lenses and access routes, and
`sk docs player/workflows` supplies the PLAYER-owned loop. A connector offering `spellkave_docs` accepts the same stable IDs through
its `doc` argument; help grants no world authority. Explicit
`hosted-authoring-guidance` describes pending role-based execution prerequisites.

## What you are looking at

Spellkave content ships as a **bundle**: a directory (in-repo under a
package's `fixtures/`, e.g. `packages/spellkave-srd-cc/fixtures/` or
`packages/spellkave-adventure-<slug>/fixtures/`, or any local target) with a
top-level `manifest.toml` plus includes.
The file format is **TOML**. Each include holds `[[row_kind]]` tables whose
shapes come from the typed schema (`sk query --schema --kind <row_kind>`).

**TOML is the underlying model**, not the preferred typing UX:

- AUTHOR verbs write the same rows a hand-authored bundle would;
- `sk validate` / admission check that TOML;
- you read TOML when debugging verb output or editing fixtures.

Deep row/field reference: corpus id `manifest-format`.
Predicate/outcome expressions inside rows: `dsl-grammar`.

## Three command groups (`sk`)

| Group | Job | Connection |
|---|---|---|
| **AUTHOR tools** | Edit content — places, placed entities/actors, behaviors, rows | Offline (except the delta apply flush and `export`) |
| **PLAYER tools** | Perceive and act *as* one in-world actor | Always connected (session daemon) |
| **File commands** | `validate`, `lint`, `inspect`, `render`, … on a path | Local files |

Browse tools with `sk help`. Machine callers use `--format jsonl`.

## AUTHOR path (write content)

1. **Discover** — `sk docs` (index with summaries) or
   `sk docs --query "<intent>"`. Prefer a small hit over a long guide.
2. **Check it already exists** before inventing a twin id, and check the
   pattern catalog (`sk docs patterns`) for a known shape.
3. **Write** with verbs (`sk place_entity`, `sk place_actor`, `sk define_*`,
   `sk author_place`, …) or,
   for the multi-call fireball walkthrough, open `getting-started-with-verbs`.
4. **Validate** — `sk validate` (the admission validator; the server also
   checks against definitions already in the world, so pass `--dep` for each
   dependency).
5. **Apply** when connected — flush the workspace delta
   (`spellkave_apply_manifest_delta` / live AUTHOR apply).

Schema without prose: `sk query --schema --kind <row_kind>`.

## PLAYER path (prove it live)

Content that only validates is not finished. Connect a session, then:

1. Perceive — `sk scene` / self summary / inventory.
2. Act — `sk move` (and reactions when offered).
3. Observe — did the world change the way the author intended?

PLAYER tools always need a resolvable connection (see the `sk` skill Part 2).
They are how you catch silent-at-seed and semantic mistakes validate cannot see.

## Definition seeds (one pointer)

Reusable creature/item **definitions** can seed HP, innate capabilities, and
starting conditions onto every placed instance. Worked example:
`definition-seed-statblock`. Concept detail lives with that example and
`manifest-format`, not here.

## Bundle layout and seed order (short)

`just seed` has no default manifest (sk-mts): pass the bundle to seed, e.g.
`packages/spellkave-mechanics/fixtures/core` for the bare substrate or
`packages/spellkave-srd-cc/fixtures` for SRD rules, and layer your bundle on
top. Reserved keys and embedded DSL fields are explicit — see
`manifest-format` and the world-manifest-authoring capability spec outside this
corpus if you need normative SHALL text.

```bash
# examples of local authoring checks
sk validate path/to/bundle/manifest.toml --bundle
sk lint path/to/bundle/manifest.toml --bundle --strict
sk inspect path/to/bundle/manifest.toml --bundle
```

## Where to go next

| Need | Corpus id / command |
|---|---|
| A known shape for a mechanic | `patterns` (problem → pattern catalog) |
| AUTHOR verb deep-dive (4-call fireball) | `getting-started-with-verbs` |
| Full verb parameter reference | `tool-reference` |
| TOML row/field reference | `manifest-format` |
| DSL operators | `dsl-grammar` |
| Worked examples | `sk docs` → Worked examples, or `spatial-minimal-cell` |
| Something broke | `sk docs --query "<symptom>"` (Troubleshooting / `repair`) |
| Shared agent process | `authoring-process` |
| One section of a long doc | `sk docs --doc <id> --section "<heading>"` |
| AUTHOR verb index | `sk docs tool-reference` |
| One AUTHOR verb | `sk docs tool-reference spellkave_define_session` |
| Force full tool-reference | `sk docs --doc tool-reference --full` |

Open any id with `sk docs <id>` (same as `spellkave_docs` `--doc`).
