/** Discovery describes existing rights; reducers decide argument-specific authority. */
export type CapabilityAlternative =
	| { kind: "public" }
	| { kind: "character" }
	| { kind: "presence" }
	| { kind: "publisher" }
	| { kind: "all"; capabilities: readonly string[] }
	| { kind: "prefix"; prefix: string }
	| { kind: "role-capabilities" };

export interface ToolAdmission {
	anyOf: readonly CapabilityAlternative[];
	ports: readonly string[];
	argumentGates?: readonly string[];
	inputModes?: readonly string[];
	limitations?: readonly string[];
}

export interface LiveToolAuthority {
	capabilities: readonly string[];
	/** Each body is kept separate for all-contained-capabilities grant discovery. */
	bodyCapabilities: readonly (readonly string[])[];
	roles: readonly { roleId: string; capabilityIds: readonly string[] }[];
	character: boolean;
	presence?: boolean;
	/** Local publisher hosts only; hosted user composition always supplies false. */
	publisher: boolean;
}

export function admitsTool(
	admission: ToolAdmission,
	authority: LiveToolAuthority,
	ports: readonly string[],
): boolean {
	if (!admission.ports.every((port) => ports.includes(port))) return false;
	const ids = new Set(authority.capabilities);
	return admission.anyOf.some((alternative) => {
		switch (alternative.kind) {
			case "public":
				return true;
			case "character":
				return authority.character;
			case "presence":
				return authority.presence === true;
			case "publisher":
				return authority.publisher;
			case "all":
				return alternative.capabilities.every((id) => ids.has(id));
			case "prefix":
				return authority.capabilities.some((id) => id.startsWith(alternative.prefix));
			case "role-capabilities":
				return authority.roles.some(
					(role) =>
						role.capabilityIds.length > 0 &&
						authority.bodyCapabilities.some((body) =>
							role.capabilityIds.every((id) => body.includes(id)),
						),
				);
		}
		return false;
	});
}
