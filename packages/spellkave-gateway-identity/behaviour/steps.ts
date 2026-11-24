// The sentences of behaviour/*.feature, against the real
// src/bin/authkit-refresh-token.ts run through the repository's tsx, as
// scripts/sim/authkit-refresh-token.sh runs it; nothing under src/ is imported.
// Each scenario gets a temp HOME (so ~/.config/spellkave/... lands there) and
// its own fake AuthKit (support/fake-authkit.ts), so scenarios share nothing.

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { argvOf, cliRunner, type Run } from "@spellkave/behaviour/cli";
import { Given, type NarratedWorld, Then, When } from "@spellkave/behaviour/narrate";
import { contractSteps } from "@spellkave/behaviour/steps";
import { After } from "quickpickle";
import { expect } from "vitest";

import { type FakeAuthKit, startFakeAuthKit, unsignedJwt } from "./support/fake-authkit.ts";

const TOOL = "authkit-refresh-token";
const PKG = resolve(import.meta.dirname, "..");
const TSX = join(PKG, "../../node_modules/.bin/tsx");
const BIN = join(PKG, "src/bin/authkit-refresh-token.ts");
const RESOURCE = "https://mcp.spellkave.com/mcp";
const UM_ISSUER = "https://api.workos.com/user_management/client_loop";

type World = NarratedWorld & { home: string; authkit: FakeAuthKit; issued?: string; run?: Run };

// Any first step starts the world: the Givens differ per scenario.
async function world(w: World): Promise<World> {
	if (!w.home) {
		w.home = mkdtempSync(join(tmpdir(), "authkit-refresh-behaviour-"));
		w.authkit = await startFakeAuthKit();
	}
	return w;
}
After(async (w: World) => {
	await w.authkit?.close();
	if (w.home) rmSync(w.home, { recursive: true, force: true });
});

const ran = (w: World): Run => w.run ?? expect.unreachable("no run yet: needs a When");
// The default paths for player sim1, under the scenario's HOME.
const seedFile = (w: World) =>
	join(w.home, ".config/spellkave/player-mcp/machine-user-sim1.seed.json");
const runtimeFile = (w: World) => join(w.home, ".config/spellkave/sim-players/sim1.json");
const record = (path: string) => JSON.parse(readFileSync(path, "utf8"));

async function run(w: World, command: string, role?: "setup"): Promise<Run> {
	// No SPELLKAVE_* from this shell; HOME is the scenario's; the fake's certificate is trusted.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith("SPELLKAVE_")),
	);
	const tool = cliRunner({
		name: TOOL,
		bin: TSX,
		cwd: w.home,
		baseEnv: { ...env, HOME: w.home, NODE_EXTRA_CA_CERTS: w.authkit.caFile },
		// The token holds the fake's random port: a reader needs "a token", not its bytes.
		redactions: [
			...(w.issued ? [[w.issued, "<access token from AuthKit>"] as const] : []),
			[w.home, "~"],
		],
	});
	const args = argvOf(command, TOOL);
	const result = { ...(await tool.runAsync([BIN, ...args])), argv: args };
	await tool.attach(result, role);
	return result;
}

// ---- Given: the seed and what AuthKit answers ------------------------------

async function seed(w: World, refreshToken: string, issuer?: string) {
	const path = seedFile(await world(w));
	mkdirSync(dirname(path), { recursive: true });
	const iss = issuer ?? w.authkit.issuer;
	writeFileSync(
		path,
		JSON.stringify({
			refresh_token: refreshToken,
			client_id: "client_loop",
			issuer: iss,
			resource: RESOURCE,
		}),
	);
}
Given("the seed holds the refresh token {string}", (w: World, rt: string) => seed(w, rt));
Given("the seed names the User Management issuer", (w: World) => seed(w, "rt-seed", UM_ISSUER));
Given("the seed is missing", (w: World) => world(w));

async function grant(w: World, body: Record<string, unknown>, status = 200) {
	await world(w);
	w.issued = typeof body.access_token === "string" ? body.access_token : undefined;
	w.authkit.answer({ status, body: { token_type: "Bearer", expires_in: 900, ...body } });
}
const token = (iss: string) => unsignedJwt({ iss, sub: "user_01SIM1", aud: RESOURCE });
Given("AuthKit answers with the refresh token {string}", async (w: World, rt: string) =>
	grant(await world(w), { access_token: token(w.authkit.issuer), refresh_token: rt }),
);
Given("AuthKit answers with a token from another issuer", (w: World) =>
	grant(w, { access_token: token(UM_ISSUER) }),
);
Given("AuthKit answers with an access token that is not a JWT", (w: World) =>
	grant(w, { access_token: "sk_not_a_jwt" }),
);
Given("AuthKit refuses the grant with {string}", (w: World, code: string) =>
	grant(w, { error: code }, 400),
);
Given("AuthKit is down", async (w: World) => (await world(w)).authkit.close());
Given("I ran {string} once", async (w: World, command: string) => {
	expect((await run(w, command, "setup")).exit).toBe(0);
});

When("I run {string}", async (w: World, command: string) => {
	w.run = await run(await world(w), command);
});

// ---- Then ------------------------------------------------------------------

contractSteps<World>({ tool: TOOL, lastRun: ran });
Then("stdout is the access token AuthKit issued, and stderr is empty", (w: World) => {
	expect(ran(w)).toMatchObject({ stdout: `${w.issued}\n`, stderr: "" });
});
Then("stdout is empty, and stderr is one line that says {string}", (w: World, text: string) => {
	expect(ran(w).stdout).toBe("");
	expect(ran(w).stderr).toMatch(new RegExp(`^${TOOL}: [^\\n]*\\n$`));
	expect(ran(w).stderr).toContain(text);
});
Then("stderr does not contain {string}", (w: World, text: string) => {
	expect(ran(w).stderr).not.toContain(text);
});
Then("AuthKit received {int} requests", (w: World, n: number) => {
	expect(w.authkit.requests).toHaveLength(n);
});
Then("AuthKit's last request was a refresh grant spending {string}", (w: World, rt: string) => {
	const last = w.authkit.requests.at(-1);
	expect(last).toMatchObject({ method: "POST", path: "/oauth2/token" });
	const form = {
		grant_type: "refresh_token",
		refresh_token: rt,
		client_id: "client_loop",
		resource: RESOURCE,
	};
	expect(Object.fromEntries(last?.form ?? [])).toEqual(form);
});
Then(
	"the runtime file holds the refresh token {string}, readable only by me",
	(w: World, rt: string) => {
		expect(record(runtimeFile(w))).toMatchObject({ refresh_token: rt });
		expect(statSync(runtimeFile(w)).mode & 0o777).toBe(0o600);
	},
);
Then("the seed still holds the refresh token {string}", (w: World, rt: string) => {
	expect(record(seedFile(w))).toMatchObject({ refresh_token: rt });
});
Then("there is no runtime file", (w: World) => {
	expect(existsSync(runtimeFile(w))).toBe(false);
});
