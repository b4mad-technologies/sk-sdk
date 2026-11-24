@persona:operator
Feature: How the PLAYER MCP gateway answers
  As anyone who calls or runs the gateway
  I want one shape for its answers and its refusals to start
  so that a client and a deployment can rely on it without reading the code.

  Rule: An MCP answer is one JSON-RPC message in a server-sent event

    The gateway is a stateless Streamable HTTP MCP server: each POST /mcp
    gets one `event: message` whose data is the JSON-RPC reply to the same
    id. Every answer, MCP or not, carries an x-request-id the operations log
    repeats.

    @code:src/http.ts:createPlayerMcpHttpService
    Example: tools/list answers in one "message" event
      Given the gateway runs
      When I send the MCP request "tools/list" with a valid token
      Then the answer is 200
      And the header "content-type" is "text/event-stream"
      And the answer is one "message" event with the JSON-RPC reply to id 1
      And the answer has an "x-request-id" header

  Rule: A configuration the deployment contract forbids stops the gateway before it listens

    Exit 1, and stderr names the setting. A deployment (any canonical origin
    that is not loopback) keeps the fixed port 8080; only a loopback origin
    (a developer machine, this suite) may move it.

    @code:src/runtime.ts:loadPlayerMcpRuntimeConfig
    Scenario Outline: The gateway refuses to start when <problem>
      When I start the gateway with <setting> set to "<value>"
      Then the gateway exits with 1
      And the gateway logged "<says>"

      Examples:
        | problem                            | setting                        | value                    | says                                       |
        | the world catalog is not named     | SPELLKAVE_WORLD_CATALOG        |                          | SPELLKAVE_WORLD_CATALOG is required        |
        | a deployment asks for another port | SPELLKAVE_MCP_CANONICAL_ORIGIN | https://mcp.example.test | SPELLKAVE_MCP_LISTEN_PORT must remain 8080 |
