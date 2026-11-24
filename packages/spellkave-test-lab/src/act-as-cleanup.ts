/** Retire completed AUTH-41 fixture bundles on an owned disposable node. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import { header, rows } from "./environment-ownership-fixture";
import { applyManifestDelta, applyManifestSource, connectTestWorld } from "./live";

const FIXTURE = /^(act41|act41b|close41|consumer41|mcp_close41|land41|multiseat)_[0-9a-f]{32}$/;
const MAPPINGS = "SELECT manifest_key, bundle_id, entity_id FROM manifest_authored_entity";
const BINDINGS =
	"SELECT binding_id, bundle_id, presence_entity_id, subject, role_id, extent_kind_ref, extent_ref FROM role_binding";

/** Register each random bundle as it is created; run only after every test/CLI observation. */
export function actAsFixtureCleanup(label: string) {
	if (!/^[a-z-]+$/.test(label)) throw new Error("AUTH-41 cleanup requires a plain evidence label");
	const bundles = new Set<string>();
	return {
		track(bundle: string): string {
			if (!FIXTURE.test(bundle))
				throw new Error("AUTH-41 cleanup refuses a foreign fixture namespace");
			bundles.add(bundle);
			return bundle;
		},
		async run(): Promise<void> {
			if (!bundles.size) return;
			const address = new URL(process.env.SPELLKAVE_URL ?? "");
			if (
				process.env.SPELLKAVE_LOCAL_NODE !== "1" ||
				!["http:", "https:"].includes(address.protocol) ||
				!["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) ||
				address.username ||
				address.password
			)
				throw new Error("AUTH-41 cleanup requires the owned loopback test node");
			const token = resolveSpacetimeConfigPathToken();
			if (!token) throw new Error("AUTH-41 cleanup requires the publisher credential");
			const started = performance.now();
			const publisher = await connectTestWorld({ token });
			try {
				const mappings = await rows(publisher, MAPPINGS);
				const bindings = await rows(publisher, BINDINGS);
				const foreign = (items: Record<string, unknown>[]) =>
					JSON.stringify(
						items
							.filter((row) => !bundles.has(String(row.bundle_id)))
							.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
					);
				const foreignMappings = foreign(mappings);
				const foreignBindings = foreign(bindings);
				let entitiesRetracted = 0;
				let bindingsRetracted = 0;
				for (const bundle of bundles) {
					const ownedBindings = bindings.filter((row) => row.bundle_id === bundle);
					const ownedEntities = mappings.filter((row) => row.bundle_id === bundle);
					const retractions = [
						...ownedBindings.map((row) => ["role_bindings", String(row.binding_id)]),
						...ownedEntities.map((row) => ["entity", String(row.manifest_key)]),
					];
					if (retractions.length)
						await applyManifestDelta(
							publisher,
							header(bundle) +
								retractions
									.map(
										([kind, key]) =>
											`[[retractions]]\nrow_kind=${JSON.stringify(kind)}\nauthored_key=${JSON.stringify(key)}\n`,
									)
									.join(""),
						);
					// After explicit instance/binding retractions, whole-bundle replacement
					// clears its remaining definitions, jobs, seals and topology. Core and
					// other fixtures stay in the same database; the world is never wiped.
					await applyManifestSource(publisher, header(bundle));
					entitiesRetracted += ownedEntities.length;
					bindingsRetracted += ownedBindings.length;
				}
				const afterMappings = await rows(publisher, MAPPINGS);
				const afterBindings = await rows(publisher, BINDINGS);
				if (
					afterMappings.some((row) => bundles.has(String(row.bundle_id))) ||
					afterBindings.some((row) => bundles.has(String(row.bundle_id)))
				)
					throw new Error("AUTH-41 cleanup left a tracked fixture mapping or binding");
				if (
					foreign(afterMappings) !== foreignMappings ||
					foreign(afterBindings) !== foreignBindings
				)
					throw new Error("AUTH-41 cleanup changed foreign mappings or bindings");
				const output = resolve(
					process.env.SPELLKAVE_ACT_AS_EVIDENCE_DIR ??
						resolve(import.meta.dirname, "../../../.local/act-as-evidence"),
				);
				mkdirSync(output, { recursive: true });
				writeFileSync(
					resolve(output, `cleanup-${label}.json`),
					`${JSON.stringify({
						schema: "act-as-fixture-cleanup/v1",
						bundles: bundles.size,
						entitiesRetracted,
						bindingsRetracted,
						foreignMappingsPreserved: true,
						foreignBindingsPreserved: true,
						elapsedMs: Math.round(performance.now() - started),
					})}\n`,
				);
				bundles.clear();
			} finally {
				publisher.disconnect();
			}
		},
	};
}
