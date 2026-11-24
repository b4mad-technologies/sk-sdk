/** Opaque continuity key for a participant-visible window. Unlike a listing
 * revision or r0/i0 handle, this excludes unrelated rows and changing content.
 * It is not a dispatch handle or authorization token. World-generation scoping
 * belongs to the caller's checkpoint context; raw reducer ids stay internal.
 */
export async function reactionWindowKey(
	kind: "reaction" | "intervention",
	pendingId: bigint,
): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify([kind, pendingId.toString()]));
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return `window:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
