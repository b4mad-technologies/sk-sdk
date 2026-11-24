import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const PLAYER_WORLD_CATALOG_VERSION = "player-world-catalog/v1";

export interface CatalogWorld {
	slug: string;
	display_name: string;
	adventure: string;
	db: string;
	status: string;
	visibility: string;
	owner: string;
	members: string[];
	join_policy: "invite" | "open";
	/** Desired runtime state. `true` means the NPC host is intentionally idle. */
	paused?: boolean;
	[key: string]: unknown;
}

export interface WorldCatalog {
	v: typeof PLAYER_WORLD_CATALOG_VERSION;
	worlds: CatalogWorld[];
	[key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(row: Record<string, unknown>, field: string, slug: string): string {
	const value = row[field];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`world catalog entry '${slug}' is missing ${field}`);
	}
	return value.trim();
}

function parseMembers(entry: Record<string, unknown>, slug: string): string[] {
	if (entry.members === undefined || entry.members === null) {
		return [];
	}
	if (!Array.isArray(entry.members)) {
		throw new Error(`world catalog entry '${slug}' members must be an array of strings`);
	}
	return entry.members.map((member, index) => {
		if (typeof member !== "string" || member.trim() === "") {
			throw new Error(
				`world catalog entry '${slug}' member at index ${index} must be a non-empty string`,
			);
		}
		return member.trim();
	});
}

function parseJoinPolicy(entry: Record<string, unknown>, slug: string): "invite" | "open" {
	if (entry.join_policy === undefined || entry.join_policy === null || entry.join_policy === "") {
		return "invite";
	}
	if (entry.join_policy === "invite" || entry.join_policy === "open") {
		return entry.join_policy;
	}
	throw new Error(
		`world catalog entry '${slug}' has invalid join_policy '${String(entry.join_policy)}'`,
	);
}

function parsePaused(entry: Record<string, unknown>, slug: string): boolean {
	if (entry.paused === undefined || entry.paused === null) return false;
	if (typeof entry.paused === "boolean") return entry.paused;
	throw new Error(`world catalog entry '${slug}' paused must be a boolean`);
}

export function parseWorldCatalog(raw: unknown): WorldCatalog {
	if (!isRecord(raw) || raw.v !== PLAYER_WORLD_CATALOG_VERSION || !Array.isArray(raw.worlds)) {
		throw new Error(`world catalog is not ${PLAYER_WORLD_CATALOG_VERSION}`);
	}
	const worlds: CatalogWorld[] = raw.worlds.map((entry, index) => {
		if (!isRecord(entry)) throw new Error(`world catalog entry ${index} is not an object`);
		const slug = requiredString(entry, "slug", String(index));
		return {
			...entry,
			slug,
			display_name: requiredString(entry, "display_name", slug),
			adventure: requiredString(entry, "adventure", slug),
			db: requiredString(entry, "db", slug),
			status: requiredString(entry, "status", slug),
			visibility: requiredString(entry, "visibility", slug),
			owner: requiredString(entry, "owner", slug),
			members: parseMembers(entry, slug),
			join_policy: parseJoinPolicy(entry, slug),
			paused: parsePaused(entry, slug),
		};
	});
	return { ...raw, v: PLAYER_WORLD_CATALOG_VERSION, worlds };
}

export function loadWorldCatalog(path: string): WorldCatalog {
	return parseWorldCatalog(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

export function saveWorldCatalog(path: string, catalog: WorldCatalog): void {
	const dir = dirname(path);
	const randomSuffix = randomBytes(6).toString("hex");
	const tmpPath = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.${randomSuffix}.tmp`);
	const content = `${JSON.stringify(catalog, null, 2)}\n`;
	try {
		writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
		chmodSync(tmpPath, 0o600);
		renameSync(tmpPath, path);
	} catch (error) {
		try {
			unlinkSync(tmpPath);
		} catch {
			// ignore cleanup error
		}
		throw error;
	}
}

export function runningWorlds(catalog: WorldCatalog): CatalogWorld[] {
	return catalog.worlds.filter((world) => world.status === "running");
}

/**
 * Worlds a seat probe should try for this subject: every running world (a
 * probe there is cheap insurance regardless of membership, sk-jay0.6.15.16.9)
 * plus every world this subject owns or is a member of, whatever its catalog
 * status. Claiming a seat writes membership (service.ts `syncMembers` /
 * `world.members.push`), so a seat in a "scheduling" world — a load that
 * succeeded but whose npc-host is still scaling up, ADR-0128 — stays
 * reachable (sk-jay0.1.1.13) without probing every stopped/failed world in
 * the catalog. A world whose probe fails (unreachable DB, mid-reset) is
 * skipped by the caller; it never breaks routing for the others.
 */
export function worldsToProbeForSeat(catalog: WorldCatalog, sub: string): CatalogWorld[] {
	const running = runningWorlds(catalog);
	const alreadyIncluded = new Set(running.map((world) => world.slug));
	const membershipWorlds = catalog.worlds.filter(
		(world) =>
			!alreadyIncluded.has(world.slug) && (world.owner === sub || world.members.includes(sub)),
	);
	return [...running, ...membershipWorlds];
}

export function canClaimSeat(world: CatalogWorld, sub: string): boolean {
	if (world.join_policy === "open") return true;
	if (world.owner === sub) return true;
	return world.members.includes(sub);
}
