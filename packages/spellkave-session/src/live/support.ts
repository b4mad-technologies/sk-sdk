// embedded-manifest: {"category": "exact_text_oracle", "rationale": "live scene extras need a minimal bundle envelope so a delta validates on its own against the shared package database"}
/**
 * Shared helpers for the session live tests (`pnpm test:live`). The package seeds ONE database
 * once (`seed.ts`); every test builds its own prefixed scene on it. Nothing here wipes,
 * publishes or reseeds.
 */
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	applyManifestDelta,
	connectTestWorld,
	type Scene,
	type SceneWorldRef,
	serializeApplyPerDb,
	type TestWorld,
} from "@spellkave/test-lab";

export const localNode = process.env.SPELLKAVE_LOCAL_NODE === "1";

export function liveWorldRef(): SceneWorldRef {
	const token = resolveSpacetimeConfigPathToken();
	if (!token) throw new Error("owned node publisher credential required (SPACETIME_CONFIG_PATH)");
	return {
		url: process.env.SPELLKAVE_URL ?? "http://127.0.0.1:3000",
		db: process.env.SPELLKAVE_DB ?? "spellkave-dev",
		token,
	};
}

let extrasOwner: Promise<TestWorld> | undefined;
/** One owner-token connection per process (bound to the gatekeeper by the first scene apply). */
export function ownerConnection(): Promise<TestWorld> {
	const w = liveWorldRef();
	extrasOwner ??= connectTestWorld({ url: w.url, db: w.db, token: w.token });
	return extrasOwner;
}
export async function closeExtrasOwner(): Promise<void> {
	if (extrasOwner === undefined) return;
	const owner = await extrasOwner;
	extrasOwner = undefined;
	owner.disconnect();
}

/**
 * Apply extra rows to a scene bundle already applied. `rows` is TOML without the header.
 * `dependsOn` must repeat the scene's own `bundleDeps` when the rows name definitions of a bundle
 * other than `core`.
 */
export async function applySceneExtras(
	target: Scene,
	rows: string,
	dependsOn: readonly string[] = ["core"],
): Promise<void> {
	const w = liveWorldRef();
	const owner = await ownerConnection();
	await serializeApplyPerDb(w, () =>
		applyManifestDelta(
			owner,
			`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[[bundles]]
bundle_id = "${target.prefix}"
display_name = "Scene ${target.prefix}"
author = "spellkave-test"
version = "1.0.0"
depends_on = ["${dependsOn.join('", "')}"]

${rows}`,
			{ tolerateAlreadyApplied: true, label: `scene ${target.prefix} extras` },
		),
	);
}

/**
 * The `r_session_open` wire of a hero's connection, for the PLAYER `spellkave_session_open` tool
 * under test (`act.callRSessionOpen`). The tool dispatches it; a test never calls it directly,
 * so the step stays inside the tool call that a pattern `act` counts.
 */
export function sessionOpenPort(world: TestWorld) {
	return (args: Parameters<TestWorld["conn"]["reducers"]["rSessionOpen"]>[0]) =>
		world.conn.reducers.rSessionOpen(args);
}
