import { TOOL_ROLES, type ToolRole } from "./contract-data";

/**
 * Replaces the retired sk-jay0.5.1.21.2 pre-cut parity freeze (bead closed;
 * migration done). That test pinned every contract byte against a one-time
 * historical snapshot forever, so any intentional improvement failed CI.
 *
 * This module implements the two checks a live package needs instead:
 *
 *  - Rolling VISIBLE-DRIFT snapshots (`tool-contracts.snapshot/`): every
 *    change to a contract — new tool, new optional parameter, description
 *    text — must show up as a diff against the corresponding tool file, forcing a deliberate
 *    `pnpm --filter @spellkave/tool-contracts run capture-contracts` re-run.
 *  - A HARD compatibility gate that walks the diff between the previously
 *    *committed* snapshot (read from git, not the working tree — see
 *    `readCommittedSnapshot` in the Git baseline reader) and
 *    the live contracts, and refuses anything that could break a shipped
 *    client unless a matching entry exists in the acknowledgement sidecar.
 */

export const CONTRACT_SNAPSHOT_FORMAT = "spellkave-tool-contracts/contract-snapshot/v1";

/** Serialised parameter shape: a plain JSON-Schema object (TypeBox IS JSON Schema). */
export type SerialisedSchema = Record<string, unknown>;

export interface SerialisedContract {
	admission?: object;
	authority?: object;
	name: string;
	label: string;
	description: string;
	parameters: SerialisedSchema;
	executionMode: string;
	promptSnippet?: string;
	promptGuidelines?: readonly string[];
	cli?: Record<string, unknown>;
	roles: readonly ToolRole[];
}

export interface ContractSnapshotFile {
	format: typeof CONTRACT_SNAPSHOT_FORMAT;
	tools: readonly SerialisedContract[];
	rosters: Readonly<Record<ToolRole, readonly string[]>>;
}

/** Known top-level fields: anything else on a contract is untyped drift the JSON cast can't catch. */
const KNOWN_CONTRACT_KEYS = new Set([
	"name",
	"label",
	"description",
	"parameters",
	"executionMode",
	"promptSnippet",
	"promptGuidelines",
	"cli",
	"roles",
	"authority",
	"admission",
]);

export function unknownContractFields(contract: object): string[] {
	return Object.keys(contract).filter((key) => !KNOWN_CONTRACT_KEYS.has(key));
}

/** Deterministic key order so the committed snapshot diffs cleanly, field by field. */
export function serialiseContract(contract: {
	name: string;
	label: string;
	description: string;
	parameters: object;
	executionMode: string;
	promptSnippet?: string;
	promptGuidelines?: readonly string[];
	cli?: object;
	authority?: object;
	admission?: object;
	roles: readonly ToolRole[];
}): SerialisedContract {
	return {
		name: contract.name,
		label: contract.label,
		description: contract.description,
		parameters: JSON.parse(JSON.stringify(contract.parameters)) as SerialisedSchema,
		executionMode: contract.executionMode,
		...(contract.promptSnippet === undefined ? {} : { promptSnippet: contract.promptSnippet }),
		...(contract.promptGuidelines === undefined
			? {}
			: { promptGuidelines: [...contract.promptGuidelines] }),
		...(contract.cli === undefined
			? {}
			: { cli: JSON.parse(JSON.stringify(contract.cli)) as Record<string, unknown> }),
		roles: [...contract.roles],
		...(contract.authority === undefined ? {} : { authority: contract.authority }),
		...(contract.admission === undefined ? {} : { admission: contract.admission }),
	};
}

export function captureSnapshot(
	contracts: readonly {
		name: string;
		label: string;
		description: string;
		parameters: object;
		executionMode: string;
		promptSnippet?: string;
		promptGuidelines?: readonly string[];
		cli?: object;
		roles: readonly ToolRole[];
	}[],
	rosters: Readonly<Record<ToolRole, readonly string[]>>,
): ContractSnapshotFile {
	return {
		format: CONTRACT_SNAPSHOT_FORMAT,
		tools: contracts.map(serialiseContract),
		rosters: {
			PLAYER: [...rosters.PLAYER],
			DM: [...rosters.DM],
			AUTHOR: [...rosters.AUTHOR],
		},
	};
}

export interface BreakingChange {
	tool: string;
	field: string;
	description: string;
	from: unknown;
	to: unknown;
}

const TIGHTENABLE_CONSTRAINT_KEYS = [
	"pattern",
	"format",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
	"multipleOf",
	"uniqueItems",
	"additionalProperties",
] as const;

function primitiveEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** Enum-like value set: a plain `enum`, or a root/`anyOf` union of simple `{type, const}` literals. */
function constValues(node: Record<string, unknown>): unknown[] | null {
	if (Array.isArray(node.enum)) return node.enum;
	const anyOf = node.anyOf;
	if (
		Array.isArray(anyOf) &&
		anyOf.every(
			(branch) =>
				branch !== null &&
				typeof branch === "object" &&
				"const" in (branch as Record<string, unknown>) &&
				Object.keys(branch as Record<string, unknown>).every(
					(key) => key === "type" || key === "const",
				),
		)
	) {
		return anyOf.map((branch) => (branch as { const: unknown }).const);
	}
	return null;
}

function compareSchemaNode(
	tool: string,
	path: string,
	previous: Record<string, unknown>,
	current: Record<string, unknown>,
	changes: BreakingChange[],
): void {
	if (previous.type !== current.type) {
		changes.push({
			tool,
			field: `${path}.type`,
			description: "parameter type changed",
			from: previous.type,
			to: current.type,
		});
	}

	const previousConsts = constValues(previous);
	const currentConsts = constValues(current);
	if (previousConsts !== null) {
		const currentSet = new Set(currentConsts ?? []);
		for (const value of previousConsts) {
			if (!currentSet.has(value)) {
				changes.push({
					tool,
					field: `${path}.enum`,
					description: "enum/union value removed",
					from: value,
					to: undefined,
				});
			}
		}
	} else if (
		(previous.anyOf !== undefined || current.anyOf !== undefined) &&
		!primitiveEqual(previous.anyOf, current.anyOf)
	) {
		changes.push({
			tool,
			field: `${path}.anyOf`,
			description: "union shape changed",
			from: previous.anyOf,
			to: current.anyOf,
		});
	}

	for (const key of TIGHTENABLE_CONSTRAINT_KEYS) {
		if (!primitiveEqual(previous[key], current[key])) {
			changes.push({
				tool,
				field: `${path}.${key}`,
				description: "constraint changed",
				from: previous[key],
				to: current[key],
			});
		}
	}

	if (previous.type === "object") {
		const previousRequired = new Set((previous.required as string[] | undefined) ?? []);
		const currentRequired = new Set((current.required as string[] | undefined) ?? []);
		for (const key of currentRequired) {
			if (!previousRequired.has(key)) {
				changes.push({
					tool,
					field: `${path}.required.${key}`,
					description: "parameter newly required",
					from: false,
					to: true,
				});
			}
		}

		const previousProps = (previous.properties as Record<string, unknown> | undefined) ?? {};
		const currentProps = (current.properties as Record<string, unknown> | undefined) ?? {};
		for (const key of Object.keys(previousProps)) {
			const propPath = `${path}.properties.${key}`;
			if (!(key in currentProps)) {
				changes.push({
					tool,
					field: propPath,
					description: "parameter removed",
					from: previousProps[key],
					to: undefined,
				});
				continue;
			}
			compareSchemaNode(
				tool,
				propPath,
				previousProps[key] as Record<string, unknown>,
				currentProps[key] as Record<string, unknown>,
				changes,
			);
		}
	}

	if (previous.type === "array" && current.type === "array" && previous.items && current.items) {
		compareSchemaNode(
			tool,
			`${path}.items`,
			previous.items as Record<string, unknown>,
			current.items as Record<string, unknown>,
			changes,
		);
	}
}

/**
 * `previous === null` means no committed baseline exists yet (first capture):
 * nothing to break, so it always reports clean.
 */
export function computeBreakingChanges(
	previous: ContractSnapshotFile | null,
	current: ContractSnapshotFile,
): BreakingChange[] {
	if (previous === null) return [];
	const changes: BreakingChange[] = [];
	const previousByName = new Map(previous.tools.map((tool) => [tool.name, tool]));
	const currentByName = new Map(current.tools.map((tool) => [tool.name, tool]));

	for (const [name, previousTool] of previousByName) {
		const currentTool = currentByName.get(name);
		if (currentTool === undefined) {
			changes.push({
				tool: name,
				field: "<tool>",
				description: "tool removed or renamed",
				from: name,
				to: undefined,
			});
			continue;
		}
		if (previousTool.executionMode !== currentTool.executionMode) {
			changes.push({
				tool: name,
				field: "executionMode",
				description: "executionMode changed",
				from: previousTool.executionMode,
				to: currentTool.executionMode,
			});
		}
		compareSchemaNode(
			name,
			"parameters",
			previousTool.parameters as Record<string, unknown>,
			currentTool.parameters as Record<string, unknown>,
			changes,
		);
	}

	for (const role of TOOL_ROLES) {
		const currentSet = new Set(current.rosters[role]);
		for (const name of previous.rosters[role]) {
			if (!currentSet.has(name)) {
				changes.push({
					tool: name,
					field: `roles.${role}`,
					description: `dropped from the ${role} roster`,
					from: role,
					to: undefined,
				});
			}
		}
	}

	return changes;
}

export interface BreakingChangeAcknowledgement {
	tool: string;
	field: string;
	from: unknown;
	to: unknown;
	reason: string;
	acknowledgedAt: string;
}

export const ACKNOWLEDGEMENTS_FORMAT =
	"spellkave-tool-contracts/breaking-change-acknowledgements/v1";

export interface AcknowledgementsFile {
	format: typeof ACKNOWLEDGEMENTS_FORMAT;
	entries: readonly BreakingChangeAcknowledgement[];
}

function acknowledgementKey(entry: {
	tool: string;
	field: string;
	from: unknown;
	to: unknown;
}): string {
	return JSON.stringify([entry.tool, entry.field, entry.from, entry.to]);
}

/** Every breaking change without a matching (tool, field, from, to) acknowledgement entry. */
export function unacknowledgedBreakingChanges(
	changes: readonly BreakingChange[],
	acknowledgements: AcknowledgementsFile,
): BreakingChange[] {
	const acknowledged = new Set(acknowledgements.entries.map(acknowledgementKey));
	return changes.filter((change) => !acknowledged.has(acknowledgementKey(change)));
}

export function formatBreakingChange(change: BreakingChange): string {
	return `${change.tool}: ${change.field} — ${change.description} (was ${JSON.stringify(change.from)}, now ${JSON.stringify(change.to)})`;
}
