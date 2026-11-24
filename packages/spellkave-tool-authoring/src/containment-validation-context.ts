import type { AuthorTarget } from "./author-target";

/** Reference facts only: use the Rust admission vocabulary rather than copying
 * dependency policy/condition DSL into scratch output and revalidating it.
 * Rust still checks every reference against the author's dependency closure.
 */
export function containmentValidationContext(
	manifest: Record<string, unknown>,
	target: AuthorTarget | undefined,
): string | undefined {
	if (
		target === undefined ||
		![
			"containment_policy_definition",
			"entity_definition_containment_policy",
			"entity_containment_policy",
		].some((kind) => Array.isArray(manifest[kind]) && manifest[kind].length > 0)
	)
		return undefined;
	const owners = (kind: string, key: string) =>
		Object.fromEntries(target.lookup(kind).map((r) => [r[key], r.bundle_id]));
	return JSON.stringify({
		bundle_dependencies: Object.fromEntries(
			target.lookup("bundles").map((r) => [r.bundle_id, r.depends_on ?? []]),
		),
		policies: owners("containment_policy_definition", "policy_id"),
		states: {
			...owners("object_state_definitions", "state_id"),
			...owners("resource_definitions", "resource_definition_id"),
		},
		tags: owners("tag_value_definitions", "tag"),
		conditions: owners("condition_definitions", "condition_definition_id"),
		entities: Object.fromEntries(
			target
				.lookup("entities")
				.map((r) => [
					String(r.entity_key).includes(":") ? r.entity_key : `${r.bundle_id}:${r.entity_key}`,
					[r.bundle_id, r.entity_def_id],
				]),
		),
	});
}
