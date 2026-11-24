// Private scene IDs parameterize containment policies and children for PLAYER consumer proofs.
import { createActorClient, defaultReaderManifest, type SnapshotDb } from "@spellkave/sdk";
import { syncConnection } from "./live";
import { scene } from "./scene";
import { Rows } from "./scene-live/doc-contract-support";
import { closeExtrasOwner, liveWorldRef } from "./scene-live/support";

/** Test-only policy rows never change the ruleset's definitions or persistent worlds. */
export async function containerContentsFixture(options: {
	dependencies: string[];
	heroDefinition: string;
	itemDefinition: string;
	wide?: boolean;
}) {
	const s = await scene(liveWorldRef(), undefined, { bundleDeps: options.dependencies });
	try {
		s.place("yard")
			.place("distant")
			.hero("hero", { at: "yard", def: options.heroDefinition })
			.hero("observer", { at: "yard", def: options.heroDefinition })
			.hero("remote", { at: "distant", def: options.heroDefinition });
		await s.apply();
		const p = s.prefix;
		const r = new Rows(p);
		const definitions = new Map<string, string>();
		r.add("entity_definitions", { entity_def_id: `${p}/container`, display_name: "Container" });
		r.add("resource_definitions", {
			resource_definition_id: `${p}/exposed`,
			display_name: "Exposed",
			value_kind: "bool",
			min_value: 0,
			max_value: 1,
			initial_value: 0,
			recovery_rule: "persistent",
		});
		r.add("containment_policy_definition", {
			policy_id: `${p}/exposure`,
			exposure_predicate_source: `target.state('${p}/exposed') == true`,
			access_predicate_source: "true == true",
		});
		const entity = (name: string, definition: string, parent?: string) => {
			definitions.set(name, definition);
			r.add("entities", {
				entity_key: `${p}/${name}`,
				entity_def_id: definition,
				name,
				kind: "item",
				quantity: 1,
				place_node_id: parent ? "" : s.reads.nodeId("yard"),
			});
			if (parent)
				r.add("entity_containment", {
					entity_key: `${p}/${name}`,
					container_entity_key: `${p}/${parent}`,
					slot_id: "",
					direction: "",
				});
		};
		for (const name of ["first", "second", "empty", "unconfigured"]) entity(name, `${p}/container`);
		entity("inner", `${p}/container`, "first");
		entity("secret", options.itemDefinition, "inner");
		entity("first_child", options.itemDefinition, "first");
		entity("second_child", options.itemDefinition, "second");
		for (const name of ["first", "second", "empty", "inner"]) {
			r.add("entity_containment_policy", {
				entity_key: `${p}/${name}`,
				policy_id: `${p}/exposure`,
			});
			r.add("object_state", {
				entity_key: `${p}/${name}`,
				state_id: `${p}/exposed`,
				value_bool: name !== "inner",
				source_template_id: "initial",
			});
		}
		if (options.wide)
			for (let index = 0; index < 513; index += 1)
				entity(`wide_${index}`, options.itemDefinition, "second");
		await r.apply(s, options.dependencies);
		const players = await Promise.all(
			["hero", "observer", "remote"].map(async (name) => {
				const hero = s.heroOf(name);
				await hero.world.subscribeReaders([defaultReaderManifest()]);
				await syncConnection(hero.world);
				const client = createActorClient(hero.world.conn, String(hero.entityId), {
					successOnProvenance: true,
				});
				return {
					...hero,
					context: {
						db: () => hero.world.db() as SnapshotDb,
						act: { actorId: String(hero.entityId), actorClient: client },
					},
				};
			}),
		);
		let revision = 0;
		return {
			scene: s,
			players,
			id(name: string): string {
				const id = s.reads.entityId(name);
				if (id === null) throw new Error(`Missing fixture entity ${name}`);
				return String(id);
			},
			async settle() {
				for (const hero of players) await syncConnection(hero.world);
			},
			async expose(name: string, exposed: boolean) {
				const delta = new Rows(p);
				delta.add("object_state", {
					entity_key: `${p}/${name}`,
					state_id: `${p}/exposed`,
					value_bool: exposed,
					source_template_id: `change-${++revision}`,
				});
				await delta.apply(s, options.dependencies);
				for (const hero of players) await syncConnection(hero.world);
			},
			async rename(name: string, label: string) {
				const delta = new Rows(p);
				delta.add("entities", {
					entity_key: `${p}/${name}`,
					entity_def_id: definitions.get(name),
					name: label,
					kind: "item",
					quantity: 1,
					place_node_id: "",
				});
				await delta.apply(s, options.dependencies);
				for (const hero of players) await syncConnection(hero.world);
			},
			async close() {
				await s.close();
				await closeExtrasOwner();
			},
		};
	} catch (error) {
		await s.close();
		await closeExtrasOwner();
		throw error;
	}
}
