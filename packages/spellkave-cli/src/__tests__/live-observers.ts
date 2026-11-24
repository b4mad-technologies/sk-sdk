import type { TestWorld } from "@spellkave/test-lab";

/**
 * Await the write first, then fence each cache that the test will read.
 * A fresh subscription response uses the observer's ordered socket queue,
 * including on production modules that have no debug_sync_marker reducer.
 * This covers committed writes only; scheduled work still needs a fact wait.
 */
export async function settleObserver(world: TestWorld) {
	await new Promise<void>((resolve, reject) => {
		const subscription = world.conn
			.subscriptionBuilder()
			.onApplied(() => {
				subscription.unsubscribe();
				resolve();
			})
			.onError(() => reject(new Error("observer subscription fence failed")))
			.subscribe((tables) => tables.worldTime!.build());
	});
}

/** Settle observer caches on admission and refusal, preserving the call's result. */
export async function observeAfter<T>(
	call: () => Promise<T>,
	observers: readonly TestWorld[],
): Promise<T> {
	try {
		return await call();
	} finally {
		await Promise.all([...new Set(observers)].map(settleObserver));
	}
}
