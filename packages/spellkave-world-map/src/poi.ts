/**
 * Schema definition and helpers for POI metadata attachments (ADR-0073 / ADR-0130).
 *
 * Namespace: 'maps.poi' (or ending with '.maps.poi')
 * Target kind: 'place_node' or 'place_graph'
 *
 * Payload shape:
 * {
 *   "icon": "inn" | "portal" | "dungeon" | "cave" | "temple" | "shop" | "well" | ...,
 *   "category"?: string,
 *   "label"?: string,
 *   "badge"?: string,
 *   "color"?: string,
 *   "image"?: string
 * }
 */

export interface PoiMetadataPayload {
	icon?: string;
	category?: string;
	label?: string;
	badge?: string;
	color?: string;
	image?: string;
}

export const POI_NAMESPACE = "maps.poi";

export function isPoiNamespace(namespace: string): boolean {
	return namespace === POI_NAMESPACE || namespace.endsWith(`.${POI_NAMESPACE}`);
}

export function parsePoiMetadata(payloadJson: string): PoiMetadataPayload | null {
	if (!payloadJson || typeof payloadJson !== "string") return null;
	try {
		const parsed = JSON.parse(payloadJson);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
		const res: PoiMetadataPayload = {};
		if (typeof parsed.icon === "string" && parsed.icon.trim() !== "") {
			res.icon = parsed.icon.trim();
		}
		if (typeof parsed.category === "string" && parsed.category.trim() !== "") {
			res.category = parsed.category.trim();
		}
		if (typeof parsed.badge === "string" && parsed.badge.trim() !== "") {
			res.badge = parsed.badge.trim();
		}
		if (typeof parsed.color === "string" && parsed.color.trim() !== "") {
			res.color = parsed.color.trim();
		}
		if (typeof parsed.label === "string" && parsed.label.trim() !== "") {
			res.label = parsed.label.trim();
		}
		if (typeof parsed.image === "string" && parsed.image.trim() !== "") {
			res.image = parsed.image.trim();
		}
		return Object.keys(res).length > 0 ? res : null;
	} catch {
		return null;
	}
}
