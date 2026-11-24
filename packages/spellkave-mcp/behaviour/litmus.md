# Litmus: can an agent answer from the guide alone?

Give a fresh agent only `docs/guide.md` and `docs/scenarios.md`, ask each
question, and require a quoted source or "NOT IN GUIDE". Pass: at most one
miss, no invented route or command.

| # | Question | Expected answer |
|---|---|---|
| 1 | My MCP client got a 401 from `POST /mcp`. How does it find where to log in? | The `WWW-Authenticate` header names `resource_metadata="<origin>/.well-known/oauth-protected-resource"`; that metadata names the issuer as the only authorization server. |
| 2 | Which OAuth scopes does the gateway advertise? | `openid`, `profile`, `email`, `offline_access` (no custom scope such as `player:tools`). |
| 3 | Does the gateway serve `/authorize` or `/token` itself? | No: `POST /authorize`, `/token`, `/revoke` answer 404; the issuer (WorkOS AuthKit) is the authorization server. |
| 4 | A player's token is valid but AuthKit is down. What does the client see? | 500 with `"error": "server_error"`, not a 401; the gateway logs one `jwks_unavailable` line (reason `initial`). |
| 5 | A token from the staging AuthKit reaches the gateway. What is the answer? | 401 `invalid_token`, description `token issuer https://authkit.staging.example.test is not the configured issuer …`; the token itself never appears. |
| 6 | A logged-in player with no hero calls `spellkave_orient`. What happens? | A normal (non-error) tool result whose only text is "No hero claimed on any Spellkave server. Choose a server and hero at https://spellkave.com". |
| 7 | Can a player read the modding docs (`spellkave_docs`) without a hero? | Yes: docs need a login but no seat or world (AUTH-56). |
| 8 | Which browser origins get CORS answers on `/mcp` by default? | The canonical host, claude.ai and the website (spellkave.com, www.spellkave.com, localhost); more via `SPELLKAVE_MCP_ALLOWED_ORIGIN_HOSTNAMES`. Others get 403 with no `Access-Control-Allow-Origin`. |
| 9 | What does `GET /healthz` answer while the issuer publishes no keys? | 503 `{"service":"spellkave-player-mcp","status":"unavailable"}`; the health check exits 1. |
| 10 | Does the operations log contain the bearer token or the query string? | No: one JSON line per request on stderr with method, route pattern, status and auth, joined to the answer by `x-request-id`. |
| 11 | Can a deployment run the gateway on port 9000? | No: with a non-loopback canonical origin it refuses to start, `SPELLKAVE_MCP_LISTEN_PORT must remain 8080`, exit 1. |
| 12 | Where is the Account API (`/v1/account`)? | Not on the MCP host (404); it is its own service at api.spellkave.com (ADR-0124). |
