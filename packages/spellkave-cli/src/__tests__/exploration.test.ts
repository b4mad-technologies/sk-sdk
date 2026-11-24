// `sk query` takes the shared exploration request (search, then detail by the
// reference a search returned) beside its older list form. This test drives
// both through the real CLI against an SDK test catalogue.
// checks that the old form still answers as before, that a live request
// without a world is "unavailable" with a recovery hint, and that bad input
// exits with the right class. Offline.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExplorationResult } from "@spellkave/tool-contracts";
import { describe, expect, it } from "vitest";
import { runCli } from "../cli";
import { collect } from "./helpers";

const core = fileURLToPath(
	new URL("./fixtures/catalog", import.meta.url),
);
describe("CLI shared exploration contract", () => {
	it("uses explicit file catalog references and bounded detail, without changing legacy query or authoring workspace", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "sk-explore-cli-"));
		try {
			const call = async (params: object) => {
				const io = collect();
				const code = await runCli(
					[
						"--workspace",
						workspace,
						"--target",
						core,
						"--format",
						"jsonl",
						"query",
						"--json",
						JSON.stringify(params),
					],
					io.io,
				);
				return { code, io, details: JSON.parse(io.out[0] ?? "null")?.details };
			};
			const found = await call({
				explore: {
					operation: "search",
					source: "local",
					collection: "definitions",
					kind: "entity_definitions",
					text: "torch",
				},
			});
			expect(found.code).toBe(0);
			const out = found.details as ExplorationResult;
			expect(out.shape).toBe("exploration");
			expect(out.items.map((x) => x.ref.id)).toEqual(["demo/torch"]);
			const detail = await call({
				explore: {
					operation: "detail",
					source: "local",
					source_id: out.source.source_id,
					ref: out.items[0]?.ref,
				},
			});
			expect(detail.details.items[0].ref).toEqual(out.items[0]?.ref);
			const legacy = await call({ kind: "entity_definitions" });
			expect(legacy.details.shape).toBe("list");
			expect(legacy.details.items).toContainEqual(expect.objectContaining({ id: "demo/torch" }));
			const live = await call({ explore: { operation: "search" } });
			expect(live.details.status).toBe("unavailable");
			expect(live.details.recovery).toHaveLength(1);
			expect(live.details.items).toEqual([]);
			// Interim ADR-0144 D-3 deviation (sk-jay0.7.214): every ok:false envelope
			// takes the in-world exit; error_class is the authoritative signal.
			expect([live.code, live.details.ok, live.details.error_class]).toEqual([2, false, "infra"]);
			const missing = await call({
				explore: {
					operation: "detail",
					source: "local",
					source_id: out.source.source_id,
					ref: { ...out.items[0]?.ref, id: "demo/absent" },
				},
			});
			expect([missing.code, missing.details.error_class]).toEqual([2, "in_world"]);
			const wrongField = await call({
				explore: { operation: "search", source: "local", fields: ["bogus"] },
			});
			expect(wrongField.code).toBe(1);
			const usage = JSON.parse(wrongField.io.out[0] ?? "null");
			expect([usage.kind, usage.scope]).toEqual(["error", "usage"]);
			expect(usage.message).toContain("unsupported_field; valid: ");
			expect(usage.message).toContain("display_name");
			const mixed = await call({
				kind: "entity_definitions",
				explore: { operation: "search", source: "local" },
			});
			expect(mixed.code).toBe(1);
			expect(mixed.io.out.join(" ")).toContain("explore is exclusive with legacy query parameters");
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
