@persona:sim-player-operator
Feature: Mint an access token for a simulated player
  As an operator who runs simulated players, or the loop script that mints their tokens,
  I want one command that turns a player's installed seed into a fresh AuthKit access token,
  so that the player signs in as the same world identity as an interactive login.

  AuthKit rotates the refresh token on every use, so the command keeps the live one in a
  runtime file and never writes back to the provisioned seed. The
  scenarios need the openssl CLI and the repository's tsx; AuthKit is a fake on 127.0.0.1.

  @code:src/bin/authkit-refresh-token.ts @code:src/refresh-auth.ts:mintMachineAccessToken
  Scenario: A seeded player gets a token, and the rotated refresh token goes to the runtime file
    The grant goes to the AuthKit-domain endpoint with the MCP resource, so iss, aud and
    sub match an interactive login. `authkit-refresh-token sim1 > token` is safe: stdout
    holds only the token. The rotated refresh token goes to the runtime file
    ~/.config/spellkave/sim-players/<player>.json (mode 0600); the seed stays as installed.

    Given the seed holds the refresh token "rt-seed"
    And AuthKit answers with the refresh token "rt-2"
    When I run "authkit-refresh-token sim1"
    Then authkit-refresh-token succeeds
    And stdout is the access token AuthKit issued, and stderr is empty
    And AuthKit's last request was a refresh grant spending "rt-seed"
    And the runtime file holds the refresh token "rt-2", readable only by me
    And the seed still holds the refresh token "rt-seed"

  @code:src/refresh-auth.ts:readRecordFile
  Scenario: The next run spends the rotated token, not the seed
    Once the runtime file exists it wins over the seed, so AuthKit's rotation chain continues.

    Given the seed holds the refresh token "rt-seed"
    And AuthKit answers with the refresh token "rt-2"
    And I ran "authkit-refresh-token sim1" once
    And AuthKit answers with the refresh token "rt-3"
    When I run "authkit-refresh-token sim1"
    Then authkit-refresh-token succeeds
    And AuthKit's last request was a refresh grant spending "rt-2"
    And the runtime file holds the refresh token "rt-3", readable only by me
