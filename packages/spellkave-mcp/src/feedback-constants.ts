/** Gateway-local spellkave_feedback constants (no internal imports — avoids init cycles). */

export const SPELLKAVE_FEEDBACK_TOOL = "spellkave_feedback" as const;

/** Player free-text cap (UTF-8 bytes). */
export const FEEDBACK_MESSAGE_MAX_BYTES = 4 * 1024;

/**
 * Optional client-diagnostic section cap (serialised UTF-8 bytes, sk-jay0.5.8).
 * Checked in `feedback.ts`'s `parseFeedbackArgs` against `JSON.stringify(args.client)`
 * — a business rule, not a JSON-Schema-expressible constraint, so it lives
 * alongside the message cap rather than inside `FEEDBACK_TOOL_INPUT_SCHEMA`.
 */
export const FEEDBACK_CLIENT_SECTION_MAX_BYTES = 32 * 1024;

/** Per-seat submissions allowed inside one rate-limit window. */
export const FEEDBACK_RATE_LIMIT_MAX = 3;

/** Sliding window for the per-seat rate limit (one hour). */
export const FEEDBACK_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export type FeedbackCategory = "bug" | "confusing" | "idea";

export const FEEDBACK_TOOL_DESCRIPTION = [
	"Submit player feedback about the live game or this connector (bug, confusing moment, or idea).",
	"ALWAYS ask the player for explicit consent before setting include_report=true (the default):",
	"the optional must-gather diagnostic bundle may include recent tool events, seat/world ids,",
	"redacted session status, and (from browser clients) a redacted client section of recent",
	"actions and layout changes — never attach any of it silently.",
	"Keep message under 4 KiB. Rate-limited to a few submissions per seat per hour.",
].join(" ");

/**
 * One `PlayTrailEntry` (apps/play/src/lib/play-trail.ts), loosely typed: every
 * field beyond `kind`/`at`/`tick` belongs to only some of the five kinds
 * (`act`/`read`/`world_pull`/`layout`/`tool_error`), and this schema does not
 * cross-validate which — the trail is diagnostic telemetry, not a strict
 * business API, and the sender (Play) already knows which fields its own
 * entry kind carries. `additionalProperties: false` still rejects anything
 * outside this known field set.
 */
const FEEDBACK_CLIENT_TRAIL_ENTRY_SCHEMA = {
	type: "object",
	properties: {
		kind: { type: "string", enum: ["act", "read", "world_pull", "layout", "tool_error"] },
		id: { type: "number" },
		at: { type: "number" },
		tick: { type: "number" },
		tool: { type: "string" },
		actionId: { type: "string" },
		targetRef: { type: "string" },
		words: { type: "string" },
		outcome: { type: "string" },
		observation: { type: "string" },
		durationMs: { type: "number" },
		counts: { type: "object", additionalProperties: { type: "number" } },
		tile: { type: "string" },
		level: { type: "string" },
		trigger: { type: "string" },
		message: { type: "string" },
	},
	required: ["kind", "at", "tick"],
	additionalProperties: false,
};

/**
 * Mirrors `apps/play/src/lib/mosaic.ts`'s `TILE_IDS` — duplicated the same
 * way `apps/play/src/lib/feedback.ts` duplicates this package's own wire
 * constants, since the two packages never import each other's internals.
 */
const FEEDBACK_CLIENT_LAYOUT_SCHEMA = {
	type: "object",
	properties: {
		table: { type: "string" },
		map: { type: "string" },
		place: { type: "string" },
		hero: { type: "string" },
		pack: { type: "string" },
		chronicle: { type: "string" },
	},
	additionalProperties: false,
};

/** A `crypto.randomUUID()` run id — also the only shape the issue renders. */
export const FEEDBACK_RUM_RUN_ID_PATTERN =
	"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/** Optional client-diagnostic section (sk-jay0.5.8): the Play app's own
 * bounded, redacted action trail, viewport, and mosaic tile levels. Attached
 * only alongside `include_report: true` — the same consent checkbox gates
 * both the must-gather bundle and this section. */
const FEEDBACK_CLIENT_SECTION_SCHEMA = {
	type: "object",
	properties: {
		trail: { type: "array", items: FEEDBACK_CLIENT_TRAIL_ENTRY_SCHEMA },
		viewport: {
			type: "object",
			properties: {
				width: { type: "number" },
				height: { type: "number" },
			},
			required: ["width", "height"],
			additionalProperties: false,
		},
		layout: FEEDBACK_CLIENT_LAYOUT_SCHEMA,
		/** Hosted Play RUM linkage (sk-jay0.6.38.24): the page's ephemeral
		 * `spellkave_run` id and whether the SDK sampled this session. */
		rum: {
			type: "object",
			properties: {
				run_id: { type: "string", pattern: FEEDBACK_RUM_RUN_ID_PATTERN },
				sampled: { type: "boolean" },
			},
			required: ["sampled"],
			additionalProperties: false,
		},
	},
	additionalProperties: false,
};

export const FEEDBACK_TOOL_INPUT_SCHEMA = {
	type: "object",
	properties: {
		message: {
			type: "string",
			minLength: 1,
			description: "Player's feedback in their own words (max 4 KiB UTF-8).",
		},
		category: {
			type: "string",
			enum: ["bug", "confusing", "idea"],
			description: "Optional coarse category for triage.",
		},
		include_report: {
			type: "boolean",
			description:
				"When true (default), attach a redacted must-gather diagnostic bundle. Ask the player before enabling.",
		},
		client: {
			...FEEDBACK_CLIENT_SECTION_SCHEMA,
			description:
				"Optional browser-client diagnostic section (recent actions, viewport, mosaic tile levels). Only meaningful alongside include_report: true; ignored otherwise.",
		},
	},
	required: ["message"],
	additionalProperties: false,
};
