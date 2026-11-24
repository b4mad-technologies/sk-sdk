@persona:sim-player-operator
Feature: How authkit-refresh-token answers
  As the loop script that pipes the token into a client,
  I want exit 0 to mean "the token is on stdout" and anything else to print no token,
  so that a failed mint can never feed a client a broken token.

  The scenarios need the openssl CLI and the repository's tsx; AuthKit is a fake on 127.0.0.1.

  Rule: A refused mint exits 1, prints one "authkit-refresh-token:" line on stderr and no token, never echoes the refresh token, and leaves the runtime file as it was
    A seed with the User Management issuer would mint a second world identity
    (Identity = BLAKE3(iss|sub), ADR-0102 D-2). Today the command reads such a seed
    as missing, so its message is "no machine-user seed" (bug sk-jay0.5.17).

    @code:src/refresh-auth.ts:refreshAccessToken @code:src/refresh-auth.ts:assertAuthKitIssuer
    Scenario Outline: <case>
      Given the seed <seed>
      And AuthKit <authkit>
      When I run "authkit-refresh-token sim1"
      Then authkit-refresh-token exits with 1
      And stdout is empty, and stderr is one line that says "<says>"
      And stderr does not contain "rt-seed"
      And AuthKit received <requests> requests
      And there is no runtime file

      Examples:
        | case                                               | seed                                    | authkit                                          | requests | says                                                |
        | No seed: the error names the install command       | is missing                              | answers with the refresh token "rt-2"            | 0        | scripts/sim/install-machine-seed.sh --player sim1   |
        | A User Management issuer seed is never sent        | names the User Management issuer        | answers with the refresh token "rt-2"            | 0        | no machine-user seed or runtime record for 'sim1'   |
        | AuthKit refuses the grant, and its code is named   | holds the refresh token "rt-seed"       | refuses the grant with "invalid_grant"           | 1        | AuthKit refresh grant failed: HTTP 400 invalid_grant |
        | A token from another issuer is refused             | holds the refresh token "rt-seed"       | answers with a token from another issuer         | 1        | refresh grant returned foreign iss                  |
        | An access token that is not a JWT is refused       | holds the refresh token "rt-seed"       | answers with an access token that is not a JWT   | 1        | access token is not a JWT                           |
        | AuthKit is down                                    | holds the refresh token "rt-seed"       | is down                                          | 0        | AuthKit token endpoint unreachable                  |
