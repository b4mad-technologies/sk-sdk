/** Tap real reducer calls, including developer setup and refused dispatch. */
import type { TestWorld } from "./live";

/** A completed, post-action snapshot proves redaction even when it has zero rows. */
export async function acknowledgeAttributionSnapshot(world: TestWorld): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		world.conn
			.subscriptionBuilder()
			.onApplied(() => resolve())
			.onError((ctx) => reject(ctx.event))
			// ci-allow(raw-sql): explicit authorized view snapshot is the negative-observation barrier
			.subscribe(["SELECT * FROM visible_event_steering"]);
	});
}
export function recordActAsTransport(
	world: TestWorld,
	principal: string,
	calls: Record<string, unknown>[],
) {
	const reducers = world.conn.reducers as unknown as Record<string, unknown>;
	const names = new Set([
		...Object.keys(reducers),
		...Object.getOwnPropertyNames(Object.getPrototypeOf(reducers)),
	]);
	for (const name of names) {
		if (name === "constructor" || /^(on|removeOn|__)/.test(name)) continue;
		const original = reducers[name];
		if (typeof original !== "function") continue;
		reducers[name] = async (args: unknown) => {
			const started = Date.now();
			const entry: Record<string, unknown> = {
				sequence: calls.length + 1,
				principal,
				reducer: name,
				args,
			};
			calls.push(entry);
			try {
				const result = await original.call(reducers, args);
				entry.result = result ?? "committed";
				return result;
			} catch (error) {
				entry.result = String(error);
				throw error;
			} finally {
				entry.elapsedMs = Date.now() - started;
			}
		};
	}
}
