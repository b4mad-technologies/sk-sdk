import { grantDelta } from "@spellkave/world-author/tooling";
import { describe, expect, it, vi } from "vitest";
import { type AuthorToolContext, createAuthorFacingBoundTools } from "../authoring";

function harness(reads = false) {
	const sent = vi.fn(async () => ({ ok: true as const }));
	const read = vi.fn(async () => {
		throw new Error("scoped reader unavailable");
	});
	const context: AuthorToolContext = {
		applyDelta: sent,
		applyset: {
			readsAsPublisher: () => false,
			readApplyset: async () => null,
			applyBundle: async () => {
				throw new Error("unexpected applyset enqueue");
			},
			rootPathFor: () => "manifest.toml",
			...(reads ? { readScopedSnapshot: read } : {}),
		},
	};
	const tool = createAuthorFacingBoundTools(context).find(
		(row) => row.name === "spellkave_apply_manifest_delta",
	);
	if (!tool) throw new Error("canonical shared apply tool missing");
	return { sent, read, call: (toml: string) => tool.execute("inline-proof", { toml }) };
}
const bindingOnly = grantDelta([], ["demo/owned-binding"]);
const entity = `\n[[entities]]\nentity_key="demo/chest"\nbundle_id="demo"\nname="Chest"\nkind="item"\nplace_node_id=""\n`;

describe("shared inline scoped write guard", () => {
	it("retains D-6 binding-only transport without an instance reader", async () => {
		const h = harness(true);
		const result = await h.call(bindingOnly);
		expect(result.details).toMatchObject({ ok: true });
		expect(h.read).not.toHaveBeenCalled();
		expect(h.sent).toHaveBeenCalledExactlyOnceWith(bindingOnly);
	});
	it.each([
		false,
		true,
	])("refuses mixed ordinary rows without enqueue when reader is wired=%s", async (wired) => {
		const h = harness(wired);
		const result = await h.call(bindingOnly + entity);
		expect(result.details).toMatchObject({ ok: false, sent: false });
		expect(h.sent).not.toHaveBeenCalled();
		if (wired) expect(h.read).toHaveBeenCalledOnce();
	});
});
