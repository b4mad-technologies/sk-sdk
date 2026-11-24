@persona:mcp-client
Feature: Log in to the PLAYER MCP gateway
  As the MCP client of a player (Claude.ai, an agent's MCP connector)
  I want to find where to log in and be let in only with a valid WorkOS token
  so that a player's world answers only to that player.

  The gateway is an OAuth protected resource (RFC 9728): it checks AuthKit
  access tokens against the issuer's published keys and runs no
  authorization server of its own.

  Background:
    Given the gateway runs

  @code:src/gateway.ts:createPlayerMcpGateway
  Scenario: An MCP request without a token is told where to log in
    The challenge points at the protected-resource metadata, which names the
    issuer to log in at. That is all a client needs to start OAuth.
    When I send "POST /mcp" with the MCP request "tools/list"
    Then the answer is 401
    And the header "www-authenticate" contains "resource_metadata=\"$MCP/.well-known/oauth-protected-resource\""

  @code:../spellkave-gateway-identity/src/resource-server.ts:protectedResourceMetadata
  Scenario Outline: "<path>" names the issuer as the only authorization server
    Both well-known paths answer, so a client finds the metadata whether it
    asks for the host or for the /mcp resource. The scopes are exactly
    openid, profile, email and offline_access: Claude.ai and WorkOS dynamic
    registration refuse unknown scopes such as "player:tools".
    When I send "GET <path>"
    Then the answer is 200
    And the JSON answer is:
      """json
      {
        "resource": "$MCP/mcp",
        "authorization_servers": ["$ISSUER"],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["openid", "profile", "email", "offline_access"]
      }
      """

    Examples:
      | path                                       |
      | /.well-known/oauth-protected-resource      |
      | /.well-known/oauth-protected-resource/mcp  |

  @code:src/gateway.ts:createPlayerMcpGateway
  Scenario Outline: "POST <path>" is not served: the issuer is the authorization server
    The three rows are the endpoints an OAuth authorization server owns
    (authorize, token, revoke); the gateway answers none of them.
    When I send "POST <path>"
    Then the answer is 404

    Examples:
      | path       |
      | /authorize |
      | /token     |
      | /revoke    |

  @code:../spellkave-gateway-identity/src/resource-server.ts:createPlayerJwtVerifier
  Scenario: A rotated signing key is fetched again, and its tokens are accepted
    AuthKit rotates keys; a token with a key id the gateway has not seen yet
    makes it fetch the issuer's keys once more instead of refusing.
    Given the gateway has accepted a token signed with the issuer's first key
    And the issuer rotated to a new signing key
    When I send the MCP request "tools/list" with a token signed with the new key
    Then the answer is 200
    And the issuer served its keys 2 times

  @code:../spellkave-gateway-identity/src/resource-server.ts:createPlayerJwtVerifier
  Scenario: A valid token is not refused while the issuer is down
    A good token must never be told it is bad because the gateway's own
    dependency is down. The answer is a 500, and the operations log says why.
    Given the issuer is down
    When I send the MCP request "tools/list" with a valid token
    Then the answer is 500
    And the JSON answer has "error" "server_error"
    And the gateway logged one "jwks_unavailable" line, for reason "initial"

  Rule: A token the gateway cannot trust is refused with 401 invalid_token

    The refusal names what is wrong, never the token itself. A token from
    another environment is refused on its issuer, without the key refetch an
    unknown key id causes: a flood of stale tokens cannot become a flood of
    key fetches.

    @code:../spellkave-gateway-identity/src/resource-server.ts:createPlayerJwtVerifier
    Scenario Outline: A token <token> is refused
      When I send the MCP request "tools/list" with a token <token>
      Then the answer is 401
      And the JSON answer has "error" "invalid_token"
      And the error description contains "<says>"
      And the answer does not contain the token
      And the issuer served its keys <fetches> times

      Examples:
        | token                          | says                                                                                  | fetches |
        | for another audience           | aud mismatch (want one of $MCP/mcp)                                                   | 1       |
        | that expired                   | Token has expired                                                                     | 1       |
        | from another issuer            | token issuer https://authkit.staging.example.test is not the configured issuer $ISSUER | 1       |
        | signed with a key it never saw | no JWKS key matches token kid stranger-key published by issuer $ISSUER                | 2       |

    @code:../spellkave-gateway-identity/src/logout-cutoff.ts:createWorkosLogoutCutoff @code:../spellkave-gateway-identity/src/resource-server.ts:createPlayerJwtVerifier
    Scenario: A token issued before the player signed out everywhere is refused
      Signing out on the login site writes `logout_after` into the player's
      WorkOS user metadata (ADR-0161 D-7). The gateway reads it, cached for
      30 s per player, and refuses an older token although it has not
      expired; a token issued after the sign-out is let in.
      Given WorkOS records that the player signed out everywhere 60 seconds ago
      When I send the MCP request "tools/list" with a token issued before the sign-out
      Then the answer is 401
      And the JSON answer has "error" "invalid_token"
      And the error description contains "token was issued before sign-out"
      When I send the MCP request "tools/list" with a valid token
      Then the answer is 200
      And WorkOS was asked about the player 1 time
