# Patterns of Spellkave Manifest Authoring

Problem-indexed pattern catalog (Fowler / PoEAA style). Mechanism guides under
`docs/*.md` remain canonical for *how a primitive works*; this catalog is where
an author looks up *the problem they are trying to solve* before filing a
substrate gap or reinventing a composition.

**Step 0:** search this table (and the linked page) before opening a findingGap /
backlog item / kernel verdict. Action Surge was filed three times as a missing
primitive although [`action-economy.md`](../action-economy.md) already solved it
via `ModifyChannel` — that class of miss is what this catalog prevents.

Most pages follow one template: Name · Problem · Forces · Solution · TOML
example (real fixture path cited) · Proof · Related · Known misuse · SRD
features. Seat-policy pages show TypeScript instead of TOML, and a few short
pages have no headings.

When you author a non-trivial composition (>2 frame writes on one consequence,
or any `ModifyChannel` / `ApplyStatus` / zone / watch / option menu), cite the
page from generator source (`// pattern: <slug>`) and emitted TOML
(`# pattern: <slug>`).

## The convention (no CI gate)

The pattern catalog was protected by a bidirectional CI gate
(`scripts/ci/check-pattern-refs.sh`) until it was retired sk-jay0.7.164.5: it
was never wired into a GitHub workflow (reachable only through `just
ci-pr-gates`, itself workflow-unreachable — PR #3455 / `no-orphan-gates`),
and was found failing against the tree — dangling composition refs, 10 orphan
pattern pages, 10 uncited complex-dir files — at deletion time, i.e. it had
already been silently unenforced for a while. The catalog and the citation
discipline below stay; keeping them true is a review/authoring discipline
now, not a machine-checked one:

1. **Forward resolution:** Every `// pattern: <slug>` in TS source and `# pattern: <slug>` in emitted TOML should resolve to a real pattern page under `packages/spellkave-world-author/docs/patterns/<slug>.md`.
2. **Reverse orphan prevention:** Every pattern page in this catalog (except `index.md` and [`before-filing-a-kernel-gap.md`](./before-filing-a-kernel-gap.md)) should be cited by at least one live implementation (srd-cc, adventure-runtime or an adventure package source) or fixture TOML. A pattern without an implementation is a documentation fiction.
3. **Complex directory coverage:** Every `.ts` source file across the complex directories (srd-cc `src/chapters/{spells,classes,monsters,magic-items}`, `packages/spellkave-adventure-runtime/src/dm/creation`, `packages/spellkave-adventure-kavemouth/{author,npcs}`) should carry at least one valid pattern citation, or an explicit opt-out comment with an honest reason:
   ```ts
   // pattern: none — barrel export for spells chapter
   ```
   An opt-out marker still needs a reason (`// pattern: none` alone reads as an incomplete comment).

**Before any findingGap / substrate verdict:** run
[`before-filing-a-kernel-gap`](./before-filing-a-kernel-gap.md) top to bottom.

Pages mined from the srd-cc authoring idioms keep the SRD-specific numbers,
ids and tables in `packages/spellkave-srd-cc/docs/` and link both ways; the
generic mechanism lives here.

## Catalog

### Action economy

| Problem | Pattern | Page |
|---|---|---|
| One extra action this round (Action Surge) | Extra action budget via ModifyChannel | [`extra-action-budget`](./extra-action-budget.md) |
| Shared pool with several spend options (slots, Channel Divinity) | Resource spend with option menu | [`resource-spend-with-option-menu`](./resource-spend-with-option-menu.md) |
| A class feature usable wherever the hero stands, spending its own uses | Actor-carried feature verb | [`actor-carried-feature-verb`](./actor-carried-feature-verb.md) |
| Short/Long Rest must restore HP, slots, feature uses | Rest-boundary resource refill | [`rest-boundary-resource-refill`](./rest-boundary-resource-refill.md) |
| Reaction after another creature's manipulate commits (counter after a hit) | Post-commit hit reaction | [`post-commit-hit-reaction`](./post-commit-hit-reaction.md) |

### Attacks, damage & riders

| Problem | Pattern | Page |
|---|---|---|
| Typed damage with resist/immune/vulnerable | Damage-type routing | [`damage-type-routing`](./damage-type-routing.md) |
| Magnitude computed outside the DSL | Computed-literal delta_source | [`computed-literal`](./computed-literal.md) |
| A weapon or monster Bite with its own damage through ONE shared attack verb | Item-sourced damage | [`item-sourced-damage`](./item-sourced-damage.md) |
| An attack / check that can miss and is still always offered | Offer vs resolution roll | [`offer-vs-resolution-roll`](./offer-vs-resolution-roll.md) |
| Several attacks in one action (Multiattack), flat or mismatched numbers | Multiattack as baked ordinals | [`multiattack-ordinals`](./multiattack-ordinals.md) |
| Weapon mastery or monster attack on-hit condition riders | Mastery-gated attack variant | [`mastery-gated-attack-variant`](./mastery-gated-attack-variant.md) |
| Which mechanism computes a number (macro / baked stat / effective / literal) | Derived value mechanism | [`derived-value-mechanism`](./derived-value-mechanism.md) |

### Conditions, capabilities & identity

| Problem | Pattern | Page |
|---|---|---|
| Grant or remove an ability while a condition holds | Condition capability grant/suppression | [`condition-grant-and-suppression`](./condition-grant-and-suppression.md) |
| My condition gate must read the OTHER party's capability | Cross-party capability facts in roll-bias gates | [`cross-party-capability-gate`](./cross-party-capability-gate.md) |
| Every creature can walk / attack / check without copying rows onto each | Identity-tag capability grant | [`identity-tag-capability-grant`](./identity-tag-capability-grant.md) |
| Derive a menu or filter from the catalog; publish a reference table | Tag-membership menu | [`tag-membership-menu`](./tag-membership-menu.md) |
| A condition must react by itself when something happens to its holder (concentration break, 0-HP intercept, damage mitigation) | Condition hook on event | [`condition-hook-on-event`](./condition-hook-on-event.md) |

### Scenario cast & encounters

| Problem | Pattern | Page |
|---|---|---|
| An NPC / encounter that "is a Goblin" with one changed number or a role | Blueprint instance with overrides | [`blueprint-instance-override`](./blueprint-instance-override.md) |
| Many enemies that fight sensibly without a seat per creature | Role-driven brain | [`role-driven-brain`](./role-driven-brain.md) |
| Walkable edges without a row per edge | Bundle movement default | [`bundle-movement-default`](./bundle-movement-default.md) |
| A player opens or closes a two-sided door, with a locked-door traversal refusal | Operable door | [`operable-door`](./operable-door.md) |

### Resources & option menus

| Problem | Pattern | Page |
|---|---|---|
| Choose-N advancement menu as metadata | Advancement choice menus | [`advancement-choice`](./advancement-choice.md) |

### Zones & hazards

| Problem | Pattern | Page |
|---|---|---|
| Self-pulsing damage zone that fades | Lingering hazard zone | [`lingering-hazard-zone`](./lingering-hazard-zone.md) |

### Triggers & watches

| Problem | Pattern | Page |
|---|---|---|
| DM offers level-up when XP crosses threshold | Proactive level-up watch | [`proactive-level-up`](./proactive-level-up.md) |
| Advancement beat gates on prior terminals | Milestone gate terminal flags | [`milestone-gate-terminal-flags`](./milestone-gate-terminal-flags.md) |

### Speech & traces

| Problem | Pattern | Page |
|---|---|---|
| Say something to the room or to one body, perceived by the right people | Directed speech anchor | [`directed-speech-anchor`](./directed-speech-anchor.md) |
| An event heard only as it happens vs a mark found on arrival | Trace perceptibility window | [`trace-perceptibility-window`](./trace-perceptibility-window.md) |
| Address a party member on another place graph | Party-extent grant | [`party-extent-grant`](./party-extent-grant.md) |
| Grant cross-graph reach at a story moment (a gift), not at seed | DM-applied extent grant | [`dm-applied-extent-grant`](./dm-applied-extent-grant.md) |

### Dialogue & quests

| Problem | Pattern | Page |
|---|---|---|
| A visible action needs a gentle public ranking/explanation without changing eligibility | Advisory action cue | [`advisory-action-cue`](./advisory-action-cue.md) |
| A visible action needs an overridable public shell draft suggestion without changing admission | Advisory action default | [`advisory-action-default`](./advisory-action-default.md) |
| Numbered Answer 1..N dialog palette | Dialog choice slots | [`dialog-choice-slots`](./dialog-choice-slots.md) |
| Which question is open right now, for whom, answered by which actions | Dialogue prompt occurrence | [`prompt-occurrence`](./prompt-occurrence.md) |
| Multi-step guided form (creation, level-up) committed on Confirm | Draft-then-confirm wizard | [`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md) |
| Questions asked in an order held as data, with an outline a client can show | Guided dialogue | [`guided-dialogue`](./guided-dialogue.md) |
| An action is offered, dispatched, "accepted" — and silently does nothing | Offer gate / consume guard parity | [`offer-gate-consume-guard-parity`](./offer-gate-consume-guard-parity.md) |
| A quest: offer, objective, terminal, reward — with no quest primitive | Quest composition | [`quest-composition`](./quest-composition.md) |
| NPC joins and follows the hero | Companion follow seat | [`companion-follow`](./companion-follow.md) |
| Companion fights beside the hero | Companion combat (follow + role + ally heal) | [`companion-combat`](./companion-combat.md) |
| Quest completion pays the present party | Quest XP grant | [`quest-xp-grant`](./quest-xp-grant.md) |
| A watch's injected resolver reads a table the watch never subscribed, and answers "nothing found" | Watch reader-manifest closure | [`watch-reader-manifest-closure`](./watch-reader-manifest-closure.md) |

### Progression & XP

| Problem | Pattern | Page |
|---|---|---|
| Killer is paid at the moment of death | Kill-time XP grant | [`kill-xp-grant`](./kill-xp-grant.md) |
| A boss or quest drops a rolled item | Loot table drop | [`loot-table-drop`](./loot-table-drop.md) |

### Equipment

| Problem | Pattern | Page |
|---|---|---|
| Continuous numeric stat/AC modifier active while item is equipped | Equip-gated modifier | [`equip-gated-modifier`](./equip-gated-modifier.md) |

### Containers & inventory

| Problem | Pattern | Page |
|---|---|---|
| Place a container holding items; players take them out with no bespoke verb | Container with loot | [`container-with-loot`](./container-with-loot.md) |
| Drink or use a carried consumable; the dose is removed | Consumable inventory consume | [`consumable-inventory-consume`](./consumable-inventory-consume.md) |

## Adding a page

Copy any seeded page. Keep the heading set identical. Cite a **generated**
fixture path (or the generator that emits it), a proof test, and the SRD
feature list. Register new slugs only when a composition is proven — not as
speculative stubs.
