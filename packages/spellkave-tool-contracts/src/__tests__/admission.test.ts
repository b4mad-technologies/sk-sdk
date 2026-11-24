import { describe, expect, it } from "vitest";
import { admitsTool, type LiveToolAuthority } from "../admission";
import { getToolContract, toolContractsForAuthority } from "../metadata";
import { PLAYER_TOOL_NAMES } from "../roster";

const player: LiveToolAuthority = {
	character: true,
	publisher: false,
	capabilities: [],
	bodyCapabilities: [],
	roles: [],
};
const authority = (ids: string[]): LiveToolAuthority => ({
	...player,
	capabilities: ids,
	bodyCapabilities: [ids],
	roles: [{ roleId: "custom-weather", capabilityIds: ["frontier.read_hidden"] }],
});
const grant = () => getToolContract("spellkave_grant_role").admission;

describe("live contract admission", () => {
	it("keeps the ordinary PLAYER order and excludes owner/publisher tools", () => {
		expect(
			toolContractsForAuthority(player, [
				"control",
				"paceTime",
				"applyset",
				"grants",
				"canI",
				"readInstance",
				"applyDelta",
			]).map((tool) => tool.name),
		).toEqual(PLAYER_TOOL_NAMES);
	});
	it("offers every D-6 discovery path without requiring a persona or a bind id", () => {
		expect(admitsTool(grant(), authority(["frontier.read_hidden"]), ["grants"])).toBe(true);
		expect(admitsTool(grant(), authority(["frontier.bind.custom-weather"]), ["grants"])).toBe(true);
		expect(admitsTool(grant(), { ...player, publisher: true }, ["grants"])).toBe(true);
		expect(admitsTool(grant(), player, ["grants"])).toBe(false);
	});
	it("offers escalation authoring while retaining the separate D-6 grant rule", () => {
		const escalator = authority(["frontier.escalate"]);
		expect(admitsTool(grant(), escalator, ["grants"])).toBe(false);
		expect(
			admitsTool(getToolContract("spellkave_applyset_apply").admission, escalator, ["applyset"]),
		).toBe(true);
	});
	it.each([
		"spellkave_prepare_hand_over",
		"spellkave_hand_over_role",
	])("discovers %s only through the existing D6 alternatives and caller port", (name) => {
		const handover = getToolContract(name).admission;
		expect(admitsTool(handover, authority(["frontier.read_hidden"]), ["grants"])).toBe(true);
		expect(admitsTool(handover, authority(["frontier.bind.custom-weather"]), ["grants"])).toBe(
			true,
		);
		expect(admitsTool(handover, { ...player, publisher: true }, ["grants"])).toBe(true);
		expect(admitsTool(handover, player, ["grants"])).toBe(false);
		expect(admitsTool(handover, authority(["frontier.read_hidden"]), [])).toBe(false);
		expect(
			admitsTool(
				handover,
				{
					...player,
					capabilities: ["frontier.a", "frontier.b"],
					bodyCapabilities: [["frontier.a"], ["frontier.b"]],
					roles: [{ roleId: "custom", capabilityIds: ["frontier.a", "frontier.b"] }],
				},
				["grants"],
			),
		).toBe(false);
	});
	it("does not discover grant authority from an empty role", () => {
		const emptyRole = {
			...player,
			bodyCapabilities: [[]],
			roles: [{ roleId: "empty", capabilityIds: [] }],
		};
		expect(admitsTool(grant(), emptyRole, ["grants"])).toBe(false);
	});
	it("does not compose all-contained-capabilities across distinct bodies", () => {
		const separated = {
			...player,
			capabilities: ["frontier.a", "frontier.b"],
			bodyCapabilities: [["frontier.a"], ["frontier.b"]],
			roles: [{ roleId: "custom", capabilityIds: ["frontier.a", "frontier.b"] }],
		};
		expect(admitsTool(grant(), separated, ["grants"])).toBe(false);
	});
	it("requires exact all-of ids, filters missing ports and keeps publisher reads local", () => {
		const get = getToolContract("spellkave_get").admission;
		expect(admitsTool(get, authority(["frontier.read_hidden_extra"]), ["readInstance"])).toBe(
			false,
		);
		expect(admitsTool(get, authority(["frontier.read_hidden"]), [])).toBe(false);
		expect(
			admitsTool(getToolContract("spellkave_export").admission, { ...player, publisher: true }, []),
		).toBe(false);
	});
});
