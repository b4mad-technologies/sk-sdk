// Republishing the server module over a world must keep its roles and
// bindings as they were and keep refusing the same three unauthorized role
// edits (MF-APPLY-045, -046, -036). A person runs this rehearsal by hand:
// phase `before` saves the authority rows, then the module is republished,
// then phase `after` compares them. Needs SPELLKAVE_ESCALATION_REHEARSAL=1,
// SPELLKAVE_ESCALATION_REHEARSAL_PHASE and a live world; skips otherwise.
// Change: role-escalation-at-apply, task 4.2.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	applyManifestDelta,
	connectDedicatedClaimWorld,
	connectTestWorld,
	operatorScopeManifest,
	type TestWorld,
} from "@spellkave/test-lab";
import { describe, expect, it } from "vitest";

const tables = [
	"role_definition",
	"role_aggregation",
	"visible_role_binding",
	"visible_capability",
	"visible_actor_identity",
	"entity",
	"actor",
	"capability_definition",
];
const readers = operatorScopeManifest("preserve-state authority rehearsal", tables);
const header = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "escalation_proof"
display_name = "Escalation proof rehearsal"
author = "synthetic"
version = "1.0.0"
depends_on = ["core"]
`;
const json = (value: unknown) =>
	JSON.stringify(value, (_, x) => (typeof x === "bigint" ? String(x) : x));
const rows = (w: TestWorld, name: string): Record<string, unknown>[] => {
	const handle = (w.db() as Record<string, { iter(): Iterable<Record<string, unknown>> }>)[name];
	if (!handle) throw new Error(`missing rehearsal table ${name}`);
	return Array.from(handle.iter());
};
describe.skipIf(process.env.SPELLKAVE_ESCALATION_REHEARSAL !== "1")(
	"preserved authority security floor",
	() => {
		it("retains realised and inert rows and all three admission refusals across publish", async () => {
			const token = resolveSpacetimeConfigPathToken();
			if (!token) throw new Error("publisher token unavailable");
			const owner = await connectTestWorld({ token, readerManifests: [readers] });
			const caller = await connectDedicatedClaimWorld(
				{ readerManifests: [readers] },
				"escalation-rehearsal",
			);
			const author = await connectDedicatedClaimWorld(
				{ readerManifests: [readers] },
				"escalation-author",
			);
			const phase = process.env.SPELLKAVE_ESCALATION_REHEARSAL_PHASE ?? "before";
			const evidence = resolve(
				process.env.SPELLKAVE_ESCALATION_EVIDENCE_DIR ?? ".local/escalation-rehearsal",
			);
			mkdirSync(evidence, { recursive: true });
			try {
				if (phase === "before")
					await applyManifestDelta(
						owner,
						header +
							`[[role_bindings]]\nbinding_id = "escalation_proof/rehearsal"\nbundle_id = "escalation_proof"\nsubject = "${caller.identity}"\nrole_id = "escalation_proof/only-apply"\nextent_kind_ref = "bundle"\nextent_ref = "escalation_proof"\ndescription = "Forward-fix refusal witness"\n`,
					);
				const bindings = rows(owner, "visible_role_binding");
				expect(
					bindings.some(
						(r) => r.bindingId === "escalation_proof/retained-inert" && r.presenceEntityId === 0n,
					),
				).toBe(true);
				expect(
					bindings.some(
						(r) =>
							r.bindingId === "escalation_foreign/scout" && BigInt(String(r.presenceEntityId)) > 0n,
					),
				).toBe(true);
				const state = Object.fromEntries(
					tables.map((name) => {
						const data = rows(owner, name).map(json).sort();
						return [
							name,
							{ rows: data.length, sha256: createHash("sha256").update(json(data)).digest("hex") },
						];
					}),
				);
				if (phase === "before") writeFileSync(resolve(evidence, "before.json"), json(state) + "\n");
				else
					expect(state).toEqual(JSON.parse(readFileSync(resolve(evidence, "before.json"), "utf8")));
				const refusals: Record<string, unknown>[] = [];
				for (const [w, body, code, reason] of [
					[
						caller,
						'[[role_definitions]]\nrole_id = "escalation_proof/rehearsal-denied"\nbundle_id = "escalation_proof"\ndisplay_name = "Denied role"\ndescription = "Retained security floor"\ncapability_ids = ["escalation_proof/c"]\n',
						"MF-APPLY-045",
						"missing_capability",
					],
					[
						caller,
						'[[retractions]]\nrow_kind = "entity_definition"\nauthored_key = "escalation_proof/prunable"\n',
						"MF-APPLY-046",
						"missing_capability",
					],
					[
						author,
						'[[role_aggregations]]\nrole_id = "escalation_proof/scout"\nbundle_id = "escalation_proof"\ndescription = "Denied foreign expansion"\ncapability_ids = ["escalation_proof/c"]\n',
						"MF-APPLY-036",
						"realised_binding_impact",
					],
				] as const) {
					let refusal = "";
					try {
						await applyManifestDelta(w, header + body);
					} catch (e) {
						refusal = String(e);
					}
					expect(refusal).toContain(code);
					expect(refusal).toContain(reason);
					refusals.push({ code, reason, refused: true });
				}
				writeFileSync(
					resolve(evidence, `${phase}.receipt.json`),
					json({ phase, state, refusals, schemaChange: false, reset: false }) + "\n",
				);
			} finally {
				author.disconnect();
				caller.disconnect();
				owner.disconnect();
			}
		});
	},
);
