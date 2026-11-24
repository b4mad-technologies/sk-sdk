import type { TSchema } from "typebox";
import { admitsTool } from "./admission";

import { RAW_TOOL_CONTRACT_DATA, type ToolContractData, type ToolRole } from "./contract-data";
import { getToolParameters } from "./schema-registry";

export {
	TOOL_EXECUTION_MODES,
	TOOL_ROLES,
	type ToolCliMetadata,
	type ToolContractData,
	type ToolExecutionMode,
	type ToolRole,
} from "./contract-data";

/** Portable descriptor bound to the actual TypeBox schema source. */
export interface ToolContract extends Omit<ToolContractData, "parameters"> {
	parameters: TSchema;
}

export const TOOL_CONTRACTS: readonly ToolContract[] = RAW_TOOL_CONTRACT_DATA.tools.map(
	(contract) => ({ ...contract, parameters: getToolParameters(contract.name) }),
);

/** Ordered host-presentation rosters captured before the package cut. */
export const TOOL_ROLE_ROSTERS = RAW_TOOL_CONTRACT_DATA.rosters;

const contractsByName = new Map(TOOL_CONTRACTS.map((contract) => [contract.name, contract]));

export function getToolContract(name: string): ToolContract {
	const contract = contractsByName.get(name);
	if (contract === undefined) throw new Error(`Unknown Spellkave tool contract '${name}'.`);
	return contract;
}

export function toolContractsForRole(role: ToolRole): readonly ToolContract[] {
	return TOOL_ROLE_ROSTERS[role].map(getToolContract);
}

/** Canonical PLAYER order followed by admitted elevated contracts in registry order. */
export function toolContractsForAuthority(
	authority: import("./admission").LiveToolAuthority,
	ports: readonly string[],
): readonly ToolContract[] {
	const player = toolContractsForRole("PLAYER");
	const ordered = [...player, ...TOOL_CONTRACTS.filter((contract) => !player.includes(contract))];
	return ordered.filter((contract) => admitsTool(contract.admission, authority, ports));
}
