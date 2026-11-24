export interface FixedWindowLimit {
	maxRequests: number;
	windowMs: number;
}

/**
 * Authenticated `/mcp` fixed-window budget per WorkOS subject (sk-pzaq.5).
 * One busy agent exhausts only its own bucket — not every other player.
 */
export const DEFAULT_SUBJECT_REQUEST_LIMIT: FixedWindowLimit = {
	maxRequests: 300,
	windowMs: 60_000,
};

/**
 * Shared pre-auth flood guard on the `/mcp` path (and other non-isolated
 * routes that share this limiter). Sized so it cannot bind before the
 * per-subject bucket for up to ~10 concurrent authenticated players:
 *
 *   10 subjects × DEFAULT_SUBJECT_REQUEST_LIMIT.maxRequests (300) = 3000
 *
 * At that floor, ten fully-utilizing subjects and the shared guard exhaust
 * together; fewer than ten subjects always hit their subject bucket first.
 * This is an anonymous-flood ceiling, not a substitute for per-subject caps.
 */
export const DEFAULT_PUBLIC_REQUEST_LIMIT: FixedWindowLimit = {
	maxRequests: 3_000,
	windowMs: 60_000,
};
/** Spectator GET /transcripts/* — separate from /mcp so poll tabs cannot 429 players. */
export const DEFAULT_TRANSCRIPT_REQUEST_LIMIT: FixedWindowLimit = {
	maxRequests: 120,
	windowMs: 60_000,
};
/** OSM API 0.6 + Overpass under /w/<slug>/api/… — own bucket so map clients cannot 429 /mcp. */
export const DEFAULT_OSM_REQUEST_LIMIT: FixedWindowLimit = {
	maxRequests: 120,
	windowMs: 60_000,
};
export const DEFAULT_AUTHORIZATION_ATTEMPT_LIMIT: FixedWindowLimit = {
	maxRequests: 10,
	windowMs: 15 * 60_000,
};
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 16;
export const DEFAULT_MAX_CONCURRENT_REQUESTS_PER_SUBJECT = 2;
/**
 * How many of a subject's own requests may WAIT for an in-flight slot before
 * the gateway refuses one (sk-0m4.88). An MCP client that issues three or four
 * `tools/call` requests in parallel is behaving normally; queueing them costs a
 * little latency, while rejecting one costs the player every sibling request in
 * the same batch (the MCP SDK closes the transport on a failed POST).
 */
export const DEFAULT_SUBJECT_QUEUE_DEPTH = 8;
/** Longest a queued request waits for a slot before it gets the 429 instead. */
export const DEFAULT_SUBJECT_QUEUE_WAIT_MS = 5_000;

export interface SubjectConcurrencyLimits {
	/** In-flight requests allowed per subject at once. */
	maxConcurrent: number;
	/** Requests allowed to wait per subject on top of the in-flight ones. */
	queueDepth: number;
	/** Longest wait before a queued request is refused. */
	maxWaitMs: number;
}

/** Held while a request occupies one of its subject's in-flight slots. */
export interface SubjectSlot {
	release(): void;
}

interface QueuedRequest {
	settled: boolean;
	grant: (slot: SubjectSlot | undefined) => void;
	timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Per-subject bounded FIFO admission gate for authenticated `/mcp` requests.
 *
 * A subject's request over the in-flight cap WAITS for a slot instead of being
 * rejected; only a full queue or an expired wait is refused, and then the
 * caller returns the ordinary 429 with `Retry-After`. Every subject has its own
 * counter and its own queue, so one player's parallelism never delays another.
 */
export class SubjectConcurrencyQueue {
	private readonly active = new Map<string, number>();
	private readonly waiting = new Map<string, QueuedRequest[]>();

	constructor(private readonly limits: SubjectConcurrencyLimits) {
		validateSubjectConcurrencyLimits(limits);
	}

	/** Subjects with at least one request in flight. */
	get activeSubjectCount(): number {
		return this.active.size;
	}

	/** Resolves with a slot, or `undefined` when the queue is full or the wait expired. */
	acquire(subject: string): Promise<SubjectSlot | undefined> {
		const active = this.active.get(subject) ?? 0;
		if (active < this.limits.maxConcurrent) {
			this.active.set(subject, active + 1);
			return Promise.resolve(this.slotFor(subject));
		}
		const queue = this.waiting.get(subject) ?? [];
		if (queue.length >= this.limits.queueDepth) return Promise.resolve(undefined);
		return new Promise<SubjectSlot | undefined>((resolve) => {
			const queued: QueuedRequest = { settled: false, grant: resolve, timer: undefined };
			queued.timer = setTimeout(() => {
				if (queued.settled) return;
				queued.settled = true;
				this.removeQueued(subject, queued);
				resolve(undefined);
			}, this.limits.maxWaitMs);
			// A pending wait must not keep the process alive on shutdown.
			queued.timer.unref?.();
			queue.push(queued);
			this.waiting.set(subject, queue);
		});
	}

	private slotFor(subject: string): SubjectSlot {
		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				this.handOver(subject);
			},
		};
	}

	/** Pass the freed slot to the subject's next waiter, or give it back. */
	private handOver(subject: string): void {
		const queue = this.waiting.get(subject);
		const next = queue?.shift();
		if (queue !== undefined && queue.length === 0) this.waiting.delete(subject);
		if (next !== undefined) {
			next.settled = true;
			if (next.timer !== undefined) clearTimeout(next.timer);
			next.grant(this.slotFor(subject));
			return;
		}
		const remaining = (this.active.get(subject) ?? 1) - 1;
		if (remaining <= 0) this.active.delete(subject);
		else this.active.set(subject, remaining);
	}

	private removeQueued(subject: string, queued: QueuedRequest): void {
		const queue = this.waiting.get(subject);
		if (queue === undefined) return;
		const index = queue.indexOf(queued);
		if (index >= 0) queue.splice(index, 1);
		if (queue.length === 0) this.waiting.delete(subject);
	}
}

export function validateSubjectConcurrencyLimits(limits: SubjectConcurrencyLimits): void {
	for (const [name, value, minimum] of [
		["maxConcurrentRequestsPerSubject", limits.maxConcurrent, 1],
		["subjectQueueDepth", limits.queueDepth, 0],
		["subjectQueueWaitMs", limits.maxWaitMs, 0],
	] as const) {
		if (!Number.isSafeInteger(value) || value < minimum) {
			throw new Error(`${name} must be an integer >= ${minimum}`);
		}
	}
}

export function validateFixedWindowLimit(name: string, limit: FixedWindowLimit): void {
	if (!Number.isSafeInteger(limit.maxRequests) || limit.maxRequests < 1) {
		throw new Error(`${name} maxRequests must be a positive integer`);
	}
	if (!Number.isSafeInteger(limit.windowMs) || limit.windowMs < 1_000) {
		throw new Error(`${name} windowMs must be at least one second`);
	}
}

export class FixedWindowRateLimiter {
	private readonly windows = new Map<string, { startedAt: number; count: number }>();

	constructor(
		private readonly limit: FixedWindowLimit,
		private readonly now: () => number = Date.now,
	) {
		validateFixedWindowLimit("rate limit", limit);
	}

	take(key: string): { allowed: boolean; retryAfterSeconds: number } {
		const current = this.now();
		const previous = this.windows.get(key);
		const window =
			previous === undefined || current - previous.startedAt >= this.limit.windowMs
				? { startedAt: current, count: 0 }
				: previous;
		window.count += 1;
		this.windows.set(key, window);
		return {
			allowed: window.count <= this.limit.maxRequests,
			retryAfterSeconds: Math.max(
				1,
				Math.ceil((window.startedAt + this.limit.windowMs - current) / 1_000),
			),
		};
	}
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
	const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
	return Response.json(
		{
			error: "rate_limited",
			// Stable shape for clients/tests; message tells agents how long to wait.
			error_description: `Too many requests. Wait ${seconds} seconds and retry.`,
		},
		{
			status: 429,
			headers: {
				"cache-control": "no-store",
				"retry-after": String(seconds),
			},
		},
	);
}

const FORWARDED_HEADERS = [
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-port",
	"x-forwarded-prefix",
	"x-forwarded-proto",
] as const;

export function normalizeForwardedHost(value: string): string | undefined {
	const normalized = value.trim().toLowerCase();
	if (normalized.includes(",") || normalized.includes("/") || normalized.includes("@")) {
		return undefined;
	}
	return normalized.endsWith(":443") ? normalized.slice(0, -4) : normalized;
}

/** Fail closed unless the only network peer is a configured, header-overwriting edge proxy. */
export function forwardedHeaderValidationResponse(
	request: Request,
	options: { trustForwardedHeaders: boolean; allowedHostnames: readonly string[] },
): Response | undefined {
	const present = FORWARDED_HEADERS.filter((name) => request.headers.has(name));
	if (present.length === 0) return undefined;
	if (!options.trustForwardedHeaders || request.headers.has("forwarded")) {
		return new Response("Invalid proxy headers.", { status: 400 });
	}
	const unsupported = ["x-forwarded-prefix"].find((name) => request.headers.has(name));
	if (unsupported !== undefined) return new Response("Invalid proxy headers.", { status: 400 });

	const proto = request.headers.get("x-forwarded-proto");
	if (proto !== null && proto.trim().toLowerCase() !== "https") {
		return new Response("Invalid proxy headers.", { status: 400 });
	}
	const port = request.headers.get("x-forwarded-port");
	if (port !== null && port.trim() !== "443") {
		return new Response("Invalid proxy headers.", { status: 400 });
	}
	const host = request.headers.get("x-forwarded-host");
	if (host !== null) {
		const normalized = normalizeForwardedHost(host);
		if (
			normalized === undefined ||
			!options.allowedHostnames.some((candidate) => candidate.toLowerCase() === normalized)
		) {
			return new Response("Invalid proxy headers.", { status: 400 });
		}
	}
	const forwardedFor = request.headers.get("x-forwarded-for");
	if (
		forwardedFor !== null &&
		(forwardedFor.trim() === "" || forwardedFor.includes(",") || /[\r\n]/.test(forwardedFor))
	) {
		return new Response("Invalid proxy headers.", { status: 400 });
	}
	return undefined;
}

export async function requestBodyTooLarge(
	request: Request,
	maxBodyBytes: number,
): Promise<boolean> {
	if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
		throw new Error("maxBodyBytes must be a positive integer");
	}
	if (request.body === null) return false;
	const declaredLength = request.headers.get("content-length");
	if (declaredLength !== null) {
		const parsedLength = Number(declaredLength);
		if (Number.isFinite(parsedLength) && parsedLength > maxBodyBytes) return true;
	}
	const reader = request.clone().body?.getReader();
	if (reader === undefined) return false;
	let received = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) return false;
		received += chunk.value.byteLength;
		if (received > maxBodyBytes) {
			void reader.cancel();
			return true;
		}
	}
}
