@persona:player
Feature: Start playing through the MCP tools
  As a player who logged in through an MCP client
  I want to see the PLAYER tools, read the modding docs and be told where to
  claim a hero
  so that my client can start without knowing the world first.

  Every scenario here runs without a hero: a hero lives in a live world the
  gateway reaches over a SpacetimeDB subscription, which this offline suite
  does not have. What a player with a hero sees is proved by the live suites
  (`authority-tools.live.test.ts`, `parameterized-scenes.live.test.ts`).

  Background:
    Given the gateway runs

  @code:src/tools.ts:createPlayerMcpServer
  Scenario: A client connects and lists the PLAYER roster
    The roster is the canonical PLAYER contract list, in its order, between
    the public modding docs and the gateway's own feedback tool. Each tool
    keeps the contract's title, description, input schema and prompt hints,
    so a client sees the same tool as every other PLAYER surface.
    When I send the MCP request "initialize" with a valid token
    Then the MCP server is "spellkave-player"
    And its instructions mention each of:
      | phrase              |
      | persistent live     |
      | world_deltas        |
      | no out-of-band push |
      | world_events        |
      | session             |
      | no_session          |
      | in-world            |
    When I send the MCP request "tools/list" with a valid token
    Then the tools are the docs tool, the PLAYER contracts in order, and "spellkave_feedback"
    And each PLAYER tool carries its contract's title, description, schema and prompt hints

  @code:../spellkave-gateway-identity/src/world-router.ts:NO_SEAT_HINT
  Scenario: A player without a hero is pointed to the website
    The answer is a normal tool result, not an error: the client should tell
    the player what to do, not retry. Here no world is reachable, so no world
    holds a claim; a reachable world without a claim gives the same answer
    (world-router.test.ts).
    When I call the tool "spellkave_orient" with a valid token and the arguments:
      """json
      {}
      """
    Then the tool answers without an error
    And the tool's only text is "No hero claimed on any Spellkave server. Choose a server and hero at https://spellkave.com"

  @code:src/gateway.ts:createPlayerMcpGateway
  Scenario: The modding docs answer without a hero (AUTH-56)
    Docs are public: they need a login, but no seat and no world.
    When I call the tool "spellkave_docs" with a valid token and the arguments:
      """json
      { "doc": "patterns/container-with-loot", "full": true }
      """
    Then the tool answers without an error
    And the docs answer names the document "patterns/container-with-loot" with compatibility "unknown"

  Rule: A call the gateway can refuse by itself never reaches a world

    The evidence is the answer itself: a call that reached the world router
    would get the no-hero hint, and these get a refusal instead. Whether a
    seated player's daemon is called is outside this offline suite.

    @code:src/http.ts:createPlayerMcpHttpService
    Scenario Outline: A call with <call> is refused with <refusal>
      When I call the tool "<tool>" with a valid token and the arguments:
        """json
        <arguments>
        """
      Then the MCP answer is <refusal> saying "<says>"

      Examples:
        | call                     | tool                         | arguments                   | refusal                 | says                       |
        | malformed arguments      | spellkave_orient             | { "limit": "not-a-number" } | a tool error            | Input validation error     |
        | an unknown tool          | not-a-player-tool            | {}                          | JSON-RPC error -32602   | not found                  |
        | a docs id that is a file | spellkave_docs               | { "doc": "file:///private/world.toml" } | a tool error | file:///private/world.toml |
