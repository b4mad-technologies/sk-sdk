# Session Node tests

Private offline tests for Session's client, daemon, protocol, spawning,
observability and manifest-error classification. They use local Unix sockets,
child processes and fake tool registries; no SpacetimeDB node is required.

```sh
bash scripts/ci/run-ci-js.sh --only session-node-tests
```

This workspace depends on `@spellkave/session`, so the existing pnpm changed-
package selector includes these tests when Session changes. It has no package
exports or product dependents: changes confined to these tests select this
workspace without selecting Session's product dependents. Keep reusable
runtime/test-lab helpers in their owning packages with declared dependencies.
The `check-session-node-test-ownership` `@spellkave/gates` registry gate
(`packages/spellkave-gates/src/gates/check-session-node-test-ownership.ts`)
enforces the private package surface and both directions of this
dependency-selection contract in CI.

Tests may import Session's internal source directly; the declared workspace
dependency records that relationship without expanding Session's public API.
Typechecking therefore has no `rootDir` constraint and emits no build output.

The mixed offline/live `world-events.test.ts` stays under
`packages/spellkave-session/src/node/__tests__/`. Live-tier selection remains
unchanged. Moving an additional test here requires checking its node needs and
source-scanning consumers; a `.test.ts` suffix alone does not establish ownership.
