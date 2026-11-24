// What authkit-refresh-token tells the generators of @spellkave/behaviour.
// The binary has no command list: its surface is one optional argument and
// two env variables, read at the top of src/bin/authkit-refresh-token.ts.
import { defineDocs } from "@spellkave/behaviour/docs";

export default defineDocs({
	binary: "authkit-refresh-token",
	tagline:
		"Identity, auth, rate-limit and world-catalog helpers for the gateway services, and `authkit-refresh-token`, which mints a simulated player's AuthKit access token (ADR-0124 D-7).",
	commands: () => [
		{
			usage: "authkit-refresh-token [player]",
			what: "Spend the player's refresh token at AuthKit, keep the rotated one in the runtime file, print the access token (stdout holds only the token, so `> file` is safe). `player` defaults to `$SPELLKAVE_SIM_NAME`, then `sim1`; `SPELLKAVE_MACHINE_SEED_FILE` and `SPELLKAVE_MACHINE_RUNTIME_FILE` replace the default paths. A missing seed is installed with `scripts/sim/install-machine-seed.sh --player <name>`.",
		},
	],
	commandsNote:
		"Exit codes: `0` the access token is on stdout; `1` refused, one `authkit-refresh-token: <reason>` line on stderr. Operators run it through `scripts/sim/authkit-refresh-token.sh` (token cache, per-player lock).",
	verbOf: () => "authkit-refresh-token",
	design: ["src/bin/authkit-refresh-token.ts", "src/refresh-auth.ts", "src/world-identity.ts"],
	suite: ["vitest.behaviour.config.ts", "behaviour/steps.ts", "behaviour/support/fake-authkit.ts"],
	watched: ["packages/spellkave-gateway-identity", "packages/spellkave-behaviour"],
});
