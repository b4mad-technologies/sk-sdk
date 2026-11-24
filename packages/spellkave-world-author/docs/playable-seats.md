# Discovering playable seats

An Explorer inventory describes rows admitted by its chosen source. An authored
body kind such as `player`, an actor row, or an arbitrary `playable` tag does
not establish current seat availability or human control. The Explorer does
not project live seat state. A zero tag search only means that tag did not
match in the searched collection and reader scope.

Start with `sk explore summary --source local`. Its default `srd.player_character`
tag row counts admitted definitions and distinct objects separately. `>=1` means
at least one match in an incomplete projection; `0` is exact only for complete
coverage. Definition tags are not inherited onto instances. Override the counted
tag with `summary --tag <tag>`; this is authored metadata, not a seat-status query.
The inventory line explains objects versus technical body, controller and tag rows.
File and live counts can differ because live reads a caller-visible authored
projection, which may omit contained/runtime bodies and projects catalogs separately.

`sk docs playable-seats` prints this guidance as text; an explicit
`sk --format jsonl docs playable-seats` retains its metadata envelope.

## Authored offers in an SRD world

The existing SRD seat contract uses the tag `srd.player_character` on an
entity or its definition. Inspect authored offers with:

```sh
sk explore search --collection definitions --tag srd.player_character --source local
sk explore search --kind entities --tag srd.player_character --source local
```

Keep the coverage stated by each answer: definitions can hit a fixed reader
bound, and local authored rows do not prove a runtime body exists. Creation
Candidate is a reusable definition; opening a creation seat can create its
body later. Do not add the tag merely to host an NPC: it also grants SRD
capabilities. These are SRD conventions, not a universal body classification.

## Current live seats

The existing public `seat` table carries `actor_id`, `entity_id`, `name`,
`embodied` and `claimed`, without occupant identity. The existing Rust CLI
reads it with `spellkave seat list`; use that CLI's connection configuration
for the intended world. The SDK equivalent is `readSeats`.

`sk explore` currently has no equivalent seat-status query. Its authored
inventory cannot answer whether a particular body is currently claimable,
claimed, online, or human-controlled. Read the live seat surface for the
first two facts; a seat row alone does not establish online or human control.

The detailed existing contract is in
[actor identity bindings](repairs/actor-identity-bindings.md), including claim
lifetime and the `seat_catalog_readable` doctor check. Reading seats does not
claim, release, or modify them.
