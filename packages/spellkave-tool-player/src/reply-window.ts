/** A host-controlled deadline, independent of SDK transport timers. */
export interface ReplyWindowClock {
	now(): number;
	schedule(callback: () => void, delayMs: number): () => void;
}

export const realReplyWindowClock: ReplyWindowClock = {
	now: () => performance.now(),
	schedule(callback, delayMs) {
		const timer = setTimeout(callback, delayMs);
		return () => clearTimeout(timer);
	},
};

/**
 * Claim a reply already buffered, or wake on cache delivery until the deadline.
 * Registration precedes the first read so no update can fall between them.
 * A wake at/after the deadline leaves the event for the later push drain.
 * The host's reader owns event consumption; notification itself consumes none.
 */
export function waitForReply<T>(options: {
	read: () => T | undefined;
	subscribe: (notify: () => void) => () => void;
	windowMs: number;
	clock?: ReplyWindowClock;
	signal?: AbortSignal;
}): Promise<T | null> {
	const clock = options.clock ?? realReplyWindowClock;
	const duration = Math.max(0, options.windowMs);
	if (!Number.isFinite(duration)) return Promise.reject(new Error("Invalid reply window duration"));
	const deadline = clock.now() + duration;
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanups: Array<() => void> = [];
		const addCleanup = (cleanup: () => void) => {
			if (settled) cleanup();
			else cleanups.push(cleanup);
		};
		const finish = (value: T | null, error?: unknown) => {
			if (settled) return;
			settled = true;
			for (const cleanup of cleanups.splice(0)) cleanup();
			if (error !== undefined) reject(error);
			else resolve(value);
		};
		const check = () => {
			if (settled) return;
			try {
				if (clock.now() >= deadline) return finish(null);
				const reply = options.read();
				if (reply !== undefined) finish(reply);
			} catch (error) {
				finish(null, error);
			}
		};
		const abort = () => finish(null, options.signal?.reason ?? new Error("Reply wait aborted"));
		if (options.signal?.aborted) return abort();
		options.signal?.addEventListener("abort", abort, { once: true });
		addCleanup(() => options.signal?.removeEventListener("abort", abort));
		try {
			addCleanup(options.subscribe(check));
			check();
			if (!settled)
				addCleanup(clock.schedule(() => finish(null), Math.max(0, deadline - clock.now())));
		} catch (error) {
			finish(null, error);
		}
	});
}
