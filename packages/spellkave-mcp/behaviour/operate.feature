@persona:operator
Feature: Run and watch the gateway
  As the operator of a Spellkave deployment
  I want the gateway to start from its configuration, report honest health
  and log every request without secrets
  so that I can roll it, probe it and debug it without reading tokens.

  @launcher @code:bin/spellkave-player-mcp.js
  Scenario: The gateway starts from its front door and stops on SIGTERM
    The container runs bin/spellkave-player-mcp; its health check runs
    bin/spellkave-player-mcp-health against the same environment. The stop
    is clean, but through this tsx launcher the process still exits 143
    (128 + SIGTERM), not the 0 the runtime sets; plain node exits 0
    (bead sk-jay0.6.116). Until that is fixed, the log line is the promise.
    Given the gateway runs from its front door
    Then the gateway logged "spellkave-player-mcp: ready (trust-boundary=network-policy)"
    When I run the health check
    Then the health check exits with 0
    When I stop the gateway with SIGTERM
    Then the gateway logged "spellkave-player-mcp: stopping after SIGTERM"

  @code:src/runtime.ts:createIssuerReadiness
  Scenario Outline: The gateway is <status> while the issuer <state>
    Readiness means "can check tokens": it needs the issuer's keys and no
    player session, so a fresh gateway is ready before the first login. The
    answer names no dependency, URL or reason. Both outages occur: AuthKit
    answering with no keys (a broken rotation) and AuthKit not answering.
    Given the gateway runs
    And the issuer <state>
    When I send "GET /healthz"
    Then the answer is <code>
    And the JSON answer is:
      """json
      { "service": "spellkave-player-mcp", "status": "<status>" }
      """
    When I run the health check
    Then the health check exits with <exit>

    Examples:
      | state               | code | status      | exit |
      | publishes its keys  | 200  | ok          | 0    |
      | publishes no keys   | 503  | unavailable | 1    |
      | is down             | 503  | unavailable | 1    |

  @code:src/runtime.ts:startPlayerMcpRuntime
  Scenario: The MCP host does not serve the Account API
    The Account and Admin API is its own service at api.spellkave.com
    (ADR-0124). The MCP host answers its routes with 404, even to a valid
    token (sk-jay0.5.18).
    Given the gateway runs
    When I send "GET /v1/account" with a valid token
    Then the answer is 404

  @code:src/gateway.ts:createPlayerMcpGateway
  Scenario: The operations log names each request's route, never its token or query
    One JSON line per request on stderr, joined to the answer by its
    x-request-id. The route is a pattern; the query string and the bearer
    token never reach the log.
    Given the gateway runs
    When I send "POST /mcp?token=should-not-leak" with the MCP request "tools/list" and a valid token
    Then the answer is 200
    And the gateway logged an "http_request" line for this answer with:
      | field  | value    |
      | method | POST     |
      | route  | /mcp     |
      | status | 200      |
      | auth   | accepted |
    And the gateway's log does not contain "should-not-leak"
    And the gateway's log does not contain the token
