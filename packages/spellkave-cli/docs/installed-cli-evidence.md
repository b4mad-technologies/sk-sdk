# Installed CLI candidate evidence — AUTH-56-01

## Scope

Historical partial capture for the named unpublished candidate. This does not
verify a later corpus, hosted delivery, live behavior or a public release.
The guide projection below is scoped to that artifact alone.

## Captured commands

AUTH-56-01 — verified on installed-cli-local-candidate fd23f72e8e43a722c89c8597a0fa88ea4b8a92bcace422cece83a9cb8cd95e3d.

Test: packages/spellkave-cli/scripts/prove-portable.mjs; implementation: artifact-sha256:fd23f72e8e43a722c89c8597a0fa88ea4b8a92bcace422cece83a9cb8cd95e3d; fixture: docs-only; no world fixture; source: sha256:702b2270c5d0fdd24fd2f0e90d84a2478e43286cfce4724fe02538da79e03b87; captured: 2026-10-01T21:12:01.914Z.

```json
{"argv":["docs","--query","container loot"],"exit_code":0}
```

```json
{"argv":["docs","patterns/container-with-loot","--full"],"exit_code":0}
```

```json
{"argv":["docs","find-an-authoring-pattern"],"exit_code":0}
```

## Historical assertions and cost

The archived capture retains the full responses. This summary records what the earlier candidate was tested against.

```json
{
  "capture": {
    "scenario": "AUTH-56-01",
    "test": "packages/spellkave-cli/scripts/prove-portable.mjs",
    "state": "proven",
    "implementing_revision": "artifact-sha256:fd23f72e8e43a722c89c8597a0fa88ea4b8a92bcace422cece83a9cb8cd95e3d",
    "fixture_revision": "docs-only; no world fixture",
    "source_revision": "sha256:702b2270c5d0fdd24fd2f0e90d84a2478e43286cfce4724fe02538da79e03b87",
    "surface": "installed-cli-local-candidate",
    "surface_revision": "fd23f72e8e43a722c89c8597a0fa88ea4b8a92bcace422cece83a9cb8cd95e3d",
    "tested_at": "2026-10-01T21:12:01.914Z",
    "assertions": [
      "task search returns a bounded hit for the selected pattern",
      "pattern, focused guide, CLI-owned workflow and complete example share the installed corpus revision",
      "sk skill path resolves the thin installed discovery projection",
      "AUTH-56-02 planned hosted guidance stays planned and outside supported discovery",
      "unknown URL-like ID and unknown section refuse distinctly; valid-section retry succeeds",
      "documentation consumer leaves isolated working directory and product home unchanged"
    ],
    "evidence_doc": "evidence/auth-56-installed-cli"
  },
  "cost": {
    "calls": 11,
    "retries": 1,
    "failed_attempts": 0,
    "expected_refusals": 2,
    "elapsed_ms": 13494.02625,
    "request_bytes": 655,
    "response_bytes": 101213,
    "schema_bytes": 0,
    "token_accounting": {
      "package": "js-tiktoken",
      "version": "1.0.21",
      "encoding": "o200k_base",
      "request_tokens": 189,
      "response_tokens": 24003,
      "schema_tokens": 0,
      "basis": "UTF-8 JSON {argv,stdin} requests; sanitized stdout+stderr responses, per call; no CLI schema transmitted",
      "agent_context_tokens": 0,
      "model": null
    },
    "image_accounting": {
      "images": 0,
      "tokens": 0
    }
  },
  "limitations": [
    "local unpublished platform-specific artifact; no registry/public release proof",
    "no hosted delivery or live world admission proof",
    "public evidence-link publication remains pending"
  ]
}
```
