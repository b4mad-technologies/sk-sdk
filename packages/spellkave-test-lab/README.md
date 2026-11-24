# @spellkave/test-lab

Test helpers for TypeScript clients that exercise the Spellkave world API.
Use `connectTestWorld` for test connections, `scene` for prefixed test data,
and the helpers in `patterns.ts` to record before-and-after state.

```ts
import { connectTestWorld, scene, syncConnection } from "@spellkave/test-lab";
```

Run the offline tests with `pnpm --filter @spellkave/test-lab test`. They
use injected transports and file fixtures. The test-lab package depends on
the SDK and the world bindings.

A live consumer supplies a disposable world, its credentials, and its own
manifests. Set `SPELLKAVE_URL` and `SPELLKAVE_DB` for the connection.
`ensureWorldAuthority` accepts a `manifestPath` option or reads
`SPELLKAVE_TEST_AUTHORITY_MANIFEST`. Scope the manifest and publisher
credential to the disposable test world.

`syncConnection` needs a provider-supplied test barrier. It rejects when
that facility is unavailable. Run scenarios that need a barrier or
deterministic test randomness through the server's integration harness.
