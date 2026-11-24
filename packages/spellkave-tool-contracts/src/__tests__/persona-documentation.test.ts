import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { explainPersona } from "../personas";

describe("documentary persona mapping", () => {
	it("pins the authority surface matrix to tool metadata", () => {
		const root = resolve(import.meta.dirname, "../../../..");
		for (const script of ["generate-authority-tool-matrix"]) {
			execFileSync("pnpm", ["exec", "tsx", `scripts/${script}.ts`, "--check"], {
				cwd: root,
				stdio: "pipe",
			});
		}
	});
	it("marks the versioned DM proposal as documentary and grants no authority", () => {
		expect(explainPersona("Dungeon Master")).toMatchInlineSnapshot(`
			{
			  "documentation_only": true,
			  "documentation_version": "personas/0.6",
			  "grants_authority": false,
			  "kind": "persona",
			  "ok": true,
			  "persona": {
			    "extent": "place graph or party",
			    "id": "dungeon-master",
			    "name": "Dungeon Master",
			    "presentation": "PLAYER + DM",
			    "roles": [
			      "dm",
			    ],
			  },
			  "source": "specifications/prd/personas.md#42-personas--roles",
			}
		`);
	});
	it("does not treat a custom role as a new persona", () => {
		expect(explainPersona("custom-weather")).toMatchObject({
			ok: false,
			documentation_only: true,
			grants_authority: false,
		});
	});
});
