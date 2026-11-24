# Caller MCP guidance evidence — AUTH-56-01/02

Verified for the captured implementation and disposable-node surface below. The current corpus may embed this earlier capture; its response metadata identifies that distinction. This is not deployed-service or external-application acceptance.

AUTH-56-01 — verified on caller-http-mcp-disposable-node sha256:c74484aada7842b443ad9e3a5cae022692999af12dd6d4e50af1eb09bc662359.

Test: packages/spellkave-mcp/src/__tests__/authority-tools.live.test.ts; implementation: 4c6f4f4f14fe42811c4df0048b94fde531f002a8; fixture: sha256:2cd93be3b6758fa383927b7cdd1b2135ef47049a47f36f869331a5feacec0c49; source: sha256:019754b682b4b3653bd869787e611e777bd2a03fa1f148f8a32ae421c0acae99; captured: 2026-10-07T07:31:11.421Z.

```json
{"mcp_request":{"method":"tools/call","params":{"name":"spellkave_docs","arguments":{"query":"container loot","limit":2}}},"exit_code":0}
```

```json
{"mcp_request":{"method":"tools/call","params":{"name":"spellkave_docs","arguments":{"doc":"patterns/container-with-loot","full":true}}},"exit_code":0}
```

```json
{"mcp_request":{"method":"tools/call","params":{"name":"spellkave_docs","arguments":{"doc":"hosted-authoring-workflow","full":true}}},"exit_code":0}
```

Historical capture summary: `spellkave_docs with {"doc":"evidence/auth-56-hosted-mcp-transcript","full":true}`.

AUTH-56-02 — verified on caller-http-mcp-disposable-node sha256:c74484aada7842b443ad9e3a5cae022692999af12dd6d4e50af1eb09bc662359.

Test: packages/spellkave-mcp/src/__tests__/authority-tools.live.test.ts; implementation: 4c6f4f4f14fe42811c4df0048b94fde531f002a8; fixture: sha256:2cd93be3b6758fa383927b7cdd1b2135ef47049a47f36f869331a5feacec0c49; source: sha256:019754b682b4b3653bd869787e611e777bd2a03fa1f148f8a32ae421c0acae99; captured: 2026-10-07T07:31:11.421Z.

```json
{"mcp_request":{"method":"tools/call","params":{"name":"spellkave_docs","arguments":{"doc":"hosted-authoring-guidance","full":true}}},"exit_code":0}
```

```json
{"mcp_request":{"method":"tools/call","params":{"name":"spellkave_docs","arguments":{"doc":"patterns/container-with-loot","section":"missing"}}},"exit_code":2}
```

```json
{"mcp_request":{"method":"tools/call","params":{"name":"spellkave_docs","arguments":{"doc":"patterns/container-with-loot","section":"Problem"}}},"exit_code":0}
```

Historical capture summary: `spellkave_docs with {"doc":"evidence/auth-56-hosted-mcp-transcript","full":true}`.

## Historical capture summary

Retrieve `evidence/auth-56-hosted-mcp-transcript` for the archived run’s identity, assertions and cost.

## Independent assertions and complete captured-run cost

```json
{
  "implementing_revision": "4c6f4f4f14fe42811c4df0048b94fde531f002a8",
  "corpus_revision": "sha256:019754b682b4b3653bd869787e611e777bd2a03fa1f148f8a32ae421c0acae99",
  "fixture_source_sha256": "2cd93be3b6758fa383927b7cdd1b2135ef47049a47f36f869331a5feacec0c49",
  "module_sha256": "c74484aada7842b443ad9e3a5cae022692999af12dd6d4e50af1eb09bc662359",
  "assertions": [
    {
      "scenario": "AUTH-56-01",
      "noAuthorityDocs": true,
      "presenceOnlyAuthorDocs": true,
      "hostedDmDocs": true,
      "sameCorpus": true,
      "privatePrincipalAndBindingAbsent": true,
      "untrustedWorldInstructionsAbsent": true,
      "noBindingOrSeatMutation": true,
      "noAuthorityContextDenied": true,
      "ownedDmContextAccepted": true
    },
    {
      "scenario": "AUTH-56-02",
      "plannedStoryNotVerified": true,
      "pathNotRead": true,
      "missingSectionRefused": true,
      "validSectionRecovery": true,
      "bindingsUnchanged": true
    }
  ],
  "cost": {
    "calls": 12,
    "retries": 0,
    "elapsed_ms": 176.0142909999995,
    "suite_elapsed_ms": 6001,
    "expected_refusals": 3,
    "request_bytes": 1596,
    "response_bytes": 109857,
    "schema_bytes": 4857,
    "token_accounting": {
      "package": "js-tiktoken",
      "version": "1.0.21",
      "encoding": "o200k_base",
      "request_tokens": 476,
      "response_tokens": 27632,
      "schema_tokens": 1134,
      "agent_context_tokens": 0,
      "model": null
    },
    "images": 0,
    "failed_attempts": 0,
    "basis": "All AUTH-56 successful-run RPC JSON frames after approved fixture/path redaction; schemas are a response subset. Publisher setup, other-owner scenarios, SDK subscriptions and HTTP headers/SSE wrapping excluded from text cost; elapsed time sums both Vitest scenario durations including independent postconditions, with suite elapsed recorded separately; earlier development attempts retained privately and not counted as consumer retries."
  },
  "limitations": [
    "Native caller-authenticated disposable-node HTTP/stdio transport, not deployed service or live WorkOS login",
    "Scripted proof, no unaided human/agent discovery or numeric efficiency threshold",
    "Captured corpus identity predates embedding this evidence; commands/test source must be revalidated when relevant contracts change"
  ]
}
```
