import { describe, expect, it } from "vitest";

import {
	ACKNOWLEDGEMENTS_FORMAT,
	type AcknowledgementsFile,
	CONTRACT_SNAPSHOT_FORMAT,
	type ContractSnapshotFile,
	computeBreakingChanges,
	type SerialisedContract,
	unacknowledgedBreakingChanges,
} from "../contract-guard";

/** A minimal, valid PLAYER contract — every case below overrides just what it needs. */
function contract(overrides: Partial<SerialisedContract> = {}): SerialisedContract {
	return {
		name: "spellkave_probe",
		label: "Spellkave Probe",
		description: "A probe tool.",
		parameters: {
			type: "object",
			required: [],
			properties: {
				handle: { type: "string", minLength: 2, description: "target handle" },
				kind: {
					anyOf: [
						{ type: "string", const: "a" },
						{ type: "string", const: "b" },
					],
				},
			},
		},
		executionMode: "parallel",
		roles: ["PLAYER"],
		...overrides,
	};
}

function snapshot(tools: readonly SerialisedContract[]): ContractSnapshotFile {
	return {
		format: CONTRACT_SNAPSHOT_FORMAT,
		tools,
		rosters: {
			PLAYER: tools.filter((t) => t.roles.includes("PLAYER")).map((t) => t.name),
			DM: tools.filter((t) => t.roles.includes("DM")).map((t) => t.name),
			AUTHOR: tools.filter((t) => t.roles.includes("AUTHOR")).map((t) => t.name),
		},
	};
}

describe("computeBreakingChanges", () => {
	it("reports nothing against a null baseline (bootstrap: first snapshot)", () => {
		expect(computeBreakingChanges(null, snapshot([contract()]))).toEqual([]);
	});

	it("flags a removed parameter", () => {
		const before = snapshot([contract()]);
		const afterProps = { ...(before.tools[0]?.parameters.properties as Record<string, unknown>) };
		delete afterProps.handle;
		const after = snapshot([
			contract({ parameters: { ...before.tools[0]?.parameters, properties: afterProps } }),
		]);

		const changes = computeBreakingChanges(before, after);
		expect(changes).toContainEqual(
			expect.objectContaining({
				tool: "spellkave_probe",
				field: "parameters.properties.handle",
				description: "parameter removed",
			}),
		);
	});

	it("flags a parameter newly required", () => {
		const before = snapshot([contract()]);
		const after = snapshot([
			contract({
				parameters: { ...before.tools[0]?.parameters, required: ["handle"] },
			}),
		]);

		const changes = computeBreakingChanges(before, after);
		expect(changes).toContainEqual(
			expect.objectContaining({
				tool: "spellkave_probe",
				field: "parameters.required.handle",
				description: "parameter newly required",
			}),
		);
	});

	it("flags an enum/union value removed (narrowed)", () => {
		const before = snapshot([contract()]);
		const beforeProps = before.tools[0]?.parameters.properties as Record<string, unknown>;
		const after = snapshot([
			contract({
				parameters: {
					...before.tools[0]?.parameters,
					properties: {
						...beforeProps,
						kind: { anyOf: [{ type: "string", const: "a" }] },
					},
				},
			}),
		]);

		const changes = computeBreakingChanges(before, after);
		expect(changes).toContainEqual(
			expect.objectContaining({
				tool: "spellkave_probe",
				field: "parameters.properties.kind.enum",
				description: "enum/union value removed",
				from: "b",
			}),
		);
	});

	it("flags a tightened/changed constraint (pattern added)", () => {
		const before = snapshot([contract()]);
		const beforeProps = before.tools[0]?.parameters.properties as Record<string, unknown>;
		const after = snapshot([
			contract({
				parameters: {
					...before.tools[0]?.parameters,
					properties: {
						...beforeProps,
						handle: { type: "string", minLength: 2, pattern: "^h:" },
					},
				},
			}),
		]);

		const changes = computeBreakingChanges(before, after);
		expect(changes).toContainEqual(
			expect.objectContaining({
				tool: "spellkave_probe",
				field: "parameters.properties.handle.pattern",
				description: "constraint changed",
				from: undefined,
				to: "^h:",
			}),
		);
	});

	it("flags a removed/renamed tool and a dropped roster membership", () => {
		const before = snapshot([contract({ name: "spellkave_gone" })]);
		const after = snapshot([]);

		const changes = computeBreakingChanges(before, after);
		expect(changes).toContainEqual(
			expect.objectContaining({
				tool: "spellkave_gone",
				field: "<tool>",
				description: "tool removed or renamed",
			}),
		);
		expect(changes).toContainEqual(
			expect.objectContaining({ tool: "spellkave_gone", field: "roles.PLAYER" }),
		);
	});

	it("does NOT flag a description-only change", () => {
		const before = snapshot([contract({ description: "Before text." })]);
		const after = snapshot([contract({ description: "After text, much longer and different." })]);
		expect(computeBreakingChanges(before, after)).toEqual([]);
	});

	it("does NOT flag an added optional parameter or a new tool", () => {
		const before = snapshot([contract()]);
		const beforeProps = before.tools[0]?.parameters.properties as Record<string, unknown>;
		const after = snapshot([
			contract({
				parameters: {
					...before.tools[0]?.parameters,
					properties: { ...beforeProps, extra: { type: "string" } },
				},
			}),
			contract({ name: "spellkave_new_tool" }),
		]);
		expect(computeBreakingChanges(before, after)).toEqual([]);
	});
});

describe("unacknowledgedBreakingChanges", () => {
	it("filters out a change with a matching (tool, field, from, to) acknowledgement", () => {
		const before = snapshot([contract()]);
		const after = snapshot([
			contract({ parameters: { ...before.tools[0]?.parameters, required: ["handle"] } }),
		]);
		const changes = computeBreakingChanges(before, after);
		expect(changes).toHaveLength(1);

		const acknowledgements: AcknowledgementsFile = {
			format: ACKNOWLEDGEMENTS_FORMAT,
			entries: [
				{
					tool: changes[0]?.tool as string,
					field: changes[0]?.field as string,
					from: changes[0]?.from,
					to: changes[0]?.to,
					reason: "test probe",
					acknowledgedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		expect(unacknowledgedBreakingChanges(changes, acknowledgements)).toEqual([]);
	});

	it("does not let an acknowledgement for a different value cover a new change", () => {
		const before = snapshot([contract()]);
		const after = snapshot([
			contract({ parameters: { ...before.tools[0]?.parameters, required: ["handle"] } }),
		]);
		const changes = computeBreakingChanges(before, after);

		const acknowledgements: AcknowledgementsFile = {
			format: ACKNOWLEDGEMENTS_FORMAT,
			entries: [
				{
					tool: "spellkave_probe",
					field: "parameters.required.handle",
					from: true, // wrong `from` value — must not match
					to: true,
					reason: "stale entry",
					acknowledgedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		expect(unacknowledgedBreakingChanges(changes, acknowledgements)).toEqual(changes);
	});
});
