@persona:website
Feature: Call the gateway from a browser
  As a browser page (claude.ai, the spellkave.com website, a map editor)
  I want my allowed origin to get CORS answers, and anything else refused
  so that a player's token works only from pages the player trusts.

  The default origin allowlist is the canonical host, claude.ai and the
  website (spellkave.com, www.spellkave.com, localhost). A deployment that
  sets SPELLKAVE_MCP_ALLOWED_ORIGIN_HOSTNAMES replaces it; the canonical host
  and the website hosts stay in the list either way. Map tiles and the OSM API
  under /w/<slug> answer any origin, because map editors run anywhere; they
  still need a login.

  Background:
    Given the gateway runs

  @code:src/mcp-cors.ts:withMcpCors
  Scenario: An allowed origin's preflight is answered without a token
    A browser sends the preflight without credentials, so it must not need
    one. The default allowlist is the canonical host, claude.ai, spellkave.com,
    www.spellkave.com and localhost.
    When I send "OPTIONS /mcp" from "https://claude.ai" asking for "authorization, content-type"
    Then the answer is 204
    And the CORS headers are:
      | header                           | value                          |
      | access-control-allow-origin      | https://claude.ai              |
      | access-control-allow-methods     | POST, GET, DELETE, OPTIONS     |
      | access-control-max-age           | 600                            |
      | vary                             | Origin                         |
    And the header "access-control-allow-headers" contains "Authorization"
    And the header "access-control-allow-headers" contains "Mcp-Session-Id"
    And the header "access-control-expose-headers" contains "Mcp-Session-Id"
    And there is no header "access-control-allow-credentials"

  @code:src/mcp-cors.ts:withMcpCors
  Scenario: An origin the deployment allows gets its CORS headers on the MCP answer
    The deployment's own list (here one chat front end) is what counts, not
    the default one.
    Given the deployment allows the origins "chat.spellkave.com"
    When I send the MCP request "tools/list" with a valid token from "https://chat.spellkave.com"
    Then the answer is 200
    And the header "access-control-allow-origin" is "https://chat.spellkave.com"
    And the header "access-control-expose-headers" contains "Mcp-Session-Id"
    And the header "vary" is "Origin"
    And there is no header "access-control-allow-credentials"

  Rule: A request a trusted page would not send is refused before it is read

    @code:src/gateway.ts:createPlayerMcpGateway
    Scenario Outline: A request <with> is refused with <status>
      The gateway refuses these before the MCP layer reads them; a body over
      1 MiB is too large.
      When I send the MCP request "tools/list" with a valid token <with>
      Then the answer is <status>
      And there is no header "access-control-allow-origin"

      Examples:
        | with                          | status |
        | from "https://evil.example"   | 403    |
        | as "text/plain"               | 415    |
        | padded to 2 MiB               | 413    |

    @code:src/mcp-cors.ts:withMcpCors
    Example: A preflight from another origin is refused
      When I send "OPTIONS /mcp" from "https://evil.example" asking for "authorization"
      Then the answer is 403
      And there is no header "access-control-allow-origin"

  Rule: Public transcripts are for logged-in spectators of public worlds

    @code:src/transcript-http.ts:servePublicTranscript
    Scenario Outline: A transcript request <case> answers <status>
      When I send "GET /transcripts/<slug>" from "https://spellkave.com" <who>
      Then the answer is <status>
      And the header "access-control-allow-origin" is "https://spellkave.com"
      And the answer contains "<body>"

      Examples:
        | case                | slug         | who                | status | body          |
        | without a token     | elven-mini-1 | anonymously        | 401    | invalid_token |
        | with a token        | elven-mini-1 | with a valid token | 200    | tool_call     |
        | for a private world | private-1    | with a valid token | 404    | Not found     |

    @code:src/transcript-http.ts:servePublicTranscript
    Example: The website's transcript preflight needs no token
      Transcripts have their own CORS policy: only the website's hosts, and
      `authorization` as the one request header, not the MCP allowlist.
      When I send "OPTIONS /transcripts/elven-mini-1" from "https://spellkave.com" asking for "authorization"
      Then the answer is 204
      And the header "access-control-allow-headers" contains "authorization"

  Rule: Map clients from any origin are challenged, and unknown worlds do not exist

    @code:src/tiles.ts:handleWorldTilesRequest
    Scenario Outline: "GET /w/<slug>/tiles.json" <case> answers <status>
      When I send "GET /w/<slug>/tiles.json" from "https://josm.openstreetmap.de" <who>
      Then the answer is <status>

      Examples:
        | case                           | slug         | who                | status |
        | without a token                | elven-mini-1 | anonymously        | 401    |
        | for a world not in the catalog | nope         | with a valid token | 404    |
