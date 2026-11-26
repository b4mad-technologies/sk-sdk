# Offer gate / consume guard parity

## Name

`offer-gate-consume-guard-parity` — the predicate that OFFERS an action and
the guard that COMMITS it are one list, in one place.

## Problem

An authored action is offered behind a gate (a phase state, a tag, a
predicate on the world) and consumed by code that re-checks whether the
thing is really ready. Two lists, two files. They start identical and drift.
When they disagree the action is offered, dispatched, and accepted — the
world really did fire the handle — and then quietly does nothing, because
the consumer's own guard refused. Nothing is written and nobody is told.

## Forces

- The gate must be cheap and world-readable: an affordance predicate can
  only see world state, so it reads a phase or a tag.
- The consumer usually holds richer state than the gate can see — process
  memory, a draft, a catalog — so it re-checks. That re-check is legitimate.
- A receipt of `accepted` means "the handle dispatched", not "the intent
  succeeded". Players and agents read it as the latter.
- Failing closed is right. Failing closed *silently* is what turns a
  disagreement into an unexplainable wedge.

## Solution

Export ONE function that answers "what is still missing", and use it in both
places: the guard returns early when it is non-empty, and the speaking or
reporting path renders it. Reserve the success line for a commit that
actually happened, so a refusal can never be mistaken for success.

```ts
/** Sole source for BOTH the reducer's guard and the DM's spoken rejection. */
export function missingConfirmKeys(state: DraftState): readonly string[] {
	const missing: string[] = [];
	if (state.classSlug === null) missing.push("a class");
	if (state.name === null) missing.push("a name");
	// …
	return missing;
}

// guard
if (missingConfirmKeys(state).length > 0) return state;   // unchanged, refused
return { ...state, confirmed: true };

// speech — same list, spoken
HasRejectedConfirm(): boolean { return this.confirmMissingKeys.length > 0 && sawPick; }
```

## Proof

`packages/spellkave-adventure-runtime/src/dm/creation/draft-state.ts`
(`missingConfirmKeys`, used by `reduceCreationDraft`'s confirm branch) and
`packages/spellkave-adventure-runtime/src/dm/creation/engine.ts`
(`HasRejectedConfirm` / `SpeakConfirmRejection`, fed the same list through
the agent's per-cycle context) share the **guard and the spoken rejection**.
Test: `packages/spellkave-srd-cc/src/test/offline/dm-creation.test.ts`,
"an incomplete confirm is SAID, not swallowed" — asserts the DM names every
open key and does NOT speak the closing line.

**The offer half is not shared yet.** The confirm offer is gated by a
different function, `creationStructuredDraftsComplete`
(`…/dm/creation/steps.ts:104-146`), which accepts "no kit" and "no skills"
when none remain to pick, while `missingConfirmKeys` always requires them.
That is this page's anti-pattern in the reference implementation (bug
`sk-jay0.1.49`).

## Related

- [`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md) — the wizard
  whose confirm this guards.
- [`watch-reader-manifest-closure`](./watch-reader-manifest-closure.md) — the
  sibling failure where a read answers "nothing found" instead of failing.

## Known misuse / anti-pattern

Speaking the success line off the *observed pick* rather than off the
*committed state*. That is the version of this bug that lies loudest: the
player hears "It's done. Welcome to the world." while no character exists.

Equally wrong: fixing the drift by loosening the consumer's guard so it
accepts whatever the gate offered. The guard usually knows more than the
gate; the answer is to share the guard's list with the gate, not to delete
it.

Also not a fix: a timer or watchdog that retries the wedged step. A watchdog
is the right tool for a genuinely missing wake-up signal; here the signal
arrives and the answer is wrong, so a cadence only hides the disagreement
behind a retry.

## SRD features that use this

- Kavemouth character creation's confirm: a one-slot runtime offer on
  `dm/dialog/choice/1` (the seeded `dm/creation/confirm` action is gated
  `1 == 0`, `…/dm/creation/seed.ts:800-809`), committed by the draft guard
  (six fixed keys plus the kit's equipment picks). Guard and speech share
  one list; the offer does not yet (see Proof).
