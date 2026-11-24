import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

import {
	isSceneNode,
	newScenePrefix,
	type SceneModel,
	sceneManifestSource,
	sceneNodeId,
	serializeApplyPerDb,
	validateScenePrefix,
} from "./scene";

const model = (prefix: string): SceneModel => ({
	prefix,
	bundleDeps: ["core"],
	places: [
		{ name: "yard", exits: ["cellar"] },
		{ name: "cellar", exits: [] },
	],
	bodies: [
		{
			name: "rat",
			kind: "npc",
			at: "cellar",
			def: "core/creature/wolf",
			actor: false,
			capabilities: [],
		},
		{
			name: "hero",
			kind: "hero",
			at: "yard",
			def: "core/creature/wolf",
			actor: true,
			capabilities: ["core/inspect"],
		},
	],
});

describe("scene prefixing", () => {
	it("mints distinct valid prefixes", () => {
		const a = newScenePrefix();
		expect(newScenePrefix()).not.toBe(a);
		expect(validateScenePrefix(a)).toBe(a);
	});
	it.each(["", "A_b", "t-1", "1abc", "ab", "a/b"])("rejects prefix %j", (bad) => {
		expect(() => validateScenePrefix(bad)).toThrow(/scene prefix/);
	});
	it("recognises only its own nodes", () => {
		expect(isSceneNode("t_a", sceneNodeId("t_a", "yard"))).toBe(true);
		expect(isSceneNode("t_a", sceneNodeId("t_ab", "yard"))).toBe(false);
	});
});

describe("sceneManifestSource", () => {
	const render = (prefix: string) =>
		parse(sceneManifestSource(model(prefix), new Map([["hero", "ab".repeat(32)]]))) as Record<
			string,
			Record<string, unknown>[]
		>;

	it("prefixes every id with the scene prefix", () => {
		const doc = render("t_one");
		const ids = [
			doc.bundles?.[0]?.bundle_id,
			...(doc.place_nodes ?? []).map((r) => r.node_id),
			...(doc.entities ?? []).map((r) => r.entity_key),
			...(doc.place_edges ?? []).map((r) => r.edge_key),
		].map(String);
		expect(ids.length).toBeGreaterThan(5);
		for (const id of ids) expect(id.startsWith("t_one")).toBe(true);
		for (const r of doc.entities ?? []) expect(r.place_node_id).toMatch(/^t_one\/g\//);
	});
	it("two prefixes share no identifier", () => {
		const keys = (p: string) =>
			new Set(
				Object.values(render(p))
					.flat()
					.flatMap((r) => [r.bundle_id, r.node_id, r.entity_key, r.edge_key])
					.filter((v): v is string => typeof v === "string"),
			);
		const a = keys("t_one");
		for (const k of keys("t_two")) expect(a.has(k)).toBe(false);
	});
	it("binds the hero identity and allocates distinct coordinates", () => {
		const doc = render("t_one");
		expect(doc.actor_identities?.[0]?.identity).toBe("ab".repeat(32));
		expect((doc.place_nodes ?? []).map((n) => n.pos_x)).toEqual([0, 10]);
		expect(doc.actors).toHaveLength(1);
	});
	it("emits exit bindings on the traverse affordance only where declared", () => {
		const bindings = '{"movement_reach_resource":"t_one/speed"}';
		const source = sceneManifestSource(
			{
				...model("t_one"),
				places: [
					{ name: "yard", exits: ["cellar"], exitBindings: { cellar: bindings } },
					{ name: "cellar", exits: ["yard"] },
				],
			},
			new Map([["hero", "ab".repeat(32)]]),
		);
		const doc = parse(source) as Record<string, Record<string, unknown>[]>;
		const byEdge = new Map((doc.place_edge_affordance ?? []).map((r) => [r.edge_key, r]));
		expect(byEdge.get("t_one/yard->cellar")?.bindings_json).toBe(bindings);
		expect(byEdge.get("t_one/cellar->yard")).not.toHaveProperty("bindings_json");
	});
	it("fails on unknown places, missing identities and empty scenes", () => {
		const bad = model("t_one");
		expect(() =>
			sceneManifestSource({ ...bad, bodies: [{ ...bad.bodies[0]!, at: "nowhere" }] }, new Map()),
		).toThrow(/unknown place/);
		expect(() => sceneManifestSource(bad, new Map())).toThrow(/no identity/);
		expect(() => sceneManifestSource({ ...bad, places: [] }, new Map())).toThrow(
			/at least one place/,
		);
	});
});

describe("serializeApplyPerDb", () => {
	const ref = { url: "ws://x", db: "d1" };
	const run = async (world: typeof ref, log: string[], tag: string) =>
		serializeApplyPerDb(world, async () => {
			log.push(`start ${tag}`);
			await new Promise((r) => setTimeout(r, 5));
			log.push(`end ${tag}`);
		});

	it("never overlaps two tasks on one DB, even after a failure", async () => {
		const log: string[] = [];
		const failing = serializeApplyPerDb(ref, async () => {
			throw new Error("boom");
		});
		await Promise.all([failing.catch(() => undefined), run(ref, log, "a"), run(ref, log, "b")]);
		expect(log).toEqual(["start a", "end a", "start b", "end b"]);
	});
	it("lets different DBs proceed independently", async () => {
		const log: string[] = [];
		await Promise.all([run(ref, log, "a"), run({ ...ref, db: "d2" }, log, "b")]);
		expect(log.slice(0, 2)).toEqual(["start a", "start b"]);
	});
});
