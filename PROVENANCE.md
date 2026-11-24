# Source and dependency provenance

The initial SDK source was copied with Git archive from Spellkave
`686a27e90a3330216ebc1a11d1a3b7b762bcbf11`. The selected TypeScript packages
and small SDK fixture inputs form a fresh history. The current workspace
replaces monorepo CI dispatch with pnpm and resolves the provider schema and
Wasm from their npm package contracts.

## Published provider dependencies

| Artifact | Source |
| --- | --- |
| `@spellkave/bindings@2.1.0` | Public npm release, world entry point, world schema and epoch |
| `@spellkave/authoring-wasm@0.1.0` | sk-grimoire npm release with [npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/@spellkave%2fauthoring-wasm@0.1.0) |
| `@spellkave/validate-wasm@0.1.0` | sk-grimoire npm release with [npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/@spellkave%2fvalidate-wasm@0.1.0) |

The lockfile records integrity hashes for the published tarballs. The Wasm
packages expose separate Node and browser entries. The authoring corpus is
generated in the SDK workspace from checked-in documents and examples.

## Fixture ownership

Cross-corpus coverage for SRD catalogue and bundle manifests, the Elven Mini
authoring excerpt, reference roles, adventure map export and backdrop
assets belongs with the content fixture owner. The matching files and
scenarios remain in the frozen source revision for that migration. The SDK
covers the generic catalogue, map, manifest and transport behavior using
small local inputs.

The server and NPC host maintain fixtures that use their private test
interfaces. Likewise, provider schema release checks and platform CLI
plugins belong with the corresponding providers. The SDK owns client-side
world schema compatibility, the plugin interface, and the behaviour
framework.
