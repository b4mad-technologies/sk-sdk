# Kernel schema fixtures

Frozen fixtures for `kernel_contract.test.ts` (sk-jay0.7.389.3): one module, its
encodings, captured from the same commit (`bc6cb91a93`, SpacetimeDB 2.10.1).

- `served-world-schema-2.10.1.json.gz`, `served-world-schema-2.10.0.json.gz` —
  `GET /v1/database/<db>/schema?version=10` from local `sk dev` nodes on
  SpacetimeDB 2.10.1 and 2.10.0 serving that
  commit's world module.
- `world-snapshot-at-capture.json.gz` — `packages/spellkave-bindings/contract/world.schema.json`
  at that commit (the wasm's own `__describe_module__`).

The test proves the one normaliser reads both encodings to the same snapshot.
The pair does not follow later schema changes; recapture it (`sk dev up`, curl
the endpoint, gzip both with `gzip -9 -n`) only when the served encoding
itself changes, for example on a SpacetimeDB upgrade.
