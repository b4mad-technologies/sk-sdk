import contractDataJson from "./contracts-metadata.json" with { type: "json" };

export const TOOL_ROLES = ["PLAYER", "DM", "AUTHOR"] as const;
export type ToolRole = (typeof TOOL_ROLES)[number];

export const TOOL_EXECUTION_MODES = ["parallel", "sequential"] as const;
export type ToolExecutionMode = (typeof TOOL_EXECUTION_MODES)[number];

export interface ToolCliMetadata {
	positionals?: readonly string[];
	examples?: readonly { command: string; description: string }[];
}

export type SerializedToolSchema = Record<string, unknown>;

export interface ToolContractData {
	name: string;
	admission: import("./admission").ToolAdmission;
	authority?: { kind: "role-binding"; readSubject: boolean };
	label: string;
	description: string;
	parameters: SerializedToolSchema;
	executionMode: ToolExecutionMode;
	promptSnippet?: string;
	promptGuidelines?: readonly string[];
	cli?: ToolCliMetadata;
	roles: readonly ToolRole[];
}

export interface ToolContractDataFile {
	format: "spellkave-tool-contracts/v1";
	tools: readonly ToolContractData[];
	rosters: Readonly<Record<ToolRole, readonly string[]>>;
}

/** Production contract data, hand-maintained: names, labels, descriptions, roles, CLI/prompt metadata. */
export const RAW_TOOL_CONTRACT_DATA = contractDataJson as ToolContractDataFile;
