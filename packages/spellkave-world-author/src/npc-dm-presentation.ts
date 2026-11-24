/** Presentation component admission only; no world rows or engine activation. */
import { validate_dm_presentation_json } from "@spellkave/validate-wasm";

/** Preserve raw JSON for duplicate-field checks in the authoritative Rust schema. */
export function validateDmPresentationJson(json: string): void {
	const errors: string[] = JSON.parse(validate_dm_presentation_json(json));
	if (errors.length) throw new Error(`Invalid DM presentation: ${errors.join("; ")}`);
}

/** Used inside a future document compiler. This does not construct a publication,
 * hash, locator, capability, trusted duty configuration or mounted engine. */
export function compileDmPresentationJson(value: unknown): string {
	const json = JSON.stringify(value);
	if (json === undefined) throw new Error("DM presentation requires JSON data");
	validateDmPresentationJson(json);
	return json;
}
