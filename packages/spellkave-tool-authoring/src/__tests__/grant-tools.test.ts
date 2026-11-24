import { composeGrant } from "@spellkave/world-author/tooling";
import { describe, expect, it, vi } from "vitest";
import type { AuthorToolContext } from "../authoring";
import {
	exportGrants,
	type GrantSnapshot,
	grantRole,
	offeredGrantTools,
	previewRestore,
	restoreGrants,
	revokeRole,
} from "../grant-tools";

const identity = "a".repeat(64);
const input = { role: "custom", subject: "$sender", extent_kind: "place_graph", extent: "forest" };
function setup(overrides: Partial<GrantSnapshot> = {}) {
	const snapshot: GrantSnapshot = {
		protocolVersion: 1,
		identity,
		endpoint: "http://local/world",
		worldInstanceId: "epoch-a",
		tick: "90",
		publisher: true,
		completeInventory: true,
		inventory: [
			{
				role: "custom",
				kind: "place_graph",
				reference: "forest",
				canBind: true,
				expansionMember: true,
				expansionComplete: true,
			},
			{
				role: "custom",
				kind: "bundle",
				reference: "core",
				canBind: true,
				expansionMember: true,
				expansionComplete: true,
			},
		],
		bindings: [],
		...overrides,
	};
	const apply = vi.fn(async () => ({ ok: true }));
	const context: AuthorToolContext = {
		workspace: { readToml: () => null, writeToml: (t) => t },
		grants: { snapshot: async () => snapshot, apply },
	};
	return { snapshot, apply, context };
}
describe("canonical grant tools", () => {
	// keep(K2): inject loss of caller visibility after an acknowledged historical request.
	it.each([
		"missing",
		"denied",
	] as const)("does not confirm absence after the caller's binding read scope becomes %s", async (scope) => {
		const row = composeGrant({ ...input, subject: "b".repeat(64) }, identity, []);
		const { context, snapshot } = setup({ publisher: false, bindings: [row] });
		context.grants!.apply = async () => {
			snapshot.bindings = [];
			if (scope === "missing") snapshot.inventory = [];
			else snapshot.inventory[0]!.canBind = false;
			return { ok: false, detail: JSON.stringify({ code: "MF-APPLY-012" }) };
		};
		const result = await revokeRole(context, row.binding_id);
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("read authority");
	});
	// keep(K2): inject both transport forms of a historical digest refusal after restoration.
	it.each([
		"result",
		"throw",
	] as const)("does not report revoke success when a restored binding survives a duplicate digest (%s)", async (transport) => {
		const row = composeGrant(input, identity, []);
		const { context, snapshot } = setup({ bindings: [row] });
		context.grants!.apply = async () => {
			const detail = JSON.stringify({ code: "MF-APPLY-012" });
			if (transport === "throw") throw new Error(detail);
			return { ok: false, detail };
		};
		const result = await revokeRole(context, row.binding_id);
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("binding remains");
		expect(snapshot.bindings).toEqual([row]);
	});
	// keep(K2): inject the caller projection after committed apply, including destination changes.
	it("confirms a removed binding on the same caller and refuses a changed destination", async () => {
		const row = composeGrant(input, identity, []);
		const { context, snapshot } = setup({ bindings: [row] });
		context.grants!.apply = async () => {
			snapshot.bindings = [];
			return { ok: true };
		};
		expect((await revokeRole(context, row.binding_id)).ok).toBe(true);
		snapshot.bindings = [row];
		context.grants!.apply = async () => {
			snapshot.bindings = [];
			snapshot.worldInstanceId = "another-world";
			return { ok: true };
		};
		await expect(revokeRole(context, row.binding_id)).rejects.toThrow("destination changed");
	});
	it("uses the actual refusal code, never an authored MF-APPLY-012 string", async () => {
		const { context } = setup();
		context.grants!.apply = async () => ({
			ok: false,
			detail: JSON.stringify({ code: "MF-APPLY-036", details: { role: "MF-APPLY-012" } }),
		});
		expect((await grantRole(context, input)).ok).toBe(false);
		context.grants!.apply = async () => ({
			ok: false,
			detail: JSON.stringify({ code: "MF-APPLY-012" }),
		});
		expect((await grantRole(context, input)).ok).toBe(true);
	});
	it("fails closed when an expansion flag is missing and ignores descendant/Party offer candidates", async () => {
		const { context, snapshot, apply } = setup();
		snapshot.inventory[0]!.expansionMember = false;
		const granted = await grantRole(context, { ...input, extent: "*" });
		expect(granted.binding_ids).toHaveLength(1);
		apply.mockClear();
		snapshot.inventory[1]!.expansionComplete = false;
		await expect(grantRole(context, { ...input, extent: "*" })).rejects.toThrow("D-6");
		expect(apply).not.toHaveBeenCalled();
	});
	it("offers writers from current D-6 facts and readers from own bindings, without preset authority", async () => {
		const { context, snapshot } = setup({ publisher: false });
		expect(await offeredGrantTools(context)).toHaveLength(4);
		for (const entry of snapshot.inventory) entry.canBind = false;
		expect(await offeredGrantTools(context)).toEqual([]);
		snapshot.bindings = [composeGrant(input, identity, [])];
		expect(await offeredGrantTools(context)).toEqual([
			"spellkave_list_grants",
			"spellkave_export_grants",
		]);
		snapshot.protocolVersion = 0;
		await expect(offeredGrantTools(context)).rejects.toThrow("unsupported");
	});
	it("refuses mutation of a restore plan after preview", async () => {
		const { context, apply } = setup({ bindings: [composeGrant(input, identity, [])] });
		const plan = await previewRestore(context, await exportGrants(context), false);
		plan.rows[0]!.extent_ref = "town";
		await expect(restoreGrants(context, plan)).rejects.toThrow("changed");
		expect(apply).not.toHaveBeenCalled();
	});
	it("expands complete inventory deterministically and never persists a wildcard", async () => {
		const { context, apply, snapshot } = setup();
		const result = await grantRole(context, { ...input, extent: "*" });
		expect(result.binding_ids).toHaveLength(2);
		expect(apply).toHaveBeenCalledTimes(1);
		expect(apply.mock.calls[0]?.[0]).not.toContain('extent_ref = "*"');
		const first = result.binding_ids;
		snapshot.inventory.reverse();
		expect((await grantRole(context, { ...input, extent: "*" })).binding_ids).toEqual(first);
		snapshot.inventory.push({
			role: "custom",
			kind: "place_graph",
			reference: "later-root",
			canBind: true,
			expansionMember: true,
			expansionComplete: true,
		});
		expect(first).toHaveLength(2);
	});
	it("refuses incomplete, unauthorized and oversized expansions without dispatch", async () => {
		for (const mode of ["incomplete", "denied", "oversized"] as const) {
			const { snapshot, context, apply } = setup();
			if (mode === "incomplete")
				snapshot.inventory.forEach((entry) => {
					entry.expansionComplete = false;
				});
			if (mode === "denied") snapshot.inventory[0]!.canBind = false;
			if (mode === "oversized")
				snapshot.inventory = Array.from({ length: 129 }, (_, i) => ({
					role: "custom",
					kind: "bundle",
					reference: `bundle-${i}`,
					canBind: true,
					expansionMember: true,
					expansionComplete: true,
				}));
			await expect(grantRole(context, { ...input, extent: "*" })).rejects.toThrow();
			expect(apply).not.toHaveBeenCalled();
		}
	});
	it("retains the caller port and reauthorizes a revoked discovery", async () => {
		const { context, apply, snapshot } = setup({ publisher: false });
		await grantRole(context, input);
		expect(apply).toHaveBeenCalledTimes(1);
		snapshot.inventory[0]!.canBind = false;
		await expect(grantRole(context, input)).rejects.toThrow("D-6");
		expect(apply).toHaveBeenCalledTimes(1);
	});
	it("exports concrete runtime rows without derived state or a filesystem", async () => {
		const row = composeGrant({ ...input, expires_at_tick: "100" }, identity, []);
		const { context, snapshot } = setup({
			bindings: [row, { ...row, binding_id: "scripted", bundle_id: "story" }],
		});
		const artifact = await exportGrants(context);
		expect(artifact.manifest).toContain(identity);
		expect(artifact.manifest).not.toMatch(/presence|scripted|actor_capabilities/);
		expect(artifact.receipt.coverage).toBe("complete");
		snapshot.publisher = false;
		expect((await exportGrants(context)).receipt.coverage).toBe("scoped");
		await expect(exportGrants(context, "out.json")).rejects.toThrow("cannot write files");
	});
	it("restores 90/100 at tick 3 as 13, preserves same epoch and no expiry", async () => {
		for (const expiry of ["100", undefined]) {
			const row = composeGrant(
				{ ...input, ...(expiry ? { expires_at_tick: expiry } : {}) },
				identity,
				[],
			);
			const { context, snapshot, apply } = setup({ bindings: [row] });
			const artifact = await exportGrants(context);
			const same = await previewRestore(context, artifact, false);
			expect(same.rows[0]?.expires_at_tick ?? null).toBe(expiry ?? null);
			snapshot.worldInstanceId = "epoch-b";
			snapshot.tick = "3";
			await expect(previewRestore(context, artifact, false)).rejects.toThrow("rebase");
			const cross = await previewRestore(context, artifact, true);
			expect(cross.rows[0]?.expires_at_tick ?? null).toBe(expiry ? "13" : null);
			await restoreGrants(context, cross);
			expect(apply.mock.calls[0]?.[0]).toContain('expected_world_instance_id = "epoch-b"');
		}
	});
	it("refuses expired sources, modified artifacts, changed destinations and unauthorized restorers", async () => {
		const { context, snapshot, apply } = setup({
			bindings: [composeGrant({ ...input, expires_at_tick: "90" }, identity, [])],
		});
		await expect(previewRestore(context, await exportGrants(context), false)).rejects.toThrow(
			"expired",
		);
		snapshot.bindings[0]!.expires_at_tick = "100";
		const artifact = await exportGrants(context);
		const changed = structuredClone(artifact);
		changed.manifest += "\n";
		await expect(previewRestore(context, changed, false)).rejects.toThrow("modified");
		const prepared = await previewRestore(context, artifact, false);
		snapshot.worldInstanceId = "recreated";
		await expect(restoreGrants(context, prepared)).rejects.toThrow("destination changed");
		snapshot.publisher = false;
		snapshot.inventory[0]!.canBind = false;
		await expect(previewRestore(context, artifact, true)).rejects.toThrow("D-6");
		expect(apply).not.toHaveBeenCalled();
	});
	it("does not mistake subject ownership for revoke authority or support older modules", async () => {
		const { context, snapshot, apply } = setup({
			publisher: false,
			bindings: [composeGrant(input, identity, [])],
		});
		snapshot.inventory[0]!.canBind = false;
		await expect(revokeRole(context, snapshot.bindings[0]!.binding_id)).rejects.toThrow(
			"not manageable",
		);
		snapshot.protocolVersion = 0;
		await expect(grantRole(context, input)).rejects.toThrow("unsupported");
		expect(apply).not.toHaveBeenCalled();
	});
});
