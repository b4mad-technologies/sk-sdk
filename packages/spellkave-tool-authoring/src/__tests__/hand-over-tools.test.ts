import { parseSchemaManifestToml } from "@spellkave/world-author/tooling";
import { describe, expect, it, vi } from "vitest";
import type { AuthorToolContext } from "../authoring";
import {
	type HandOverInput,
	type HandOverPreview,
	type HandOverReceipt,
	handOverRole,
	prepareHandOver,
} from "../hand-over-tools";

const caller = "a".repeat(64),
	target = "b".repeat(64);
const input: HandOverInput = {
	binding_id: "kept-binding",
	subject: target,
	expected_digest: "c".repeat(64),
	expected_merged_role_digest: "d".repeat(64),
	expected_incarnation: "epoch/incarnation",
	expected_revision: "4",
	request_id: "12345678-1234-1234-1234-123456789abc",
	reason: "Backup resumes",
};
function setup() {
	const preview: HandOverPreview = {
		binding: {
			binding_id: input.binding_id,
			bundle_id: "",
			subject: caller,
			role_id: "dm",
			extent_kind_ref: "place_graph",
			extent_ref: "forest",
			description: "kept",
			expires_at_tick: "100",
			handover_note: "Shared only",
		},
		expected_digest: input.expected_digest,
		expected_merged_role_digest: input.expected_merged_role_digest,
		expected_incarnation: input.expected_incarnation,
		expected_revision: input.expected_revision,
		source_tick: "90",
		context: {
			scheduled_jobs: [],
			coverage: [{ family: "scheduled_jobs", status: "reader_unavailable" }],
		},
	};
	let receipt: HandOverReceipt | undefined;
	const committed = () => {
		receipt = {
			key: "receipt",
			binding_id: input.binding_id,
			request_id: input.request_id,
			applied_by: caller,
			new_subject: target,
			old_digest: input.expected_digest,
			merged_role_digest: input.expected_merged_role_digest,
			incarnation: input.expected_incarnation,
			old_revision: input.expected_revision,
			reason: input.reason,
		};
	};
	const apply = vi.fn(async (_toml: string) => {
		committed();
		return { ok: true };
	});
	const context: AuthorToolContext = {
		workspace: { readToml: () => null, writeToml: (text) => text },
		grants: {
			snapshot: async () => ({
				protocolVersion: 1,
				identity: caller,
				endpoint: "http://local",
				worldInstanceId: "epoch",
				tick: "90",
				publisher: true,
				completeInventory: true,
				inventory: [],
				bindings: [preview.binding],
			}),
			prepareHandOver: async () => preview,
			transferReceipt: async () => receipt,
			apply,
		},
	};
	return { context, apply, preview, committed };
}
describe("guarded handover consumers", () => {
	it("pins reviewed digests even when current preparation changes and preserves authored context", async () => {
		const { context, apply, preview } = setup();
		const prepared = await prepareHandOver(context, input.binding_id, target);
		expect(prepared.context.coverage).toEqual([
			{ family: "scheduled_jobs", status: "reader_unavailable" },
		]);
		expect(prepared.preview_is_frozen).toBe(false);
		preview.expected_merged_role_digest = "e".repeat(64);
		await handOverRole(context, input);
		const manifest = parseSchemaManifestToml(apply.mock.calls[0]![0]);
		expect(manifest.binding_preconditions[0]!.expected_merged_role_digest).toBe(
			input.expected_merged_role_digest,
		);
		expect(manifest.role_bindings).toEqual([
			{ ...preview.binding, subject: target, expires_at_tick: 100 },
		]);
		expect(manifest.metadata.expected_world_instance_id).toBe("epoch");
	});
	it("reconciles a committed lost response once, rejects conflicting content and does not mutate on retry", async () => {
		const { context, apply, committed } = setup();
		apply.mockImplementation(async () => {
			committed();
			throw new Error("connection lost");
		});
		expect((await handOverRole(context, input)).reconciled).toBe(true);
		expect((await handOverRole(context, input)).reconciled).toBe(true);
		expect(apply).toHaveBeenCalledTimes(1);
		await expect(handOverRole(context, { ...input, reason: "different" })).rejects.toThrow(
			"conflicts",
		);
		expect(apply).toHaveBeenCalledTimes(1);
	});
	it("never reports enqueue alone as completion", async () => {
		const { context, apply } = setup();
		apply.mockImplementation(async () => ({ ok: true }));
		await expect(handOverRole(context, input)).rejects.toThrow("no committed receipt");
	});
});
