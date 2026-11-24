# Authoring process — the shared agent contract

<!-- BLAST RADIUS: this file is the single source for the SHARED authoring
     process (#1364). Consumers reference it and carry only role deltas:
       packages/spellkave-cli/skill/SKILL.md (sk CLI surface; home of the
                                              query-first decision table —
                                              `.agents/skills/sk-author/SKILL.md`
                                              is a stub pointing at it, `sk skill path`)
       packages/spellkave-srd-cc/CLAUDE.md   (SRD compiler: rules sources, generators)
       the adventure packages' own CLAUDE.md files (adventure-specific scope)
     Edit a shared rule HERE, once. Restating it in a consumer file
     reintroduces the copy-drift this file exists to end. -->

Binding process for every agent that authors world content — the srd-cc
generators (`packages/spellkave-srd-cc/src/`, which emit
`packages/spellkave-srd-cc/fixtures/`), `packages/spellkave-mechanics`, and the
adventure packages (`packages/spellkave-adventure-<slug>/`). Role-specific
scope, sources of truth, and proof targets live in the owning package's docs;
everything below applies to all of them.

## Step 0 — look up the pattern catalog, then does it already exist?

**(MANDATORY before any authoring or gap filing.)**

1. **Problem-indexed patterns first.** Open
   [`patterns/index.md`](./patterns/index.md) and find the problem you are
   solving (extra action this round, lingering hazard, kill XP, dialog slots,
   …). Try the documented composition before filing a `findingGap`, backlog
   item, or substrate verdict. Action Surge was filed three times as a kernel
   gap although [`action-economy.md`](./action-economy.md) §ModifyChannel
   already solved it — that miss is what the catalog exists to prevent.
2. **Then** look for an existing identity before re-authoring one.

Never author an identity you have not first looked for. Re-authoring an
existing identity wastes a full authoring round-trip at best; at worst it
lands twin identities that the linter flags only as advisory smells and seed
resolves by collision (catalog **R2**/**R3**).

```bash
sk docs --query "<concept>"                  # scored pointers: docs, examples, shapes
sk docs patterns                             # problem → pattern catalog
grep -rn "<slug-or-name>" <owning-package>/fixtures/   # the owning bundle's rows
```

**Found → extend, grant, or reference it — never re-author.** Worked trace:
asked for "a fear spell", the wrong move is to author one — `srd/spell/fear`
already exists (`packages/spellkave-srd-cc/fixtures/base/spells/level-3/fear.toml`)
and one `sk docs --query` / grep finds it; the correct move
is a capability grant or an extension of the existing identity. Not found →
proceed, and place the row in the right layer (catalog **C1**/**S3**).

## Query first, prose second

The compact machine surfaces answer most authoring questions in far fewer
bytes than the prose files, several of which run to hundreds of lines. The decision table
mapping each question class to its command lives at the top of
[`packages/spellkave-cli/skill/SKILL.md`](../../spellkave-cli/skill/SKILL.md)
— the packaged `sk` skill (`sk skill path` prints its own location;
`.agents/skills/sk-author/SKILL.md` is a stub pointing at it, #1367)
— consult it before opening any prose file in this directory. Prose reads
are the documented fallback for questions the queries cannot resolve, never
the default.

## Authoring pipeline — the ONLY legal way to write

- Author through the **`@spellkave/world-author` render path**
  (`patchManifest` / `renderSchemaManifestJson` + `validateManifestToml`) or
  the AUTHOR verbs that write through it (`sk define_*`, `sk write_rows`, …).
  **NEVER hand-edit TOML past the validator.** A validator rejection is a
  FINDING, not a license to force bytes (ADR-0021/0025). No granular-reducer
  side doors.
- Confirm row shapes with `sk query --schema --kind <row_kind>` before
  editing a driver or writing schema JSON.
- **Surface ownership is ruled by ADR-0072** (`specifications/adr/0072-…`):
  behavior-chain **composition** (capability→outcome→affordance→action→
  consequence→frame-writes) belongs to the world-author **composition layer**
  (`ActorBehavior` / `authorBehaviorFragment`; promoted per #1526 into
  `src/compose.ts` in this package; the old `scripts/srd/behavior-cluster.ts`
  home and its re-export shim were retired with the `spellkave-srd` package).
  Queries, inspection, validation, and **mechanical one-row edits** belong to
  the `sk` CLI (`sk patch` ops). The CLI never grows behavior-chain
  composition, and a new `author-*.ts` driver file must cite ADR-0072 (D-3,
  a review rule, not a CI gate) — add data entries to an existing driver, or
  a new shape to the composition layer, instead.

## Sources of truth — READ, never rely on memory

- **Numbers come from the cited SRD source, never memory (catalog
  SO1/SO2).** For SRD content that is the in-repo CC-BY cache
  `packages/spellkave-srd-cc/cache/` (open5e JSON + the SRD markdown),
  refreshed only by `pnpm --filter @spellkave/srd-cc run sync-cache`; every
  rule claim pins a `cache/` file:line before it is authored (rules and
  layout: [`packages/spellkave-srd-cc/CLAUDE.md`](../../spellkave-srd-cc/CLAUDE.md)).
  Adventure content cites its own admitted sources. If the value is not in a
  cited source, STOP and ask the operator; never fall back to memory.
- "I don't know the value" → say it and stop. Never guess.

## Proof discipline — the shared core (binding)

- **The proof is server-observed on the live lane** — an HP delta, a
  materialised affordance, a state row. Observe EFFECTS, not row existence
  and not exit codes.
- **The oracle is deterministic non-recurrence:** capture the RED
  server-observed signature, fix, re-run the same live case, assert the
  signature is GONE. Not an LLM verdict, not an inline re-implementation.
- **NEVER author a forgeable test** that re-implements the production line
  inline (Haiku/Sonnet both manufactured false "verified" verdicts this way —
  reverted 2026-06-09). LLM judges (the Tier-B judge) are advisory only and
  never gate a fix.
- **DoD chain skeleton** (each consumer names its own seed set, live lane,
  and ledger): full-bundle `sk validate <manifest> --bundle` → exit `0`; then
  full-bundle `sk lint <manifest> --bundle --strict` → exit `0` (a finding exits
  `3` under `--strict` — always pass it so a smell fails the gate); then
  `just wipe && just seed …` → `status:ok`; then **live-prove** on the
  role's lane; then record the row in the role's ledger. Which gate catches
  which failure class — and why static-validate precedes seed precedes
  live-prove — is the catalog's **Detection-timing** table.

> **What "correct" means** is catalogued once, in
> [`fixture-correctness.md`](fixture-correctness.md) — every recurring
> mistake, its failure class, and the gate that catches it. The read-only
> `fixture-correctness-auditor` agent runs the whole catalog against a bundle.

## Layering + escalation

- **Stay in the owning package and declared work scope.** Follow its authoring
  documentation for reusable rules and adventure-specific content. A substrate
  change needs its own scoped work item; it is not an incidental content fix.
  Enforcement rationale: [fixture-correctness.md](fixture-correctness.md),
  catalog **S3** (generic-mechanic-in-content-bundle) and **C1**
  (reusable-bundle `base/**` is definitions-only).
- **Record cross-layer findings before implementation.** Search the existing
  tracker, adopt matching work, or file a scoped Bead under the owning epic
  with evidence, dependencies, and acceptance criteria. Follow
  [docs/beads.md](../../../docs/beads.md); do not recreate the retired GitHub
  intake lane. Gate substrate direction with `canon-warden` and record any
  required operator decision before proceeding.
- The four `canon-warden` axes (Gibson / ADR / K-rule / data-driven) bind
  every author — if your fix wants a new kernel arm, you are out of scope:
  escalate with K-5 evidence.

## Hard rules (shared)

- Follow the owning package's authoring path and run its manifest validation
  gates; do not bypass a rejected validator result.
- Step 0 first — found → extend/reference, never re-author.
- Use the owning package's admitted rules sources and provenance requirements
  for game content; do not invent values from memory.
- Live proof, never forgeable, oracle = deterministic non-recurrence.
- Branch + PR; **never push main, never auto-merge**. English only (even if
  the operator writes German).
- **Use the current repository contracts.** Track scope and handoffs in
  Beads. In a repository checkout, read `docs/beads.md`,
  `docs/development.md`, and `docs/testing.md`; kernel/K-rule changes also
  follow `server/CLAUDE.md`, the governing ADRs, and the canon-warden gate.
  When design artifacts are required, follow `openspec/README.md` in that
  checkout. These are repository files, not addresses in the packaged docs
  corpus. Operator approval remains required wherever the governing contract
  or the current task requires it.

## Prepare a named scene

For the Adventure Author's reusable blueprint plus figure workflow, follow
[parameterized-scenes](parameterized-scenes.md). Render data values, review the
selected caller's complete empty-source evidence, stage explicitly and inspect
the phase receipt. Use an already controlled actor for play; scene population
does not confer control. Partial setup, defeated figures and cleanup remain
visible state requiring a fresh authorized decision.
