import mapping from "./personas.generated.json";

export const PERSONA_DOCUMENTATION_VERSION = mapping.version;
export const PERSONA_MAPPINGS = mapping.personas;

/** Documentary only: no host admission or reducer accepts a persona string. */
export function explainPersona(name: string) {
	const normalized = name.toLowerCase().replace(/[ _]/g, "-");
	const persona = PERSONA_MAPPINGS.find((row) => row.id === normalized);
	return {
		ok: persona !== undefined,
		kind: "persona",
		documentation_only: true,
		documentation_version: mapping.version,
		source: mapping.source,
		persona: persona ?? null,
		grants_authority: false,
	};
}
