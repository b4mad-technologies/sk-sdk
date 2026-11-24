# Containment exposure and access

Containment remains the physical `entity_containment` relation. Narrative ownership
remains `entities.owned_by_entity_key`; changing either relation does not implicitly
change the other. A perceived container can expose loose direct children through
an authored policy. Ownership does not grant exposure.

## Authoring

Three optional manifest row families attach deterministic predicates:

```toml
[[containment_policy_definition]]
bundle_id = "example"
policy_id = "example/contents"
exposure_predicate_source = "target.state('example/exposed')"
access_predicate_source = "target.state('example/accessible')"

[[entity_definition_containment_policy]]
bundle_id = "example"
entity_def_id = "example/container"
policy_id = "example/contents"

[[entity_containment_policy]]
bundle_id = "example"
entity_key = "example/special_container"
policy_id = "example/contents"
```

This fragment assumes the bundle, entity definition, entity and Boolean state
vocabulary already exist. Author the states and their values through the existing
object-state contract. The definition attachment applies to every instance of that
exact definition, including entities created at runtime without manifest keys.
An instance attachment takes precedence. An absent instance attachment falls back
to the definition; a dangling or false instance policy denies rather than falling
back. Retracting the instance attachment restores the definition policy.

Both predicates bind `actor` to the observing or acting body and `target` to the
container. They admit Boolean/integer literals, comparisons, logical and arithmetic
expressions, explicit `stat`/`state` reads, tags and conditions on these two subjects.
Use `true == true` or `false == true` for constant predicates. Stochastic draws,
source/effective-resource reads, other subjects and unbound inputs are rejected by
the shared validator. Missing state or evaluation errors deny.

Explicit Boolean entity state uses the shared Actor/Target fact collector used
by manipulation predicates. A missing `object_state` row is not an authored
`false`; author a value when a predicate requires one. Policies read entity
state only, without the place-state defaults that manipulation can also read.
The kernel live `container-policy.local-node.test.ts` pins both consumers for
missing, false and true values on each subject.

Exposure and removal access are separate. For example, an open display case can
expose its contents while its access predicate refuses removal. Author lockpicking
or theft alternatives inside the access predicate using ordinary state, tags or
conditions. There is no kernel-specific lock, lid or theft concept.

## Player reads and actions

`readContainerContents(db, actor, containerRef)` in `@spellkave/sdk/readers` returns
`container_ref`, `scope: "direct"`, `revision`, `status` and `items`. Items carry
`target_ref: "item:<id>"`, `parent_ref`, `name`, `quantity` and `entity_def_id`.
Subscribe using `containerContentsManifest` from that entry point.

Statuses distinguish `available`, exposed `empty`, `unavailable` and `truncated`.
Absent policy, unperceived containers, unready projections and older modules all
produce `unavailable` without hidden child counts or identities. Revisions hash
only the disclosed content and completeness. The projection admits each ancestor
before reading children, excludes slotted/machine-port rows, and limits traversal
to depth 64 and 512 disclosed edges per perceiver.

Supported pickup from a perceived grounded non-body container checks exposure and
access before spending economy or applying writes, then checks again at mutation.
The existing structural restrictions remain: this does not enable nested pickup
or transfer from another body's inventory. Removal from the actor's existing
possession boundary is outside the access gate, preserving supported equip,
consume and drop operations without a policy on the actor's body. See-as and
narrative ownership alone do not confer this exception.

## Diagnostics and release

`spellkave containment policies`, `definition-bindings` and `instance-bindings`
inspect private authoring data through the existing publisher-only SQL bridge.
`contents <perceiver> <container>` and `coverage <perceiver> <container>` read the
caller's admitted views. `raw-contents` and `raw-coverage` are operator-only.

Doctor reports unresolved policy attachments, loose-child containers lacking a
resolvable policy, and inconsistent materialized edges/coverage. Missing coverage
is a release-blocking error. Offline validation keeps existing initial-containment
recipes editable; runtime doctor checks the containers those recipes create.
An explicit deny policy satisfies coverage while keeping contents undisclosed. Keep diagnostic identities out of player output.

Ship the module with definition policies for the ruleset's runtime-created bodies,
bags and corpses and the adventure's instance overrides. Apply attachments to a
preserved world; do not reinitialize played containment or state. Rehearse the
upgrade and doctor report together. Removing policies revokes public contents;
rollback requires module/schema compatibility and the matching content revision.

## Connected authoring validation

When a connected author target already supplies a dependency policy, attachments
can reference it without copying its definition into the workspace. Policy
predicates likewise resolve state, tag and condition identifiers against the
target's existence/ownership vocabulary. The shared Rust validator still checks
the author's declared dependency closure; missing or out-of-closure references
remain MF-VAL-391. Target rows are validation context only and are never persisted
as authored rows. Existing dependency condition and policy DSL is not reconstructed
or revalidated. Offline validation without a target remains closed-world.

Proof: `packages/spellkave-tool-authoring/src/__tests__/containment-target.test.ts`
(the `ci-js` tool-authoring offline owner). The context is part of the validation
cache key, so changing the target cannot reuse diagnostics from a previous target.
