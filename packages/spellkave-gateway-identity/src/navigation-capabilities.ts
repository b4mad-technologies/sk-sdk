export const ACCOUNT_NAVIGATION_CAPABILITY = {
	WORLD_JOIN: "world.join",
	WORLD_OBSERVE: "world.observe",
	WORLD_PLAY: "world.play",
	WORLD_MANAGE: "world.manage",
	WORLD_OVERSEE: "world.oversee",
	SYSTEM_MANAGE: "system.manage",
} as const;

export interface NavigationSelfCapability {
	capabilityId?: string;
	extentRef?: string;
	extentKindRef?: string;
	elevationClass?: string;
	expiresAtTick?: number;
}

/**
 * Open-string navigation projection for one authorized account.
 *
 * This is intentionally not a persona or rights enum. Runtime actions remain
 * protected by their owning API route or world reducer; these strings only
 * tell a product surface which already-authorized destination is relevant.
 */
export function accountWorldNavigationCapabilities(options: {
	role: string;
	isCurrentSeat: boolean;
	currentTick?: number;
	selfCapabilities?: readonly NavigationSelfCapability[];
}): string[] {
	const capabilities: string[] = [];
	if (options.role === "open") {
		capabilities.push(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_JOIN);
	} else {
		capabilities.push(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OBSERVE);
	}
	// A clear world load can remove the seat while catalog membership survives.
	// Members/owners are already authorized by canClaimSeat; keep their claim
	// destination visible without granting play before a seat actually exists.
	if (!options.isCurrentSeat && (options.role === "member" || options.role === "owner")) {
		capabilities.push(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_JOIN);
	}
	if (options.isCurrentSeat) capabilities.push(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_PLAY);
	if (options.role === "owner") capabilities.push(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_MANAGE);
	if (
		options.isCurrentSeat &&
		options.selfCapabilities?.some(
			({ capabilityId, elevationClass, extentRef, extentKindRef, expiresAtTick }) =>
				(capabilityId === "frontier.read_internal" || elevationClass === "Internal") &&
				typeof extentRef === "string" &&
				extentRef.trim() !== "" &&
				typeof extentKindRef === "string" &&
				extentKindRef.trim() !== "" &&
				(expiresAtTick === undefined ||
					(options.currentTick !== undefined && expiresAtTick > options.currentTick)),
		) === true
	) {
		capabilities.push(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OVERSEE);
	}
	return capabilities;
}

export function accountGlobalNavigationCapabilities(isOperator: boolean): string[] {
	return isOperator ? [ACCOUNT_NAVIGATION_CAPABILITY.SYSTEM_MANAGE] : [];
}
