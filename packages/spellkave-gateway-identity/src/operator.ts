/**
 * Operator authorization (sk-jay0.5.14.10).
 *
 * WorkOS env JWT template `{"roles": {{organization_membership.roles}}}`
 * puts a verified `roles` claim (array of role slugs, e.g. `["operator"]`)
 * on access tokens for users with a membership in org "Spellkave"; users
 * without a membership get no `roles` claim at all. `rolesFromAuthInfo`
 * reads that claim from the already-verified `AuthInfo.extra` produced by
 * `createPlayerJwtVerifier` — never from an unverified decode.
 */

/** Minimal principal shape `isOperator` needs: a subject and optional verified roles. */
export interface AuthPrincipal {
	subject: string;
	roles?: readonly string[];
}

/**
 * Verified `roles` claim as a string array, or `[]` when absent, non-array,
 * or containing non-string entries (malformed claims are ignored, not thrown).
 */
export function rolesFromAuthInfo(authInfo: { extra?: Record<string, unknown> }): string[] {
	const claim = authInfo.extra?.roles;
	if (!Array.isArray(claim)) return [];
	return claim.filter((role): role is string => typeof role === "string");
}

/**
 * True when the principal carries the WorkOS org "Spellkave" `operator` role
 * claim, or — as a transition fallback until every environment's WorkOS env
 * JWT template ships (sk-adr8.6 removes this branch) — their subject is in
 * the legacy `SPELLKAVE_OPERATOR_SUBS` allowlist.
 */
export function isOperator(principal: AuthPrincipal, operatorSubs: ReadonlySet<string>): boolean {
	if (principal.roles?.includes("operator") === true) return true;
	return operatorSubs.has(principal.subject);
}
