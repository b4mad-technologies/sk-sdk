/**
 * Mark a TypeScript string as Spellkave DSL without changing the emitted
 * source. Editors and generators can grep for `dsl\`...\``.
 *
 * The tagged template interpolates like String.raw and returns the same
 * text a plain string literal would have produced.
 */
export function dsl(strings: TemplateStringsArray, ...values: unknown[]): string {
	return String.raw({ raw: strings }, ...values);
}
