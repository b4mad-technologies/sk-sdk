// `sk seed`: load compiled world manifests into a running world module.
//
// A seed root is a manifest file, or a directory holding `manifest.toml`. Each
// root is flattened with its `[[include]]` fragments into one TOML document
// and sent as ONE whole-manifest apply over the websocket connection. The HTTP
// call route is not used: its body limit refuses a large ruleset manifest.
//
// THE SEAM. `SeedTarget.applyWorldManifest` is the only place that knows which
// reducer applies a whole manifest. `seedTargetFromSession` holds the one
// binding call. A bindings release that changes the apply call changes that
// function and nothing else in this file.

import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
	connect,
	enqueueAndWaitManifestApply,
	type ManifestApplyHandle,
	type ManifestApplyResult,
	subscribeManifestApplyWait,
} from "@spellkave/sdk";

import { UsageError } from "./args.ts";
import { readBundleBodies } from "./bundle.ts";

/** The apply seam: one whole manifest in, the server's verdict out. */
export interface SeedTarget {
	applyWorldManifest(toml: string, options: SeedApplyOptions): Promise<ManifestApplyResult>;
	close(): void | Promise<void>;
}

export interface SeedApplyOptions {
	/** Shown in a watchdog error so a stuck apply names its root. */
	label: string;
	/** An "already applied" refusal counts as success. */
	tolerateAlreadyApplied: boolean;
}

/** Injection point for tests: takes the already resolved connection. */
export type ConnectSeed = (resolved: {
	url: string;
	db: string;
	token?: string;
}) => Promise<SeedTarget>;

/** One root, read from disk and ready to send. */
export interface FlattenedSeedRoot {
	/** The root as the caller wrote it. */
	root: string;
	/** The resolved root manifest file. */
	manifestPath: string;
	/** Include paths as declared by the root, in order. */
	includes: string[];
	/** The exact text that is sent. */
	toml: string;
	bytes: number;
	/** SHA-256 of the sent text. The server seals its own digest after it resolves macros. */
	sha256: string;
}

function manifestPathFor(root: string): string {
	const path = resolve(root);
	let isDirectory: boolean;
	try {
		isDirectory = statSync(path).isDirectory();
	} catch {
		throw new UsageError(`sk seed: cannot read seed root ${JSON.stringify(root)}.`);
	}
	return isDirectory ? join(path, "manifest.toml") : path;
}

/**
 * Read a root and its `[[include]]` fragments into the one document the
 * server receives. The root stays verbatim and first: it carries the only
 * schema header, and nested tables in a fragment bind to the root's rows.
 */
export async function flattenSeedRoot(root: string): Promise<FlattenedSeedRoot> {
	const manifestPath = manifestPathFor(root);
	let bundle: Awaited<ReturnType<typeof readBundleBodies>>;
	try {
		bundle = await readBundleBodies(manifestPath);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new UsageError(`sk seed: cannot read seed root ${JSON.stringify(root)}: ${detail}`);
	}
	if (bundle.missing.length > 0) {
		throw new UsageError(
			`sk seed: ${JSON.stringify(root)} names include files that do not exist: ${bundle.missing.join(", ")}.`,
		);
	}
	if (bundle.fragmentErrors.length > 0) {
		const first = bundle.fragmentErrors[0] as { path: string; message: string };
		throw new UsageError(
			`sk seed: ${JSON.stringify(root)} has an include that cannot be read: ${first.path}: ${first.message}`,
		);
	}
	const toml = [bundle.rootToml, ...bundle.bodies].join("\n\n");
	return {
		root,
		manifestPath,
		includes: bundle.included,
		toml,
		bytes: Buffer.byteLength(toml, "utf8"),
		sha256: createHash("sha256").update(toml, "utf8").digest("hex"),
	};
}

/** The slice of a connected session that seeding uses. */
export interface SeedSession {
	conn: {
		reducers: { rApplyWorldManifest(args: { toml: string }): Promise<unknown> };
		db: unknown;
	};
	disconnect(): void;
}

function applyHandle(db: unknown, camel: string, snake: string): ManifestApplyHandle {
	const tables = db as Record<string, ManifestApplyHandle>;
	return tables[snake] ?? tables[camel];
}

/**
 * Build the seed target over a connected session whose cache already follows
 * the apply digest and outcome tables. The reducer only enqueues the apply;
 * the verdict is the new digest row (sealed) or the new outcome row (refused).
 */
export function seedTargetFromSession(session: SeedSession): SeedTarget {
	return {
		applyWorldManifest: (toml, options) =>
			enqueueAndWaitManifestApply({
				digestHandle: applyHandle(session.conn.db, "manifestApplyDigest", "manifest_apply_digest"),
				outcomeHandle: applyHandle(
					session.conn.db,
					"manifestApplyOutcome",
					"manifest_apply_outcome",
				),
				enqueue: async () => {
					await session.conn.reducers.rApplyWorldManifest({ toml });
				},
				label: options.label,
				tolerateAlreadyApplied: options.tolerateAlreadyApplied,
			}),
		close: () => session.disconnect(),
	};
}

// Bookkeeping only: a seed connection submits manifests and acts as no actor.
const SEED_CONNECTED_ACTOR_ID = "sk-seed";

/** Production connector: one websocket connection for the whole seed run. */
export const connectSeedTarget: ConnectSeed = async (resolved) => {
	const session = await connect(
		{
			url: resolved.url,
			db: resolved.db,
			token: resolved.token,
			connectedActorId: SEED_CONNECTED_ACTOR_ID,
			// A fresh world has no content yet. Ask for one small public table
			// instead of the full reader set.
			readerManifests: [{ requiredTables: ["mod_bundle"] }],
		},
		{ onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} },
	);
	try {
		await session.ready;
		await subscribeManifestApplyWait(session.conn.subscriptionBuilder());
	} catch (error) {
		session.disconnect();
		throw error;
	}
	return seedTargetFromSession(session);
};

export interface SeedArgs {
	roots: string[];
	dryRun: boolean;
	tolerateApplied: boolean;
}

export function parseSeedArgs(argv: string[]): SeedArgs {
	const roots: string[] = [];
	let dryRun = false;
	let tolerateApplied = false;
	for (const token of argv) {
		if (token === "--dry-run") dryRun = true;
		else if (token === "--tolerate-applied") tolerateApplied = true;
		else if (token.startsWith("--")) throw new UsageError(`sk seed: unknown flag ${token}.`);
		else roots.push(token);
	}
	if (roots.length === 0) {
		throw new UsageError(
			"sk seed: requires at least one seed root (a manifest file or a directory with manifest.toml).",
		);
	}
	return { roots, dryRun, tolerateApplied };
}

export interface SeedRootRecord {
	kind: "seed_root";
	root: string;
	includes: number;
	bytes: number;
	sha256: string;
	status: "planned" | "applied" | "already_applied" | "failed";
	/** The digest the server sealed, when it reported one. */
	digest?: string;
	detail?: string;
	code?: string;
}

export interface SeedRunResult {
	ok: boolean;
	roots: SeedRootRecord[];
}

function rootRecord(
	flat: FlattenedSeedRoot,
	status: SeedRootRecord["status"],
	extra: Partial<SeedRootRecord> = {},
): SeedRootRecord {
	return {
		kind: "seed_root",
		root: flat.root,
		includes: flat.includes.length,
		bytes: flat.bytes,
		sha256: flat.sha256,
		status,
		...extra,
	};
}

/**
 * Apply the flattened roots in the given order and stop at the first refusal:
 * a later root usually depends on the earlier one.
 */
export async function applySeedRoots(
	target: SeedTarget,
	roots: readonly FlattenedSeedRoot[],
	options: { tolerateApplied: boolean; onRoot?: (record: SeedRootRecord) => void },
): Promise<SeedRunResult> {
	const records: SeedRootRecord[] = [];
	const push = (record: SeedRootRecord): void => {
		records.push(record);
		options.onRoot?.(record);
	};
	for (const flat of roots) {
		const result = await target.applyWorldManifest(flat.toml, {
			label: `sk seed ${flat.root}`,
			tolerateAlreadyApplied: options.tolerateApplied,
		});
		if (!result.ok) {
			push(
				rootRecord(flat, "failed", {
					detail: result.detail,
					...(result.outcome?.code ? { code: result.outcome.code } : {}),
				}),
			);
			return { ok: false, roots: records };
		}
		push(
			rootRecord(flat, result.alreadyApplied === true ? "already_applied" : "applied", {
				...(result.digest === undefined ? {} : { digest: result.digest }),
			}),
		);
	}
	return { ok: true, roots: records };
}

export const SEED_USAGE =
	"sk seed <root>... [--tolerate-applied] [--dry-run]\n\n" +
	"Load compiled world manifests into a running world module. A root is a manifest file or a\n" +
	"directory containing manifest.toml. Each root is sent with its [[include]] files as one\n" +
	"whole-manifest apply over the websocket connection. Roots are applied in the order given, so\n" +
	"name dependencies first (ruleset, then shared content, then the adventure).\n\n" +
	"The world is the author connection: --profile <name>, else SPELLKAVE_URL and SPELLKAVE_DB,\n" +
	"else the current context (`sk config view` shows which). The connection's identity needs the\n" +
	"right to apply a world manifest; on a fresh local module that is the publishing identity.\n\n" +
	"  --dry-run            read and flatten every root, report size and hash, connect to nothing\n" +
	"  --tolerate-applied   a root the world has already sealed counts as success\n\n" +
	"All roots are read before the first one is sent; an unreadable root or a missing include\n" +
	"stops the run with nothing applied. The run stops at the first root the server refuses.\n" +
	"Output: one seed_root record per root, then one seed_result record.\n\n" +
	"Exit: 0 every root applied, 2 the server refused a root, 1 usage, input or connection failure.";
