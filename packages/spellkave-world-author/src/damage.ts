export interface RouteDamageOptions {
	/**
	 * DSL variable name used to bind the raw damage roll once.
	 *
	 * The default emits `let dmg = <amountExpr>; ...`.
	 */
	variableName?: string;
	/** DSL subject whose tags are read. Defaults to `target`. */
	subject?: "actor" | "target";
	/**
	 * Defense tag stem. The emitted tags are
	 * `<tagPrefix>_immune:<type>`, `<tagPrefix>_resist:<type>`, and
	 * `<tagPrefix>_vulnerable:<type>`.
	 */
	tagPrefix?: string;
}

/**
 * Build the routing ladder over an already-bound `${variableName}`, shared by
 * {@link routeDamage} (negated, the `ModifyResource` delta convention) and
 * {@link routeDamageMagnitude} (bare positive magnitude, for a caller that
 * negates/clamps itself — e.g. an `entity_definition_item_dsl_source` slot
 * read back through `.source(...)`).
 */
function routeDamageLadder(
	variableName: string,
	subject: "actor" | "target",
	tagPrefix: string,
	damageType: string,
): string {
	const immuneTag = `${tagPrefix}_immune:${damageType}`;
	const resistTag = `${tagPrefix}_resist:${damageType}`;
	const vulnerableTag = `${tagPrefix}_vulnerable:${damageType}`;
	return `cond(${subject}.has_tag('${immuneTag}'), 0, cond(${subject}.has_tag('${resistTag}'), ${variableName} / 2, cond(${subject}.has_tag('${vulnerableTag}'), ${variableName} * 2, ${variableName})))`;
}

/**
 * Build the canonical damage-type routing `delta_source` expression.
 *
 * This is deliberately just a string emitter. The validator remains the single
 * source of truth for parsing and type-checking the generated DSL expression.
 */
export function routeDamage(
	amountExpr: string,
	damageType: string,
	opts: RouteDamageOptions = {},
): string {
	const variableName = opts.variableName ?? "dmg";
	const subject = opts.subject ?? "target";
	const tagPrefix = opts.tagPrefix ?? "damage";
	return `let ${variableName} = ${amountExpr}; -${routeDamageLadder(variableName, subject, tagPrefix, damageType)}`;
}

/**
 * The un-negated sibling of {@link routeDamage}: the SAME routing ladder over
 * the SAME bound `amountExpr`, but without the leading `-` — a bare positive
 * magnitude (0 on immune, halved on resist, doubled on vulnerable, else
 * unchanged) rather than a ready-to-apply `ModifyResource` delta.
 *
 * First consumer: a weapon-like item's own `entity_definition_item_dsl_source`
 * slot (`srd/damage`, `dsl-grammar.md`'s `DslSource`/`.source(...)` node) —
 * the slot carries the full positive damage magnitude (die + ability
 * modifier, already type-routed); the READING archetype negates and clamps
 * the whole thing exactly once, so the routing math must not pre-negate it.
 */
export function routeDamageMagnitude(
	amountExpr: string,
	damageType: string,
	opts: RouteDamageOptions = {},
): string {
	const variableName = opts.variableName ?? "dmg";
	const subject = opts.subject ?? "target";
	const tagPrefix = opts.tagPrefix ?? "damage";
	return `let ${variableName} = ${amountExpr}; ${routeDamageLadder(variableName, subject, tagPrefix, damageType)}`;
}
