import { type ToolRole, toolContractsForRole } from "./metadata";

export const PLAYER_TOOL_CONTRACTS = toolContractsForRole("PLAYER");
export const DM_TOOL_CONTRACTS = toolContractsForRole("DM");
export const AUTHOR_TOOL_CONTRACTS = toolContractsForRole("AUTHOR");

export const PLAYER_TOOL_NAMES = PLAYER_TOOL_CONTRACTS.map((contract) => contract.name);
export const DM_TOOL_NAMES = DM_TOOL_CONTRACTS.map((contract) => contract.name);
export const AUTHOR_TOOL_NAMES = AUTHOR_TOOL_CONTRACTS.map((contract) => contract.name);

export function toolNamesForRole(role: ToolRole): readonly string[] {
	return toolContractsForRole(role).map((contract) => contract.name);
}
