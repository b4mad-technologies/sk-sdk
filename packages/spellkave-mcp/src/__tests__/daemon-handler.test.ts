// A player's tool call is relayed to their session daemon, and slow, busy, refused or
// lost daemons turn into clear tool errors instead of hangs or crashes. If it breaks,
// players see raw failures or a stuck call. Runs against injected daemon frames,
// timeouts and socket loss, no live daemon.

// keep-file(K2): injected daemon frames, timeouts and socket loss

import { SessionDaemonProtocolError, SessionDaemonTransportError } from "@spellkave/session/node";
import { PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import { describe, expect, it, vi } from "vitest";

import {
	createSessionToolHandler,
	normalizeMapsBaseUrl,
	type PlayerSessionClient,
	SEAT_BUSY_HINT,
	withMapDeepLink,
} from "../daemon-handler.ts";
import { PlayerSeatBusyError } from "../session-errors.ts";

describe("authority operation parameters", () => {
	it("passes declared grant and consent fields while rejecting session overrides", async () => {
		const invoke = vi.fn<PlayerSessionClient["invoke"]>(async () => ({
			id: 1,
			ok: true,
			result: { content: [{ type: "text", text: "accepted" }] },
		}));
		const handler = createSessionToolHandler({ invoke });
		await handler("spellkave_grant_role", {
			role: "viewer",
			subject: "recipient",
			extent_kind: "bundle",
			extent: "proof",
		});
		await handler("spellkave_offer_control", { identity: "recipient" });
		expect(invoke).toHaveBeenCalledTimes(2);
		const denied = await handler("spellkave_grant_role", { role: "viewer", db: "other-world" });
		expect(denied.isError).toBe(true);
		for (const [name, args] of [
			["spellkave_scene", { role: "dm" }],
			["spellkave_grant_role", { role: { role: "dm" } }],
			["spellkave_grant_role", { role: "viewer", payload: { role: "dm" } }],
			["spellkave_offer_control", { identity: { role: "dm" } }],
		] as const) {
			const rejected = await handler(name, args);
			expect(rejected.isError).toBe(true);
		}
		expect(invoke).toHaveBeenCalledTimes(2);
	});
});

describe("PLAYER session daemon MCP handler", () => {
	it("round-trips every canonical PLAYER tool without a second roster", async () => {
		const invoke = vi.fn(async (tool: string, args: unknown) => ({
			id: 1,
			ok: true as const,
			result: {
				content: [{ type: "text" as const, text: tool }],
				details: { args },
			},
		}));
		const handler = createSessionToolHandler({ invoke });

		for (const name of PLAYER_TOOL_NAMES) {
			await expect(handler(name, { marker: name })).resolves.toEqual({
				content: [{ type: "text", text: name }],
				structuredContent: { args: { marker: name } },
			});
		}

		expect(invoke.mock.calls.map(([name]) => name)).toEqual(PLAYER_TOOL_NAMES);
	});

	it("passes correlation beside tool args without copying payloads into context", async () => {
		const calls: unknown[][] = [];
		const client: PlayerSessionClient = {
			invoke: async (...args) => {
				calls.push(args);
				return { id: 1, ok: true, result: { content: [{ type: "text", text: "ok" }] } };
			},
		};
		const observer = {
			observeToolCall: async (
				_tool: string,
				operation: (context: { correlation_id: string; world_slug: string }) => Promise<unknown>,
			) => operation({ correlation_id: "corr-daemon", world_slug: "elven-mini" }),
		};
		const secretArgs = { speech: "SECRET-CANARY" };
		await createSessionToolHandler(client, observer as never)("spellkave_scene", secretArgs);
		expect(calls[0]).toEqual([
			"spellkave_scene",
			secretArgs,
			{ correlation_id: "corr-daemon", world_slug: "elven-mini" },
		]);
		expect(JSON.stringify(calls[0]?.[2])).not.toContain("SECRET-CANARY");
	});

	it("preserves text, image, and structured details", async () => {
		const client: PlayerSessionClient = {
			invoke: async () => ({
				id: 7,
				ok: true,
				result: {
					content: [
						{ type: "text", text: "mapped" },
						{ type: "image", data: "cG5n", mimeType: "image/png" },
					],
					details: { actorId: "hero-1", moved: true },
				},
			}),
		};

		await expect(createSessionToolHandler(client)(PLAYER_TOOL_NAMES[0] ?? "", {})).resolves.toEqual(
			{
				content: [
					{ type: "text", text: "mapped" },
					{ type: "image", data: "cG5n", mimeType: "image/png" },
				],
				structuredContent: { actorId: "hero-1", moved: true },
			},
		);
	});

	it("maps daemon domain failures to compliant MCP tool errors", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => ({
				id: 3,
				ok: false,
				error: { code: "not_permitted", message: "That action is not permitted." },
			}),
		});

		await expect(handler(PLAYER_TOOL_NAMES[0] ?? "", {})).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: "That action is not permitted." }],
			structuredContent: {
				error: {
					category: "domain",
					code: "not_permitted",
					message: "That action is not permitted.",
				},
			},
		});
	});

	it.each([
		[
			new SessionDaemonTransportError("/private/session.sock", "connect failed", {
				code: "ECONNREFUSED",
			}),
			"transport",
			"ECONNREFUSED",
		],
		[new SessionDaemonProtocolError("bad frame"), "protocol", "session_protocol_error"],
		// sk-0m4.120.36: the seat queue's own refusal is a gateway condition.
		[new PlayerSeatBusyError(), "gateway", "seat_busy"],
		[new Error("secret failure"), "internal", "internal_error"],
	] as const)("redacts a thrown %s as %s", async (error, category, code) => {
		const handler = createSessionToolHandler({
			invoke: async () => {
				throw error;
			},
		});

		const result = await handler(PLAYER_TOOL_NAMES[0] ?? "", {});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ error: { category, code } });
		expect(JSON.stringify(result)).not.toContain("/private/session.sock");
		expect(JSON.stringify(result)).not.toContain("secret failure");
	});

	// sk-0m4.120.36: a full seat queue is retryable and must read as such to the
	// player — "The PLAYER tool call failed." hid it as `internal_error`.
	it("tells the player a busy seat is retryable", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => {
				throw new PlayerSeatBusyError();
			},
		});
		const result = await handler(PLAYER_TOOL_NAMES[0] ?? "", {});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toEqual({
			error: {
				category: "gateway",
				code: "seat_busy",
				message: SEAT_BUSY_HINT,
			},
		});
		expect(result.content).toEqual([{ type: "text", text: SEAT_BUSY_HINT }]);
		expect(SEAT_BUSY_HINT).toMatch(/busy/i);
		expect(SEAT_BUSY_HINT).toMatch(/retry/i);
	});

	// sk-0m4.120.36: `internal_error` stays for genuinely unknown throws, but
	// now names the constructor (never the message) so the tool_call row can
	// say WHICH unknown throw it was.
	it.each([
		[new RangeError("secret detail"), "RangeError"],
		[new Error("secret detail"), "Error"],
		[Object.assign(new Error("secret detail"), { name: "" }), "Error"],
		["a string, not an Error", "string"],
		[undefined, "undefined"],
	])("exports the constructor name of an unknown throw as error_class (%s)", async (error, expected) => {
		const handler = createSessionToolHandler({
			invoke: async () => {
				throw error;
			},
		});
		const result = await handler(PLAYER_TOOL_NAMES[0] ?? "", {});
		expect(result.structuredContent).toEqual({
			error: {
				category: "internal",
				code: "internal_error",
				message: "The PLAYER tool call failed.",
				error_class: expected,
			},
		});
		expect(JSON.stringify(result)).not.toContain("secret detail");
	});

	it("rejects malformed daemon success frames", async () => {
		const handler = createSessionToolHandler({
			invoke: async () =>
				({
					id: 5,
					ok: true,
					result: { content: [{ type: "image", data: "missing mime" }] },
				}) as never,
		});

		const result = await handler(PLAYER_TOOL_NAMES[0] ?? "", {});
		expect(result).toMatchObject({
			isError: true,
			structuredContent: { error: { category: "protocol", code: "malformed_tool_result" } },
		});
	});
});

describe("world event relay (sk-0m4.73)", () => {
	const speech = {
		kind: "speech_heard",
		inscribed_at: 12,
		trace_id: "t-9",
		trace_kind: "srd/speech_heard",
		text: "Welcome, Horst.",
		inscribed_by: "npc-aldwin",
		inscribed_by_name: "Aldwin",
		location_kind: "place_node",
		location_ref: "hall",
		observed_at_tick: 12,
	};

	it("relays piggybacked pushes as extra text blocks plus structuredContent.world_events", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => ({
				id: 1,
				ok: true,
				result: { content: [{ type: "text", text: "acted" }], details: { ok: true } },
				pushes: [speech, { not: "an event" }],
			}),
		});
		const result = await handler("spellkave_communicate", {});
		expect(result.content[0]).toEqual({ type: "text", text: "acted" });
		expect(result.content).toHaveLength(2);
		expect((result.content[1] as { text: string }).text).toContain("Welcome, Horst.");
		expect(result.structuredContent).toEqual({ ok: true, world_events: [speech] });
	});

	it("relays pushes on a domain tool_error too — a rejected act must not eat world events", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => ({
				id: 2,
				ok: false,
				error: { message: "nope", code: "rejected" },
				pushes: [speech],
			}),
		});
		const result = await handler("spellkave_communicate", {});
		expect(result.isError).toBe(true);
		expect(result.content.some((b) => (b as { text?: string }).text?.includes("Welcome"))).toBe(
			true,
		);
		expect((result.structuredContent as { world_events: unknown[] }).world_events).toEqual([
			speech,
		]);
	});

	it("leaves results byte-identical when the daemon sends no pushes", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => ({
				id: 3,
				ok: true,
				result: { content: [{ type: "text", text: "quiet" }] },
			}),
		});
		await expect(handler("spellkave_orient", {})).resolves.toEqual({
			content: [{ type: "text", text: "quiet" }],
		});
	});
});

describe("consequences relay (sk-0m4.74)", () => {
	const dealt = {
		kind: "dealt_hit",
		target_name: "Crypt Warden",
		amount: 6,
		attacker_id: "hero-1",
		observed_at_tick: 3,
	};
	const turn = {
		kind: "turn_transition",
		session_id: "5",
		from_actor: "hero-1",
		to_actor: "npc-2",
		observed_at_tick: 3,
	};

	it("relays details.consequences as extra labelled text blocks BEFORE any world_events (pushes) blocks — structuredContent already carries them via the existing details merge", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => ({
				id: 1,
				ok: true,
				result: {
					content: [{ type: "text", text: "acted" }],
					details: { ok: true, consequences: [dealt] },
				},
				pushes: [turn],
			}),
		});
		const result = await handler("spellkave_communicate", {});
		expect(result.content[0]).toEqual({ type: "text", text: "acted" });
		expect(result.content).toHaveLength(3);
		expect((result.content[1] as { text: string }).text).toBe(
			"Consequence: 🌍 You hit Crypt Warden for 6 damage.",
		);
		expect((result.content[2] as { text: string }).text).toContain("passes from hero-1 to npc-2");
		expect(result.structuredContent).toEqual({
			ok: true,
			consequences: [dealt],
			world_events: [turn],
		});
	});

	it("an empty consequences array adds no text blocks and does not disturb structuredContent", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => ({
				id: 2,
				ok: true,
				result: {
					content: [{ type: "text", text: "acted" }],
					details: { ok: true, consequences: [] },
				},
			}),
		});
		await expect(handler("spellkave_communicate", {})).resolves.toEqual({
			content: [{ type: "text", text: "acted" }],
			structuredContent: { ok: true, consequences: [] },
		});
	});

	it("no consequences field at all (host had no builder injected) leaves the result byte-identical, same as before this bead", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => ({
				id: 3,
				ok: true,
				result: {
					content: [{ type: "text", text: "acted" }],
					details: { ok: true },
				},
			}),
		});
		await expect(handler("spellkave_communicate", {})).resolves.toEqual({
			content: [{ type: "text", text: "acted" }],
			structuredContent: { ok: true },
		});
	});

	it("maps invoke timeouts on non-act tools to a plain timeout error, not world-reset (sk-0m4.94)", async () => {
		const failing = {
			invoke: vi.fn(async () => {
				throw Object.assign(new Error("session invoke timed out after 12000ms"), {
					code: "ETIMEDOUT",
					name: "SessionInvokeTimeoutError",
				});
			}),
		};
		const { SESSION_INVOKE_TIMEOUT_HINT, WORLD_RESET_OR_RESTARTING_HINT } = await import(
			"../runtime.ts"
		);
		const handler = createSessionToolHandler(failing as never);
		const result = await handler("spellkave_scene", {});
		expect(result.isError).toBe(true);
		expect(result.content?.[0]).toMatchObject({
			type: "text",
			text: SESSION_INVOKE_TIMEOUT_HINT,
		});
		expect(result.content?.[0]).not.toMatchObject({ text: WORLD_RESET_OR_RESTARTING_HINT });
		expect(result.structuredContent).toMatchObject({
			error: { code: "session_invoke_timeout" },
		});
	});

	it("does not classify a manipulation timeout as pending speech", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => {
				throw Object.assign(new Error("session invoke timed out after 12000ms"), {
					code: "ETIMEDOUT",
					name: "SessionInvokeTimeoutError",
				});
			},
		} as never);
		const result = await handler("spellkave_manipulate", {
			target_id: "entity:2",
			action_id: "test/open",
		});
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ error: { code: "session_invoke_timeout" } });
		expect(result.structuredContent).not.toHaveProperty("conversation");
	});

	it("maps communicate invoke timeouts to awaiting_response receipt (sk-0m4.100)", async () => {
		const failing = {
			invoke: vi.fn(async () => {
				throw Object.assign(new Error("session invoke timed out after 12000ms"), {
					code: "ETIMEDOUT",
					name: "SessionInvokeTimeoutError",
				});
			}),
		};
		const handler = createSessionToolHandler(failing as never);
		const result = await handler("spellkave_communicate", {
			target_id: "entity:2",
			speech_act_id: "test/speak-to",
			utterance: "Hello",
		});
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toMatchObject({
			receipt: {
				status: "dispatched",
				verb_class: "communicate",
				outcome: "unobserved",
			},
			conversation: {
				spoken_by_player: "Hello",
				response: null,
				awaiting_response: true,
			},
		});
	});

	it("still maps a dead daemon socket to the world-reset MCP error", async () => {
		const failing = {
			invoke: vi.fn(async () => {
				throw new SessionDaemonTransportError("/private/session.sock", "closed");
			}),
		};
		const { WORLD_RESET_OR_RESTARTING_HINT } = await import("../runtime.ts");
		const handler = createSessionToolHandler(failing as never);
		const result = await handler("spellkave_scene", {});
		expect(result.isError).toBe(true);
		expect(result.content?.[0]).toMatchObject({
			type: "text",
			text: WORLD_RESET_OR_RESTARTING_HINT,
		});
		expect(result.structuredContent).toMatchObject({
			error: { code: "session_unavailable" },
		});
	});
});

describe("PLAYER session daemon MCP handler — session notices (sk-uglp)", () => {
	const notice = { kind: "world_reset" as const, text: "The world was reset." };

	it("leads a successful result with the notice text and mirrors it in structuredContent", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => ({
				id: 1,
				ok: true,
				result: { content: [{ type: "text", text: "scene" }], details: { node: "inn" } },
				notices: [notice],
			}),
		});
		await expect(handler(PLAYER_TOOL_NAMES[0] ?? "", {})).resolves.toEqual({
			content: [
				{ type: "text", text: "Notice: The world was reset." },
				{ type: "text", text: "scene" },
			],
			structuredContent: { node: "inn", session_notices: [notice] },
		});
	});

	it("keeps the notice on a tool_error frame too", async () => {
		const handler = createSessionToolHandler({
			invoke: async () => ({
				id: 2,
				ok: false,
				error: { code: "not_permitted", message: "No." },
				notices: [notice],
			}),
		});
		const result = await handler(PLAYER_TOOL_NAMES[0] ?? "", {});
		expect(result.isError).toBe(true);
		expect(result.content[0]).toEqual({ type: "text", text: "Notice: The world was reset." });
		expect(result.structuredContent).toMatchObject({ session_notices: [notice] });
	});
});

describe("spellkave_map interactive deep link", () => {
	// keep(K1): pure URL normalizer
	it("normalizeMapsBaseUrl strips trailing slashes and treats blank as unset", () => {
		expect(normalizeMapsBaseUrl(undefined)).toBeUndefined();
		expect(normalizeMapsBaseUrl("")).toBeUndefined();
		expect(normalizeMapsBaseUrl("  ")).toBeUndefined();
		expect(normalizeMapsBaseUrl("https://maps.spellkave.com/")).toBe("https://maps.spellkave.com");
		expect(normalizeMapsBaseUrl("https://maps.spellkave.com///")).toBe(
			"https://maps.spellkave.com",
		);
	});

	// keep(K1): pure result decorator
	it("withMapDeepLink is a no-op for other tools, missing URL/slug, or errors", () => {
		const base = {
			content: [{ type: "text" as const, text: "map" }],
		};
		expect(
			withMapDeepLink(base, "spellkave_scene", "https://maps.spellkave.com", "elven-mini"),
		).toEqual(base);
		expect(withMapDeepLink(base, "spellkave_map", undefined, "elven-mini")).toEqual(base);
		expect(withMapDeepLink(base, "spellkave_map", "https://maps.spellkave.com", undefined)).toEqual(
			base,
		);
		expect(
			withMapDeepLink(
				{ ...base, isError: true },
				"spellkave_map",
				"https://maps.spellkave.com",
				"elven-mini",
			),
		).toEqual({ ...base, isError: true });
	});

	it("appends one Interactive map line for spellkave_map when URL + slug are known", async () => {
		const handler = createSessionToolHandler(
			{
				invoke: async () => ({
					id: 1,
					ok: true,
					result: {
						content: [{ type: "text", text: "utf8 map" }],
						details: { places: 3 },
					},
				}),
			},
			undefined,
			undefined,
			undefined,
			undefined,
			{
				mapsBaseUrl: "https://maps.spellkave.com/",
				resolveWorldSlug: () => "elven-mini",
			},
		);
		await expect(handler("spellkave_map", {})).resolves.toEqual({
			content: [
				{ type: "text", text: "utf8 map" },
				{
					type: "text",
					text: "Interactive map: https://maps.spellkave.com/w/elven-mini",
				},
			],
			structuredContent: { places: 3 },
		});
	});

	it("URL-encodes the world slug", async () => {
		const handler = createSessionToolHandler(
			{
				invoke: async () => ({
					id: 1,
					ok: true,
					result: { content: [{ type: "text", text: "map" }] },
				}),
			},
			undefined,
			undefined,
			undefined,
			undefined,
			{
				mapsBaseUrl: "https://maps.spellkave.com",
				resolveWorldSlug: () => "a/b c",
			},
		);
		const result = await handler("spellkave_map", {});
		expect(result.content.at(-1)).toEqual({
			type: "text",
			text: "Interactive map: https://maps.spellkave.com/w/a%2Fb%20c",
		});
	});

	it("does not append the link for other tools even when URL + slug are configured", async () => {
		const handler = createSessionToolHandler(
			{
				invoke: async () => ({
					id: 1,
					ok: true,
					result: { content: [{ type: "text", text: "scene" }] },
				}),
			},
			undefined,
			undefined,
			undefined,
			undefined,
			{
				mapsBaseUrl: "https://maps.spellkave.com",
				resolveWorldSlug: () => "elven-mini",
			},
		);
		await expect(handler("spellkave_scene", {})).resolves.toEqual({
			content: [{ type: "text", text: "scene" }],
		});
	});

	it("does not append the link when SPELLKAVE_MAPS_URL / mapsBaseUrl is unset", async () => {
		const handler = createSessionToolHandler(
			{
				invoke: async () => ({
					id: 1,
					ok: true,
					result: { content: [{ type: "text", text: "map" }] },
				}),
			},
			undefined,
			undefined,
			undefined,
			undefined,
			{ resolveWorldSlug: () => "elven-mini" },
		);
		await expect(handler("spellkave_map", {})).resolves.toEqual({
			content: [{ type: "text", text: "map" }],
		});
	});

	it("falls back to feedback.resolveSeat worldSlug when resolveWorldSlug is omitted", async () => {
		const handler = createSessionToolHandler(
			{
				invoke: async () => ({
					id: 1,
					ok: true,
					result: { content: [{ type: "text", text: "map" }] },
				}),
			},
			undefined,
			undefined,
			undefined,
			{ resolveSeat: () => ({ actorId: "hero", worldSlug: "from-seat" }) },
			{ mapsBaseUrl: "https://maps.spellkave.com" },
		);
		const result = await handler("spellkave_map", {});
		expect(result.content.at(-1)).toEqual({
			type: "text",
			text: "Interactive map: https://maps.spellkave.com/w/from-seat",
		});
	});
});
