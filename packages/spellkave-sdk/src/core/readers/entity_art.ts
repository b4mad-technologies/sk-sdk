import type { ManifestAuthoredEntityRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString, rows } from "./_helpers";
import { readMetadataAttachmentRows } from "./metadata_rows";

export const requiredTables: RequiredTables<
	[
		"public_metadata_attachment",
		"visible_metadata_attachment",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
	]
> = [
	"public_metadata_attachment",
	"visible_metadata_attachment",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
];
registerReaderManifest({ requiredTables });

/** Public, application-independent <bundle>.art.image convention (ADR-0073).
 * Path starts with its installed adventure asset module, not a host directory. */
export interface EntityArt {
	path: string;
	hash: string;
	license: string;
}

/** Neutral name for the same projected payload. */
export type PublicSubjectArt = EntityArt;

/** Admitted `metadata_attachments.target_kind` values for public subject art.
 * Hand-mirror of `spellkave_validate::METADATA_TARGET_KINDS` (ADR-0073). */
export const METADATA_TARGET_KINDS = [
	"entity",
	"entity_definition",
	"place_graph",
	"place_node",
	"place_edge",
	"item_definition",
	"prompt_definition",
	"resource_definition",
	"affordance_template",
	"capability_definition",
	"bundle",
] as const;

export type PublicArtTargetKind = (typeof METADATA_TARGET_KINDS)[number];

const INSTANCE_KINDS = new Set<string>(["entity", "place_node", "place_edge"]);

export interface PublicArtSubject {
	kind: string;
	ref: string;
}

function parseArt(payload: string): EntityArt | undefined {
	let value: unknown;
	try {
		value = JSON.parse(payload);
	} catch {
		return undefined;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const { path, hash, license } = value as Record<string, unknown>;
	if (typeof path !== "string" || typeof hash !== "string" || typeof license !== "string")
		return undefined;
	if (!license.trim() || !/^[a-f0-9]{64}$/.test(hash)) return undefined;
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\//.test(path) || /[\\%?#:]/.test(path)) return undefined;
	if ([...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
		return undefined;
	if (path.split("/").some((part) => part === "" || part === "." || part === ".."))
		return undefined;
	if (!/\.(webp|png|jpe?g)$/i.test(path)) return undefined;
	return { path, hash, license };
}

function pickArt(candidates: EntityArt[]): EntityArt | undefined {
	return candidates.sort((a, b) => {
		const left = `${a.path}\n${a.hash}\n${a.license}`;
		const right = `${b.path}\n${b.hash}\n${b.license}`;
		return left < right ? -1 : left > right ? 1 : 0;
	})[0];
}

function isAdmittedKind(kind: string): kind is PublicArtTargetKind {
	return (METADATA_TARGET_KINDS as readonly string[]).includes(kind);
}

/** Public art attachments keyed by `${kind}\0${ref}` — one pass over
 * `metadata_attachment` (plus the `visible_manifest_authored_entity` alias for
 * `entity` rows), reusable across many subject lookups. Payloads stay raw
 * until a lookup asks for that key, so a reader wanting one subject does not
 * pay for parsing every art row. Build it once per reader call that
 * resolves art for many rows; never cache it across calls (the subscription
 * cache mutates underneath). */
export interface PublicArtIndex {
	readonly byKey: ReadonlyMap<string, readonly string[]>;
	/** Memoised {@link parseArt} verdict per raw payload. */
	readonly parsed: Map<string, EntityArt | undefined>;
}

function indexKey(kind: string, ref: string): string {
	return `${kind}\0${ref}`;
}

export function buildPublicArtIndex(db: SnapshotDb): PublicArtIndex {
	// manifest key (`<bundle>:<ref>`) → authored entity ids it names, so an
	// `entity` attachment authored by ref also answers a lookup by entity id.
	const aliases = new Map<string, string[]>();
	for (const entry of rows<ManifestAuthoredEntityRow>(db, "visible_manifest_authored_entity")) {
		const key = asString(entry.manifestKey);
		const ids = aliases.get(key);
		if (ids) ids.push(String(entry.entityId));
		else aliases.set(key, [String(entry.entityId)]);
	}
	const byKey = new Map<string, string[]>();
	const add = (kind: string, ref: string, payload: string): void => {
		const key = indexKey(kind, ref);
		const list = byKey.get(key);
		if (list) list.push(payload);
		else byKey.set(key, [payload]);
	};
	// ADR-0130: the raw table is private; read the public and per-caller views.
	for (const row of readMetadataAttachmentRows(db)) {
		const bundle = asString(row.bundleId);
		if (
			!bundle ||
			asString(row.namespace) !== `${bundle}.art.image` ||
			asString(row.audience) !== "public"
		)
			continue;
		const kind = asString(row.targetKind);
		if (!isAdmittedKind(kind)) continue;
		const ref = asString(row.targetRef);
		const payload = asString(row.payloadJson);
		add(kind, ref, payload);
		if (kind === "entity") {
			for (const id of aliases.get(`${bundle}:${ref}`) ?? []) add(kind, id, payload);
		}
	}
	return { byKey, parsed: new Map() };
}

function parsedArt(index: PublicArtIndex, payload: string): EntityArt | undefined {
	if (index.parsed.has(payload)) return index.parsed.get(payload);
	const art = parseArt(payload);
	index.parsed.set(payload, art);
	return art;
}

/** Same contract as {@link readPublicSubjectArt}, against a prebuilt index. */
export function lookupPublicSubjectArt(
	index: PublicArtIndex,
	subjects: readonly PublicArtSubject[],
): EntityArt | undefined {
	const instance: EntityArt[] = [];
	const definition: EntityArt[] = [];
	for (const subject of subjects) {
		if (!isAdmittedKind(subject.kind) || subject.ref === "") continue;
		const found = index.byKey.get(indexKey(subject.kind, subject.ref));
		if (!found) continue;
		const bucket = INSTANCE_KINDS.has(subject.kind) ? instance : definition;
		for (const payload of found) {
			const art = parsedArt(index, payload);
			if (art) bucket.push(art);
		}
	}
	return pickArt(instance.length ? instance : definition);
}

/** Same contract as {@link readPublicEntityArt}, against a prebuilt index. */
export function lookupPublicEntityArt(
	index: PublicArtIndex,
	entityId: string,
	definitionId: string,
): EntityArt | undefined {
	return lookupPublicSubjectArt(index, entitySubjects(entityId, definitionId));
}

function entitySubjects(entityId: string, definitionId: string): PublicArtSubject[] {
	const subjects: PublicArtSubject[] = [{ kind: "entity", ref: entityId }];
	if (definitionId !== "") {
		subjects.push(
			{ kind: "entity_definition", ref: definitionId },
			{ kind: "item_definition", ref: definitionId },
		);
	}
	return subjects;
}

/** Caller must first authorize every subject. This helper never grants visibility.
 * Valid instance-kind attachments (`entity`, `place_node`, `place_edge`) win over
 * definition-kind fallbacks. Malformed or private annotations do not mask a
 * valid fallback. Ties sort by path/hash/license, independent of subscription order.
 * Scans `metadata_attachment` once per call; a reader resolving art for many
 * rows builds {@link buildPublicArtIndex} once and uses {@link lookupPublicSubjectArt}. */
export function readPublicSubjectArt(
	db: SnapshotDb,
	subjects: readonly PublicArtSubject[],
): EntityArt | undefined {
	if (!subjects.some((subject) => isAdmittedKind(subject.kind) && subject.ref !== "")) {
		return undefined;
	}
	return lookupPublicSubjectArt(buildPublicArtIndex(db), subjects);
}

/** Entity/item helper: authorized instance first, then definition / item_definition. */
export function readPublicEntityArt(
	db: SnapshotDb,
	entityId: string,
	definitionId: string,
): EntityArt | undefined {
	return readPublicSubjectArt(db, entitySubjects(entityId, definitionId));
}
