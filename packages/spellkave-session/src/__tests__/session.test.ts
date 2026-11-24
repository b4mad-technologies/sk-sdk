// T25: `LiveSession.onUpdate` — an additive, post-construction listener
// registry over the same cache-mutation signal `openSession`'s constructor
// `deps.onUpdate` callback already receives. `@spellkave/sdk`'s `connect` is
// mocked (same house pattern as `@spellkave/npc`'s `connection.test.ts`) so
// this stays offline — no live node, no network `fetchServerSurface` call.

import { asEntityId } from "@spellkave/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

let capturedOnUpdate: ((table?: string) => void) | undefined;
let capturedConnectArgs: Record<string, unknown> | undefined;
let capturedSession:
	| {
			ready: Promise<void>;
			conn: object;
			disconnect: ReturnType<typeof vi.fn>;
			replaceReaderManifests: ReturnType<typeof vi.fn>;
	  }
	| undefined;

const fakeActorClient = { subscribeAffordanceCache: vi.fn(async () => {}) };
const resolvedHero = { body_entity_id: asEntityId("hero-1"), current_node_id: "start" };
const MISSING_ACTOR_ERROR = "actor 'hero-1' not found in live actor_spatial_location — fail closed";

vi.mock("@spellkave/sdk", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@spellkave/sdk")>();
	return {
		...actual,
		connect: vi.fn(
			async (args: Record<string, unknown>, callbacks: { onUpdate: (table?: string) => void }) => {
				capturedConnectArgs = args;
				capturedOnUpdate = callbacks.onUpdate;
				capturedSession = {
					ready: Promise.resolve(),
					conn: {},
					disconnect: vi.fn(),
					replaceReaderManifests: vi.fn(async () => {}),
				};
				return capturedSession;
			},
		),
		resolveActor: vi.fn(() => resolvedHero),
		createActorClient: vi.fn(() => fakeActorClient),
		snapshot: vi.fn(() => ({
			actors: {},
			controlledActors: { locations: () => [] },
			movement: {},
		})),
		snapshotDb: vi.fn(() => ({})),
		readManipulationContext: vi.fn(() => ({ status: "ready" })),
	};
});

import { connect, readManipulationContext, resolveActor } from "@spellkave/sdk";
import type { SessionBinding } from "../binding.ts";
import { OpenSessionTimeoutError, openSession, SessionClosedError } from "../session.ts";

function restoreResolveActor(): void {
	vi.mocked(resolveActor).mockImplementation(() => resolvedHero);
}

function restoreFactualContext(): void {
	vi.mocked(readManipulationContext).mockReset();
	vi.mocked(readManipulationContext).mockReturnValue({
		status: "ready",
		schema_version: 1,
		revision: 1,
		actions: [],
		targets: [],
		participants: [],
		prompts: [],
	});
}

const binding: SessionBinding = {
	url: "http://127.0.0.1:3000",
	db: "spellkave-dev",
	identity: "tok-abc",
	actorId: "hero-1",
};

describe("openSession — LiveSession.onUpdate (T25)", () => {
	beforeEach(() => {
		capturedOnUpdate = undefined;
		capturedConnectArgs = undefined;
		capturedSession = undefined;
		vi.clearAllMocks();
		restoreResolveActor();
		restoreFactualContext();
	});

	it("a listener registered after open() receives updates", async () => {
		const live = await openSession(binding, {});
		const received: number[] = [];
		live.onUpdate(() => received.push(1));

		capturedOnUpdate?.();

		expect(received).toEqual([1]);
	});

	it("the constructor-supplied onUpdate callback still fires alongside registered listeners", async () => {
		const constructorCalls: number[] = [];
		const live = await openSession(binding, { onUpdate: () => constructorCalls.push(1) });
		const listenerCalls: number[] = [];
		live.onUpdate(() => listenerCalls.push(1));

		capturedOnUpdate?.();
		capturedOnUpdate?.();

		expect(constructorCalls).toEqual([1, 1]);
		expect(listenerCalls).toEqual([1, 1]);
	});

	it("multiple registered listeners all fire, independently unsubscribable", async () => {
		const live = await openSession(binding, {});
		const a: number[] = [];
		const b: number[] = [];
		const unsubscribeA = live.onUpdate(() => a.push(1));
		live.onUpdate(() => b.push(1));

		capturedOnUpdate?.();
		unsubscribeA();
		capturedOnUpdate?.();

		expect(a).toEqual([1]);
		expect(b).toEqual([1, 1]);
	});

	it("forwards the moved table name to constructor and registered listeners", async () => {
		const constructorTables: Array<string | undefined> = [];
		const live = await openSession(binding, {
			onUpdate: (table) => constructorTables.push(table),
		});
		const listenerTables: Array<string | undefined> = [];
		live.onUpdate((table) => listenerTables.push(table));

		capturedOnUpdate?.("world_time");
		capturedOnUpdate?.("__applied");

		expect(constructorTables).toEqual(["world_time", "__applied"]);
		expect(listenerTables).toEqual(["world_time", "__applied"]);
	});
});

// sk-dms.34: monotonic cache revision, incremented on the same fan-out
// `onUpdate` listeners already observe. Starts at 0 (no mutations yet).
describe("openSession — LiveSession.revision (sk-dms.34)", () => {
	beforeEach(() => {
		capturedOnUpdate = undefined;
		capturedConnectArgs = undefined;
		capturedSession = undefined;
		vi.clearAllMocks();
		restoreResolveActor();
		restoreFactualContext();
	});

	it("starts at 0 and increments once per cache-mutation fan-out", async () => {
		const live = await openSession(binding, {});
		expect(live.revision()).toBe(0);

		capturedOnUpdate?.();
		expect(live.revision()).toBe(1);
		capturedOnUpdate?.();
		expect(live.revision()).toBe(2);
	});
});

// sk-dms.1: OpenSessionDeps.readerManifests forwarded to connect() verbatim —
// retires srd-cc backlog #BL-9's underlying structural gap ("OpenSessionDeps
// itself carries no readerManifests field to receive it into").
describe("openSession — readerManifests forwarding (sk-dms.1)", () => {
	beforeEach(() => {
		capturedOnUpdate = undefined;
		capturedConnectArgs = undefined;
		capturedSession = undefined;
		vi.clearAllMocks();
		restoreResolveActor();
		restoreFactualContext();
	});

	it("forwards deps.readerManifests to connect()'s own args", async () => {
		const readerManifests = [{ requiredTables: ["config"] }] as const;

		await openSession(binding, { readerManifests });

		expect(capturedConnectArgs).toMatchObject({ readerManifests });
	});

	it("omits readerManifests from connect()'s args when none is supplied", async () => {
		await openSession(binding, {});

		expect(capturedConnectArgs).not.toHaveProperty("readerManifests");
	});

	it("forwards an in-place reader replacement to the owning SDK session", async () => {
		const live = await openSession(binding, {});
		const manifests = [{ requiredTables: ["visible_trace"] }] as const;

		await live.replaceReaderManifests(manifests);

		expect(capturedSession?.replaceReaderManifests).toHaveBeenCalledWith(manifests);
	});
});

// ADR-0103 D-3 / sk-dms.46 slice 2: setup hook + bounded resolveActor wait.
describe("openSession — setup + bounded resolveActor wait (ADR-0103 D-3)", () => {
	beforeEach(() => {
		capturedOnUpdate = undefined;
		capturedConnectArgs = undefined;
		capturedSession = undefined;
		vi.clearAllMocks();
		restoreResolveActor();
		restoreFactualContext();
	});

	it("row present at ready resolves with zero waits and does not require setup", async () => {
		const live = await openSession(binding, {});

		expect(vi.mocked(resolveActor)).toHaveBeenCalledTimes(1);
		expect(live.actorId).toBe("hero-1");
		expect(capturedSession?.disconnect).not.toHaveBeenCalled();
	});

	it("setup runs before resolution on the same connection; throw closes and rethrows", async () => {
		const order: string[] = [];
		vi.mocked(resolveActor).mockImplementation(() => {
			order.push("resolve");
			return resolvedHero;
		});
		const setup = vi.fn(async (session) => {
			order.push("setup");
			expect(session).toBe(capturedSession);
			throw new Error("claim failed");
		});

		await expect(openSession(binding, { setup })).rejects.toThrow("claim failed");

		expect(setup).toHaveBeenCalledTimes(1);
		expect(setup.mock.calls[0]?.[0]).toBe(capturedSession);
		expect(order).toEqual(["setup"]);
		expect(vi.mocked(resolveActor)).not.toHaveBeenCalled();
		expect(capturedSession?.disconnect).toHaveBeenCalledTimes(1);
	});

	it("row absent at ready arrives on a later onUpdate and then resolves", async () => {
		let present = false;
		vi.mocked(resolveActor).mockImplementation(() => {
			if (!present) throw new Error(MISSING_ACTOR_ERROR);
			return resolvedHero;
		});

		const opened = openSession(binding, { resolveTimeoutMs: 1_000 });
		await vi.waitFor(() => {
			expect(vi.mocked(resolveActor).mock.calls.length).toBeGreaterThanOrEqual(2);
		});
		present = true;
		capturedOnUpdate?.();

		const live = await opened;
		expect(live.actorId).toBe("hero-1");
		expect(capturedSession?.disconnect).not.toHaveBeenCalled();
	});

	it("row never arrives throws at resolveTimeoutMs with the unchanged error text", async () => {
		vi.mocked(resolveActor).mockImplementation(() => {
			throw new Error(MISSING_ACTOR_ERROR);
		});

		await expect(openSession(binding, { resolveTimeoutMs: 30 })).rejects.toThrow(
			MISSING_ACTOR_ERROR,
		);

		expect(capturedSession?.disconnect).toHaveBeenCalledTimes(1);
	});

	it("setup timeout closes the connection and throws naming the hook", async () => {
		const setup = vi.fn(() => new Promise<void>(() => {}));

		await expect(openSession(binding, { setup, setupTimeoutMs: 30 })).rejects.toThrow(
			"OpenSessionDeps.setup timed out after 30ms",
		);

		expect(setup).toHaveBeenCalledTimes(1);
		expect(vi.mocked(resolveActor)).not.toHaveBeenCalled();
		expect(capturedSession?.disconnect).toHaveBeenCalledTimes(1);
	});
});

// sk-jay0.6.38.25: give `session.ready` and `subscribeAffordanceCache` an
// OPTIONAL bound (the #3464/sk-jay0.1.1.11 stall investigation's leading
// suspect), and every phase a machine-readable `.phase` plus an `onPhase`
// progress hook. #3477 RUM-lane review made the bound opt-in: `readyTimeoutMs`/
// `affordanceCacheTimeoutMs` default to `undefined` (unbounded, the behavior
// every caller had before sk-jay0.6.38.25) unless a caller passes an explicit
// value — Play is the only caller that does (`PLAY_CONNECT_PHASE_TIMEOUT_MS`).
describe("openSession — ready/affordance-cache timeouts and onPhase (sk-jay0.6.38.25)", () => {
	beforeEach(() => {
		capturedOnUpdate = undefined;
		capturedConnectArgs = undefined;
		capturedSession = undefined;
		vi.clearAllMocks();
		restoreResolveActor();
		restoreFactualContext();
	});

	it("a session.ready that never resolves times out with phase 'ready'", async () => {
		vi.mocked(connect).mockImplementationOnce(async (args, callbacks) => {
			capturedConnectArgs = args as unknown as Record<string, unknown>;
			capturedOnUpdate = callbacks.onUpdate;
			capturedSession = {
				ready: new Promise<void>(() => {}),
				conn: {},
				disconnect: vi.fn(),
				replaceReaderManifests: vi.fn(async () => {}),
			};
			return capturedSession as unknown as Awaited<ReturnType<typeof connect>>;
		});

		const failure = openSession(binding, { readyTimeoutMs: 30 });
		await expect(failure).rejects.toThrow("session.ready timed out after 30ms");
		await expect(failure).rejects.toBeInstanceOf(OpenSessionTimeoutError);
		await expect(failure).rejects.toMatchObject({ phase: "ready", timeoutMs: 30 });
		expect(capturedSession?.disconnect).toHaveBeenCalledTimes(1);
	});

	it("a factual context that never arrives times out with phase 'factual_context'", async () => {
		vi.mocked(readManipulationContext).mockReturnValue({ status: "unavailable" });

		const failure = openSession(binding, { factualContextTimeoutMs: 30 });
		await expect(failure).rejects.toThrow("factual context timed out after 30ms");
		await expect(failure).rejects.toBeInstanceOf(OpenSessionTimeoutError);
		await expect(failure).rejects.toMatchObject({ phase: "factual_context", timeoutMs: 30 });
		expect(capturedSession?.disconnect).toHaveBeenCalledTimes(1);
	});

	it("the setup timeout error still carries phase 'setup'", async () => {
		const setup = vi.fn(() => new Promise<void>(() => {}));

		await expect(openSession(binding, { setup, setupTimeoutMs: 30 })).rejects.toMatchObject({
			phase: "setup",
		});
	});

	it("a resolveActor deadline failure carries phase 'resolve_actor' with its unchanged message", async () => {
		vi.mocked(resolveActor).mockImplementation(() => {
			throw new Error(MISSING_ACTOR_ERROR);
		});

		const failure = openSession(binding, { resolveTimeoutMs: 30 });
		await expect(failure).rejects.toThrow(MISSING_ACTOR_ERROR);
		await expect(failure).rejects.toMatchObject({ phase: "resolve_actor" });
	});

	it("onPhase fires once per completed phase, in order, with a non-negative elapsed ms", async () => {
		const phases: Array<{ phase: string; elapsedMs: number }> = [];
		const setup = vi.fn(async () => {});

		await openSession(binding, {
			setup,
			onPhase: (phase, elapsedMs) => phases.push({ phase, elapsedMs }),
		});

		expect(phases.map((p) => p.phase)).toEqual([
			"ready",
			"setup",
			"resolve_actor",
			"factual_context",
		]);
		for (const p of phases) expect(p.elapsedMs).toBeGreaterThanOrEqual(0);
	});

	it("onPhase is not called for a phase that failed", async () => {
		vi.mocked(readManipulationContext).mockReturnValue({ status: "unavailable" });
		const phases: string[] = [];

		await expect(
			openSession(binding, {
				factualContextTimeoutMs: 30,
				onPhase: (phase) => phases.push(phase),
			}),
		).rejects.toThrow();

		expect(phases).toEqual(["ready", "resolve_actor"]);
	});

	// #3477 RUM-lane review: compatibility — a caller that does not pass
	// `readyTimeoutMs`/`affordanceCacheTimeoutMs` gets the pre-sk-jay0.6.38.25
	// behavior back (unbounded), not the 30s default this bead originally
	// applied to every caller.
	it("session.ready has no timeout by default — an attempt well past the old 30s default still succeeds", async () => {
		vi.useFakeTimers();
		try {
			let resolveReady!: () => void;
			vi.mocked(connect).mockImplementationOnce(async (args, callbacks) => {
				capturedConnectArgs = args as unknown as Record<string, unknown>;
				capturedOnUpdate = callbacks.onUpdate;
				capturedSession = {
					ready: new Promise<void>((resolve) => {
						resolveReady = resolve;
					}),
					conn: {},
					disconnect: vi.fn(),
					replaceReaderManifests: vi.fn(async () => {}),
				};
				return capturedSession as unknown as Awaited<ReturnType<typeof connect>>;
			});

			const opened = openSession(binding, {});
			await vi.advanceTimersByTimeAsync(120_000);
			resolveReady();
			const live = await opened;

			expect(live.actorId).toBe("hero-1");
		} finally {
			vi.useRealTimers();
		}
	});

	it("factual context has no timeout by default — an update well past the old 30s default still succeeds", async () => {
		vi.useFakeTimers();
		try {
			let ready = false;
			vi.mocked(readManipulationContext).mockImplementation(() =>
				ready
					? {
							status: "ready",
							schema_version: 1,
							revision: 1,
							actions: [],
							targets: [],
							participants: [],
							prompts: [],
						}
					: { status: "unavailable" },
			);

			const opened = openSession(binding, {});
			await vi.advanceTimersByTimeAsync(120_000);
			ready = true;
			capturedOnUpdate?.("visible_manipulation_context");
			const live = await opened;

			expect(live.actorId).toBe("hero-1");
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("openSession — in-flight calls on closed session (sk-jay0.6.15.56.16.12.3)", () => {
	it("rejects in-flight actorClient calls when the session is closed", async () => {
		let callSettled = false;
		(fakeActorClient as Record<string, unknown>).move = vi.fn(
			() =>
				new Promise<void>(() => {
					// hangs while in flight
				}),
		);
		const live = await openSession(binding, {});
		const inFlight = (live.actorClient as unknown as { move: (id: string) => Promise<void> })
			.move("edge-1")
			.finally(() => {
				callSettled = true;
			});

		live.close();

		await expect(inFlight).rejects.toThrow(SessionClosedError);
		expect(callSettled).toBe(true);

		// Calls attempted after close also reject immediately
		await expect(
			(live.actorClient as unknown as { move: (id: string) => Promise<void> }).move("edge-2"),
		).rejects.toThrow(SessionClosedError);
	});
});
