# Hosted-world observability for authors

A world you own on the hosted runtime has a **scoped** observability
surface on the Account page (`account.spellkave.com`). It answers "what
are my NPCs doing" and "did that tool call fail" for **your** worlds
only.

The hosted Account page is the author-facing observability surface (ADR-0108
D-2). The browser talks to `/v1/author/worlds/{slug}/observability/*` on
the Account API; that process queries the sink with the operator
credential and drops any row whose `world_slug` is missing or is not
the owned slug (ADR-0117).

## What you can see

- NPC cycle health per seat (count, error count, average duration, last seen).
- `tool_call` outcomes, split ok/error, with tool names from the
  adventure-declared roster (`metricsVocabulary` / tool-contracts).
  Unlisted names collapse to `other`.
- Recent run events with the OTLP-safe field allowlist
  (`OTEL_SAFE_EVENT_DATA_FIELDS`), including `cause_id` when present.

## What you cannot see

- Another author's world, even if you are a member of it.
- Rows that never received a world slug (they are dropped, not shown).
- Player speech, intents, raw OAuth subjects, tool arguments, or the
  sink URL/credential.
- A composable dashboard builder. The panels are curated; Perses is not
  the author surface.

Players remain on `spellkave_feedback`. Local JSONL run artifacts stay
the local/CI record (ADR-0074) and are not this hosted view.

Binding decision: ADR-0117 (author-scoped observability is a control-plane
read, not a sink login).
