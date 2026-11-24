# Milestone gate on prior terminal flags

## Name

`milestone-gate-terminal-flags` — Milestone gate on prior terminal flags

## Problem

My advancement beat gates on flags a much larger prior beat already set — do I have to replay that whole beat?

## Forces

- Honest proof still requires real action execution against a live node.
- Replaying unrelated combat/narrative content wastes agent time and flakes.
- Each flag's own predicate usually needs only a strict subset of prior entities.

## Solution

Read each composed flag's OWN consequence predicate. Stage a trimmed session
with only the entities those predicates read, then execute the real action
that writes each flag. Full repair (its worked example is archived
Phandelver content):
[`repairs/milestone-gate-terminal-flags.md`](../repairs/milestone-gate-terminal-flags.md).

## TOML example

Live example (elven-mini Q9): the Q9 terminal reads the persistent flag
`elven_mini/quest/flag/q9_tomb_opened` and the deep-tomb stair edge reads the
seal's spatial state; the one `elven_mini/quest/open-tomb` action writes both
(`author/tomb-key.ts`). The proof stages
just the giver, the DM, the hero, the key item and one companion at the seal
node — not the Rung III fights before it — and executes the real actions:

```toml
# compose only what the gate reads:
# gates:  Q9 terminal reads quest/flag/q9_tomb_opened; the stair edge reads the seal state
# writer: elven_mini/quest/open-tomb (hero holds the tomb key, stands at the seal)
# stage:  giver + DM + hero + key + one companion at TOMB_SEAL_NODE
```

## Proof

- `packages/spellkave-adventure-runtime/tests/live/quest-giver.live.test.ts`
  and `packages/spellkave-test-lab/src/scene-live/seal-gate.local-node.test.ts`
  (private scenes; accept Q9, open the tomb with the key, the stair opens).
- `packages/spellkave-adventure-elven-mini/tests/offline/quest-progression.test.ts`.

## Related

[advancement-choice](./advancement-choice.md), [proactive-level-up](./proactive-level-up.md).

## Known misuse / anti-pattern

Seeding terminal flags in a *proof* without executing the actions that set
them (a story save state such as `fixtures/story/hero.toml`, which records
a world after the action ran, is a different thing). Assuming 'replay the
whole prior beat' is the only honest path.

## SRD features that use this

- Level-up / story milestone beats that gate on prior quest or combat terminals.
