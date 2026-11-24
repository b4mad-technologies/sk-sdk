// Distinct id meanings the SDK historically collapsed onto one `string`.
//
// A brand on a return type enumerates nothing: these types are still
// assignable TO `string`. The compiler only speaks when a parameter is branded.

declare const ACTOR_ID: unique symbol;
declare const ENTITY_REF: unique symbol;
declare const ENTITY_ID: unique symbol;

/**
 * The steering principal (`Actor.actor_id`).
 *
 * Produced by `readActorIdentityBindings`, `readActorPrincipals`, `readSeats`,
 * and `readActorBodySwapEvents` (minted via {@link asActorId}). Consumed at
 * `packages/spellkave-srd-cc/scripts/stage-adventure.ts:166` as the first
 * positional argument to `r_bind_actor_identity`.
 */
export type ActorId = string & { readonly [ACTOR_ID]: true };

/**
 * What an author or a tool caller writes: a bare numeric id (`42`),
 * `entity:42`, `item:42`, or a manifest key (`core/player`).
 */
export type EntityRef = string & { readonly [ENTITY_REF]: true };

/**
 * A resolved body entity (`Actor.current_body`, `actor_spatial_location.entity_id`).
 * A subtype of {@link EntityRef}: a resolved id is itself a valid ref.
 */
export type EntityId = EntityRef & { readonly [ENTITY_ID]: true };

type Assert<T extends true> = T;
type _EntityIdExtendsRef = Assert<EntityId extends EntityRef ? true : false>;
type _RefIsNotId = Assert<EntityRef extends EntityId ? false : true>;

/**
 * Brand an untrusted string as an {@link EntityRef} as it enters the SDK
 * (profile values, tool parameters, test fixtures). This is the only door a
 * plain `string` may pass through to become a ref — not scattered `as` casts
 * at every `resolveEntityId` call.
 */
export function asEntityRef(value: string): EntityRef {
	return value as EntityRef;
}

/**
 * Mint a resolved {@link EntityId} after a numeric parse (e.g. `resolveActor`).
 * Not an entry door for untrusted refs — use {@link asEntityRef} for those.
 */
export function asEntityId(value: string): EntityId {
	return value as EntityId;
}

/**
 * Mint a steering principal {@link ActorId}. The door a principal enters the
 * SDK through (identity bindings, principals, seats, body-swap events).
 */
export function asActorId(value: string): ActorId {
	return value as ActorId;
}
