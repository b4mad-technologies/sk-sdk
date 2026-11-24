# Find an authoring pattern without a checkout

## Search by task

Use `sk docs --query "container loot"` on an installed CLI. A shared MCP docs
tool accepts `{ "query": "container loot" }` when that adapter offers it.
Search returns bounded summaries and stable document IDs, not a whole manual.
No world connection or mutation authority is required for this packaged lookup.

## Read the pattern

Open `sk docs patterns/container-with-loot`. If a page defaults to an outline,
read the relevant heading with `--section "Solution"`; `--full` retrieves the
complete page. The result's metadata gives the corpus revision and maps relative
Markdown links to packaged document IDs. Unknown server compatibility remains
explicit; a document's publication does not prove its runtime example on your world.

The [container pattern](./patterns/container-with-loot.md) identifies its SRD
dependencies and composition prerequisites. Its excerpt is not a standalone
bundle. The [Patternbook index](./patterns/index.md) covers other tasks.

## Retrieve the selected task input

`sk docs examples/loft-chest-rows --full` retrieves the container pattern's exact
source-backed fixture rows. Its title and summary identify it as an excerpt.
It requires the `elven_mini` bundle, existing `elven_mini/inn/loft` node and SRD
chest/potion definitions in the dependency closure. Pickup additionally requires
an admitted SRD creature and its action economy; this docs journey does not
perform pickup. The [container pattern](./patterns/container-with-loot.md)
explains these prerequisites. No copied subset of the rows is maintained here.

A candidate's accompanying versioned proof records the search, pattern, selected
excerpt and prerequisite assertions. Its artifact receipt identifies the exact
corpus and implementation used. That is docs retrieval evidence, not live behavior.

## Retrieve a complete separate example

`sk docs spatial-minimal-cell --full` returns a complete worked manifest in the
`toml` field, plus its walkthrough and expected offline validator diagnostics.
This is a different example from the container pattern. Its source bytes and
validator verdict are guarded during corpus generation. Offline validation does
not prove live behavior; keep the owning feature's captured runtime evidence separate.

## Recover a refusal

An unknown document returns `unknown_id`; an unknown heading returns
`unknown_section` and the real headings. Retry with a known ID or heading.
Do not treat a successful help lookup as an authority grant or a successful act.
For planned hosted authoring, the explicit reference is
`hosted-authoring-guidance`; matching hosted execution evidence remains absent.

## Publication and evidence

AUTH-56-01 is the external consumer acceptance for guide retrieval. A
[historical partial installed-candidate capture](../../spellkave-cli/docs/installed-cli-evidence.md)
is available through `sk docs evidence/auth-56-installed-cli --full`, with its
exact artifact hash, sanitized transcript, assertions and pinned text accounting.
It verifies that named candidate alone; current-release, hosted and live proof
remain pending. AUTH-56-02 requires unexecuted stories to retain planned status.
Source-generation tests remain source evidence.
