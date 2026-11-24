/** Versioned synthetic journey evidence; credentials and caller identities stay private. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSyncGit } from "@spellkave/behaviour/git-env";

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x));
export function captureSceneJourney(input: {
	started: number;
	status: string;
	interactions: unknown[];
	assertions: unknown[];
	root: string;
	testFile: string;
	catalog: string;
	owner: string;
	author: string;
	outsider: string;
}) {
	const { started, status, interactions, assertions, root, testFile, catalog } = input;
	const output = resolve(process.env.SPELLKAVE_SCENE_EVIDENCE_DIR ?? ".local/scene-proof");
	mkdirSync(output, { recursive: true });
	const evidence = {
		format: "parameterized-scene-proof/v1",
		scenarioIds: ["AUTH-50-01", "AUTH-50-02"],
		status,
		testedAt: new Date(started).toISOString(),
		implementingRevision: execFileSyncGit(["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf8",
		}).trim(),
		testSourceSha256: createHash("sha256").update(readFileSync(testFile)).digest("hex"),
		fixtureSourceSha256: createHash("sha256")
			.update(readFileSync(resolve(import.meta.dirname, "scene-fixture.ts")))
			.digest("hex"),
		fixtureRevision: "synthetic scene/v1 + core and gatekeeper",
		versions: { client: "0.0.0", sourceProtocol: 1, spacetime: "2.10.1" },
		context: {
			persona: "Adventure Author",
			surface: "installed local CLI and shared live caller adapter",
			callerScope:
				"Internal source Bundle, source-descendant placement, destination Bundle author; existing DM presence",
			externalClient: "not tested",
		},
		interactions,
		assertions,
		cost: {
			elapsedMs: Date.now() - started,
			calls: interactions.length,
			retries: 0,
			deliberateRepeatedSetupAttempts: 1,
			requestUtf8Bytes: interactions.reduce<number>(
				(n, x) => n + ((x as { requestBytes?: number }).requestBytes ?? 0),
				0,
			),
			responseUtf8Bytes: interactions.reduce<number>(
				(n, x) => n + ((x as { responseBytes?: number }).responseBytes ?? 0),
				0,
			),
			inferenceCalls: 0,
			modelInputTokens: 0,
			modelOutputTokens: 0,
			images: 0,
			accounting:
				"exact recorded CLI argv/stdout and fixture/probe bytes; SDK connections, subscriptions, scheduler frames and bootstrap control traffic unmeasured",
			usability: "scripted discovery; no unaided discovery or numerical efficiency claim",
		},
	};
	writeFileSync(
		resolve(output, "journey.json"),
		json(evidence)
			.replaceAll(catalog, "scene-catalog")
			.replaceAll(root, "<repository>")
			.replaceAll(input.author, "author")
			.replaceAll(input.owner, "publisher")
			.replaceAll(input.outsider, "outsider")
			.replaceAll(process.env.SPELLKAVE_URL!, "fixture-node"),
	);
}
