import {
	type ActorClient,
	checkedProfileFile,
	type PersonaProfile,
	type ReducerAttemptTelemetry,
	type SpellkaveSession,
} from "@spellkave/sdk";
import {
	loadProfileFromDisk,
	readLastUsedProfile,
	resolveCliPaths,
	resolveConnection,
	resolveCredential,
	resolveSpacetimeLoginToken,
	writeLastUsedProfile,
} from "@spellkave/sdk/node";
import { type Static, Type } from "typebox";
import { openSession, type SessionBinding } from "../index.ts";
import { sha256HexNode } from "./paths.ts";

const BUILT_IN_URL = "http://127.0.0.1:3000";
const BUILT_IN_DB = "spellkave-dev";
const CONFIG_ERROR = "Connection configuration or credential reference could not be resolved.";
const CONNECT_ERROR = "Spellkave connection failed before activation.";
export const NO_VALID_PROFILE_RECOVERY =
	"No valid player profile. Pass `profile` (or url, db, and actor) to spellkave_connect, or run `just play-stage <adventure>` so a seat is staged. Clear a stale last-used pointer with `spellkave profile forget-last-used`.";

function deadActorRecovery(actor: string, db: string, profile?: string): string {
	const from = profile === undefined ? "" : ` (profile '${profile}')`;
	return (
		`Actor '${actor}' is not in database '${db}'${from}. That pointer is from a previous adventure. ` +
		"Pass a current `profile` to spellkave_connect or run `just play-stage <adventure>`."
	);
}

function isMissingActorError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("not found in live actor_spatial_location");
}

/** BSATN / bindings-vs-module mismatch often surfaces as uncaughtException and kills Pi (#1260 class). */
function isSchemaMismatchError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const name = error instanceof Error ? error.name : "";
	return (
		name === "RangeError" || /byte\(s\)|BSATN|deserializ|Tried to read \d+ byte/i.test(message)
	);
}

function schemaMismatchMessage(error: unknown): string {
	const detail = error instanceof Error ? error.message : String(error);
	return (
		`Spellkave connection failed: client bindings/schema mismatch while reading the module (${detail}). ` +
		"The campaign DB was likely provisioned with an older server.wasm than this worktree. " +
		"Fix: spellkave_campaign_rebuild_reset { run_id, confirm: true } " +
		"(or just campaign-host-rebuild && just campaign-reset <new-run-id>)."
	);
}

/**
 * Route connect-time SDK throws (async onmessage / uncaughtException) onto the
 * connect promise instead of killing the Pi process. Mirrors connectTestWorld's
 * #1260 failfast, plus uncaughtException (the live crash we hit on campaign connect).
 */
async function withConnectFailfast<T>(run: () => Promise<T>): Promise<T> {
	return await new Promise<T>((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			process.off("uncaughtException", onUncaught);
			process.off("unhandledRejection", onRejection);
		};
		const fail = (reason: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (isSchemaMismatchError(reason)) {
				reject(new Error(schemaMismatchMessage(reason)));
				return;
			}
			reject(reason instanceof Error ? reason : new Error(String(reason)));
		};
		const onUncaught = (err: Error) => fail(err);
		const onRejection = (reason: unknown) => fail(reason);
		process.on("uncaughtException", onUncaught);
		process.on("unhandledRejection", onRejection);
		void run().then(
			(value) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(value);
			},
			(error) => fail(error),
		);
	});
}

const CREDENTIAL_REFERENCE = Type.Union([
	Type.Object({
		source: Type.Literal("env_var"),
		name: Type.String({ minLength: 1 }),
	}),
	Type.Object({
		source: Type.Literal("file"),
		path: Type.String({ minLength: 1 }),
	}),
	Type.Object({ source: Type.Literal("spacetime_login") }),
]);

export const CONNECT_PARAMETERS = Type.Object({
	profile: Type.Optional(Type.String({ minLength: 1 })),
	url: Type.Optional(Type.String({ minLength: 1 })),
	db: Type.Optional(Type.String({ minLength: 1 })),
	actor: Type.Optional(Type.String({ minLength: 1 })),
	credential: Type.Optional(CREDENTIAL_REFERENCE),
});

export const DISCONNECT_PARAMETERS = Type.Object({});

export type ConnectToolInput = Static<typeof CONNECT_PARAMETERS>;

export interface SessionPort {
	conn: unknown;
	ready: Promise<void>;
	/** Present on real SDK sessions; optional so controller unit fakes stay minimal. */
	estimator?: SpellkaveSession["estimator"];
	/** Present on real SDK sessions; optional so controller unit fakes stay minimal. */
	worldEvents?: SpellkaveSession["worldEvents"];
	disconnect(): void;
}

/**
 * The result of opening one connect -> resolve-actor -> actor-client ->
 * subscribe-affordance-cache sequence — `@spellkave/session`'s `openSession`
 * bundled into a single deps seam. `createSdkConnectionController` delegates
 * to `openSession` for this (#1990/#1983); tests inject a fake.
 */
export interface OpenedConnection {
	session: SessionPort;
	onUpdate?: (notify: (table?: string) => void) => () => void;
	/** The resolved actor id — same value as the requested `actor`, after direct-control validation. */
	actorId: string;
	actorClient: ActorClient;
}

export interface ConnectionControllerDeps {
	resolveSharedConnection(input: { profile?: string; url?: string; db?: string }): {
		url: string;
		db: string;
		profile?: string;
	};
	loadProfile(name: string): PersonaProfile;
	resolveCredential(
		ref:
			| { kind: "env_var"; name: string }
			| { kind: "file"; path: string }
			| { kind: "inline"; value: string },
	): string;
	resolveHostLogin(): string;
	openConnection(
		input: { url: string; db: string; actor: string; token?: string },
		callbacks: { onDisconnect(error?: Error): void },
	): Promise<OpenedConnection>;
	rememberProfile(name: string): void;
}

export interface ActiveConnection {
	session: SessionPort;
	onUpdate?: (notify: (table?: string) => void) => () => void;
	actor: string;
	actorClient: ActorClient;
	url: string;
	db: string;
	profile?: string;
}

export type ConnectionResult =
	| { ok: true; actor: string; url: string; db: string; profile?: string }
	| { ok: false; error: string };

export interface ConnectionController {
	connect(input: ConnectToolInput): Promise<ConnectionResult>;
	disconnect(): Promise<void>;
	active(): ActiveConnection | undefined;
	onDisconnected(listener: () => void): () => void;
}

interface EffectiveConnection {
	url: string;
	db: string;
	actor: string;
	token: string;
	profile?: string;
}

export function createConnectionController(deps: ConnectionControllerDeps): ConnectionController {
	let current: ActiveConnection | undefined;
	let candidate: SessionPort | undefined;
	let nextAttempt = 0;
	let pendingAttempt: number | undefined;
	const closed = new WeakSet<object>();
	const disconnectedListeners = new Set<() => void>();

	function notifyDisconnected(): void {
		for (const listener of disconnectedListeners) listener();
	}

	function close(session: SessionPort): void {
		if (closed.has(session)) return;
		closed.add(session);
		session.disconnect();
	}

	function clearOwned(session: SessionPort): void {
		const owned = candidate === session || current?.session === session;
		if (candidate === session) candidate = undefined;
		if (current?.session === session) current = undefined;
		close(session);
		if (owned) notifyDisconnected();
	}

	function resolveEffective(input: ConnectToolInput): EffectiveConnection {
		const directOnly =
			input.url !== undefined &&
			input.db !== undefined &&
			input.actor !== undefined &&
			input.profile === undefined;
		if (directOnly) {
			return {
				url: input.url!,
				db: input.db!,
				actor: input.actor!,
				token: resolveInputCredential(input, deps),
			};
		}

		const resolved = deps.resolveSharedConnection({
			...(input.profile === undefined ? {} : { profile: input.profile }),
			...(input.url === undefined ? {} : { url: input.url }),
			...(input.db === undefined ? {} : { db: input.db }),
		});
		if (resolved.profile === undefined) {
			throw new Error(NO_VALID_PROFILE_RECOVERY);
		}
		const selected = deps.loadProfile(resolved.profile);
		const actor = input.actor ?? selected.identity.in_world_self;
		const token =
			input.credential === undefined
				? selected.identity.credential === undefined
					? deps.resolveHostLogin()
					: deps.resolveCredential(selected.identity.credential)
				: resolveInputCredential(input, deps);
		return {
			url: resolved.url,
			db: resolved.db,
			actor,
			token,
			profile: resolved.profile,
		};
	}

	return {
		async connect(input) {
			if (current !== undefined || candidate !== undefined || pendingAttempt !== undefined) {
				return {
					ok: false,
					error: "Disconnect the active Spellkave session before connecting again.",
				};
			}

			const attempt = ++nextAttempt;
			pendingAttempt = attempt;
			let effective: EffectiveConnection;
			try {
				effective = resolveEffective(input);
			} catch (error) {
				if (pendingAttempt === attempt) pendingAttempt = undefined;
				const message = error instanceof Error ? error.message : String(error);
				if (message === NO_VALID_PROFILE_RECOVERY) {
					return { ok: false, error: NO_VALID_PROFILE_RECOVERY };
				}
				return { ok: false, error: CONFIG_ERROR };
			}

			let opened: OpenedConnection | undefined;
			let disconnectedBeforeOwnership = false;
			try {
				opened = await withConnectFailfast(() =>
					deps.openConnection(
						{
							url: effective.url,
							db: effective.db,
							actor: effective.actor,
							token: effective.token,
						},
						{
							onDisconnect: () => {
								if (opened === undefined) {
									disconnectedBeforeOwnership = true;
									return;
								}
								clearOwned(opened.session);
							},
						},
					),
				);
				if (pendingAttempt !== attempt) {
					close(opened.session);
					return { ok: false, error: CONNECT_ERROR };
				}
				candidate = opened.session;
				if (disconnectedBeforeOwnership) throw new Error("transport disconnected during connect");

				current = {
					session: opened.session,
					onUpdate: opened.onUpdate,
					actor: opened.actorId,
					actorClient: opened.actorClient,
					url: effective.url,
					db: effective.db,
					...(effective.profile === undefined ? {} : { profile: effective.profile }),
				};
				candidate = undefined;
				if (effective.profile !== undefined) {
					try {
						deps.rememberProfile(effective.profile);
					} catch {
						// Remembered profile is convenience state, never connection authority.
					}
				}
				return {
					ok: true,
					actor: opened.actorId,
					url: effective.url,
					db: effective.db,
					...(effective.profile === undefined ? {} : { profile: effective.profile }),
				};
			} catch (error) {
				if (opened !== undefined) clearOwned(opened.session);
				if (isMissingActorError(error)) {
					return {
						ok: false,
						error: deadActorRecovery(effective.actor, effective.db, effective.profile),
					};
				}
				return {
					ok: false,
					error: isSchemaMismatchError(error)
						? schemaMismatchMessage(error)
						: error instanceof Error && error.message.startsWith("Spellkave connection failed:")
							? error.message
							: CONNECT_ERROR,
				};
			} finally {
				if (pendingAttempt === attempt) pendingAttempt = undefined;
			}
		},

		async disconnect() {
			pendingAttempt = undefined;
			const owned = current?.session ?? candidate;
			current = undefined;
			candidate = undefined;
			if (owned !== undefined) {
				close(owned);
				notifyDisconnected();
			}
		},

		active() {
			return current;
		},

		onDisconnected(listener) {
			disconnectedListeners.add(listener);
			return () => disconnectedListeners.delete(listener);
		},
	};
}

function resolveInputCredential(input: ConnectToolInput, deps: ConnectionControllerDeps): string {
	const ref = input.credential;
	if (ref === undefined || ref.source === "spacetime_login") {
		return deps.resolveHostLogin();
	}
	if (ref.source === "env_var") {
		return deps.resolveCredential({ kind: "env_var", name: ref.name });
	}
	return deps.resolveCredential({ kind: "file", path: ref.path });
}

function lastUsedProfileIsUsable(name: string, paths: ReturnType<typeof resolveCliPaths>): boolean {
	try {
		const selected = loadProfileFromDisk(checkedProfileFile(paths, name));
		if (selected.identity.credential !== undefined) {
			resolveCredential(selected.identity.credential);
		}
		return true;
	} catch {
		return false;
	}
}

export function createSdkConnectionController(
	options: { reducerAttemptTelemetry?: ReducerAttemptTelemetry } = {},
): ConnectionController {
	const paths = resolveCliPaths();
	return createConnectionController({
		resolveSharedConnection(input) {
			let lastUsed = input.profile === undefined ? readLastUsedProfile(paths) : undefined;
			if (lastUsed !== undefined && !lastUsedProfileIsUsable(lastUsed, paths)) {
				lastUsed = undefined;
			}
			const resolved = resolveConnection(input, {
				paths,
				built_in_url: BUILT_IN_URL,
				built_in_db: BUILT_IN_DB,
				last_used_profile: lastUsed,
			});
			return {
				url: resolved.url,
				db: resolved.db,
				...(resolved.profile === undefined ? {} : { profile: resolved.profile }),
			};
		},
		loadProfile(name) {
			return loadProfileFromDisk(checkedProfileFile(paths, name));
		},
		resolveCredential,
		resolveHostLogin: resolveSpacetimeLoginToken,
		async openConnection(input, callbacks) {
			// Credential/profile resolution happened above this seam (resolveEffective,
			// deps.resolveCredential/resolveHostLogin) — `@spellkave/session`'s
			// `openSession` deliberately excludes it (see `binding.ts`'s module
			// comment) and starts from an already-resolved binding + token, exactly
			// what this deps function builds. Convention (#1992, mirrored in
			// `packages/spellkave-cli`'s `resolveLiveToken` wiring): `binding.identity`
			// is the sha256 hex of the resolved token, never the raw secret — the
			// binding is a value object any future consumer may echo, hash, or log.
			// The raw token still flows separately via `token` below.
			const binding: SessionBinding = {
				url: input.url,
				db: input.db,
				identity: input.token === undefined ? "anonymous" : sha256HexNode(input.token),
				actorId: input.actor,
			};
			const live = await openSession(binding, {
				authorityTools: true,
				token: input.token,
				onDisconnect: callbacks.onDisconnect,
				actorClientOptions: {
					// Generic PLAYER tools cannot provide a world-state predicate for
					// every authored action; the server's successful provenance is
					// authoritative — `openSession` already sets `successOnProvenance`.
					reducerAttemptTelemetry: options.reducerAttemptTelemetry,
				},
			});
			return {
				session: live.session,
				onUpdate: (notify) => live.onUpdate(notify),
				actorId: live.actorId,
				actorClient: live.actorClient,
			};
		},
		rememberProfile(name) {
			writeLastUsedProfile(paths, name);
		},
	});
}
