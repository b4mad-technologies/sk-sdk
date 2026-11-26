# Seed a running world: `sk seed`

`sk seed` loads compiled world manifests into a running world module. Use it
to fill a fresh world with a ruleset and an adventure, or to add one more
bundle to a world that already has content.

```sh
sk seed <root>... [--tolerate-applied] [--dry-run]
```

A **root** is a manifest file, or a directory that contains `manifest.toml`.
The command reads the root and every file its `[[include]]` entries name,
joins them into one TOML document and sends that document as one
whole-manifest apply.

## Example: a ruleset and an adventure

The public [sk-content](https://github.com/b4mad-technologies/sk-content)
repository holds an SRD ruleset, a shared DM bundle and the Elven Mini
adventure. Its README lists each bundle's entry point and dependencies. With a
world module running locally and that repository checked out beside you:

```sh
export SPELLKAVE_URL=http://127.0.0.1:3000
export SPELLKAVE_DB=my-world

# Check what would be sent. Connects to nothing.
sk seed --dry-run \
  sk-content/packages/spellkave-srd-cc/fixtures \
  sk-content/packages/spellkave-srd-cc/fixtures/dm \
  sk-content/packages/spellkave-adventure-elven-mini/fixtures/adventure.manifest.toml

# Send it.
sk seed \
  sk-content/packages/spellkave-srd-cc/fixtures \
  sk-content/packages/spellkave-srd-cc/fixtures/dm \
  sk-content/packages/spellkave-adventure-elven-mini/fixtures/adventure.manifest.toml
```

Roots are applied **in the order given**. Name dependencies first: the
ruleset, then shared content, then the adventure. `sk seed` does not read
`depends_on` and does not reorder roots.

## Which world, and as whom

`sk seed` uses the author connection, the same one as `sk --live`,
`sk diff -k` and `sk apply -k`:

1. `--profile <name>`,
2. else `SPELLKAVE_URL` and `SPELLKAVE_DB` from the environment,
3. else the current context (`sk config use-context <name>`).

`sk config view` shows which one wins and why. The credential comes from the
profile, from `SPELLKAVE_CONNECT_TOKEN`, or from the local client
configuration for that URL and database. The command never prints it.

The identity of that connection must be allowed to apply a world manifest. On
a fresh local module this is the identity that published the module. The
server resolves the `$sender` macro in a manifest to this identity.

## Transport

The manifest travels over the websocket connection as one reducer call. The
HTTP call route is not used: its request body limit refuses a large ruleset
manifest with HTTP 413. The flattened SRD ruleset is about 11 MB.

The reducer only queues the apply. `sk seed` then waits until the world
reports the result: a new sealed manifest digest (success) or a failure
outcome with its `MF-*` code (refusal). A large ruleset can take a while.

## Flags

| Flag | Effect |
| --- | --- |
| `--dry-run` | Read and flatten every root, print size and SHA-256, connect to nothing. |
| `--tolerate-applied` | A root the world has already sealed counts as success. Use it to rerun a sequence after one root failed. |

## What you get back

One `seed_root` record per root, then one `seed_result` record
(`--format jsonl` for scripts):

```json
{"kind":"seed_root","root":"rules","includes":12,"bytes":48211,"sha256":"…","status":"applied","digest":"…"}
{"kind":"seed_result","ok":true,"db":"my-world","roots":1,"applied":1,"already_applied":0}
```

- `status` is `planned` (dry run), `applied`, `already_applied` or `failed`.
- `sha256` is the hash of the text that was sent. `digest` is the seal the
  server reports. They differ: the server resolves macros and renders the
  manifest again before it seals.
- A `failed` record carries the server's `detail` and, when the server
  recorded one, its `code`.

| Exit | Meaning |
| --- | --- |
| 0 | Every root was applied (or tolerated as already applied). |
| 2 | The server refused a root. Earlier roots stay applied; later roots were not sent. |
| 1 | Usage error, unreadable root, missing include, or connection failure. |

All roots are read before the first one is sent. An unreadable root or a
missing include file stops the run with nothing applied.

`sk seed` sends what is on disk and does not validate it first. To check a
bundle offline, run `sk validate <root> --bundle --dep <dependency>...`.

## `sk seed` or `sk apply -k`?

- `sk seed` is the first load: whole manifests, in order, no comparison with
  what the world holds. It records no applyset memory.
- `sk apply -k <root>` is the maintained path for content you keep editing: it
  compares the root with the world, applies the difference and remembers what
  the applyset owns, so a later apply can prune removed rows.

## Known gap: world API epoch

This SDK is built against `@spellkave/bindings` 2.1.0, which describes world
API **epoch 2**. `sk seed` is built and tested against that epoch. It has
**not** been run against a world module of a newer epoch.

What is known about a newer module (epoch 3):

- The pieces `sk seed` uses still exist there under the same names: the
  whole-manifest apply reducer, which takes the manifest text as its one
  argument, and the two result tables it waits on.
- Before the SDK opens the websocket it compares the served module with its
  own epoch 2 contract. A missing table or reducer that the SDK relies on, or
  a changed row or argument shape, stops the connection with a binding drift
  or binding shape error. Nothing is sent in that case.
- The shape check is strict by default. `SPELLKAVE_SHAPE_CHECK=warn` turns a
  shape mismatch into a diagnostic and connects anyway. Use it for a seed
  only when the reported mismatches do not touch the apply reducer or the
  manifest apply tables.

The gap closes when bindings for the newer epoch are published and this SDK
moves to them. The apply call sits behind one seam for that reason:
`SeedTarget.applyWorldManifest` in `src/seed.ts`, implemented by
`seedTargetFromSession`. A changed apply call changes that function only.
