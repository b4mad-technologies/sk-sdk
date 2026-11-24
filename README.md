# Spellkave SDK

TypeScript clients, world authoring tools, the `sk` CLI, and the player MCP
gateway for building against the Spellkave world API. Use the world-only
`@spellkave/bindings` package for the wire schema and sk-grimoire's
`@spellkave/validate-wasm` and `@spellkave/authoring-wasm` packages for
offline authoring.

## Build and test

Use Node 24.22.1 or later within Node 24 and pnpm 11.13.1.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm --filter @spellkave/sdk generate:kernel-contract:check
pnpm --filter @spellkave/cli exec node bin/sk.js help
```

The default test command uses local fixtures and mocked transports. Live
integration suites require an explicitly configured world and, for some
cases, provider-supplied fixtures and test facilities. See the
[test-lab package](packages/spellkave-test-lab/README.md) for the helper
interfaces and the [CLI guide](packages/spellkave-cli/README.md) for plugin
configuration.

## Licence

The SDK uses [PolyForm Shield 1.0.0](LICENSE). See [NOTICE](NOTICE) for the
copyright notice and third-party attribution.

## npm releases

The proposed first SDK release is `v0.1.0`. The tag selects one npm version
for the content consumers and their runtime workspace dependencies. Published
packages include their TypeScript exports, including the generated authoring
corpus.

| Packages used directly by sk-content | Runtime dependencies shipped alongside them |
| --- | --- |
| `@spellkave/agent-observability`, `@spellkave/sdk`, `@spellkave/session`, `@spellkave/tool-authoring`, `@spellkave/tool-node`, `@spellkave/world-author`, `@spellkave/world-map` | `@spellkave/tool-contracts`, `@spellkave/tool-player`, `@spellkave/tool-runtime`, `@spellkave/world-events` |

[The SDK npm workflow](.github/workflows/sdk-npm.yml) builds, tests and verifies
installation from the packed tarballs on pull requests and pushes. A release
tag publishes those tarballs with provenance through npm Trusted Publishing.
CI uses the committed lockfile to install both sk-grimoire Wasm packages from npm.

### First-time npm setup

Install the workspace dependencies with `pnpm install --frozen-lockfile`.
Supply `NPM_TOKEN` with publish access to the `@spellkave` scope and run
`scripts/npm-setup bootstrap`. On a Vega host the maintainer can run
`vega secrets run --for sk-server -- scripts/npm-setup bootstrap`.
The script builds and publishes `0.0.0-bootstrap` with the `bootstrap` tag
for packages that are missing on npm. It uses a temporary npm user config.

An npm package maintainer then runs `npm login` and `scripts/npm-setup trust`
from an interactive terminal. Use a CLI that supports `npm trust`, such as
npm 11.19.1. Complete 2FA and select the five-minute skip option for the
remaining requests. Granular access tokens with 2FA bypass are unsupported
for this step. The script skips packages with a trusted publisher and adds
publish access for `b4mad-technologies/sk-sdk` via `sdk-npm.yml` on the
remaining packages. See the [npm trust command](https://docs.npmjs.com/cli/commands/npm-trust/).
