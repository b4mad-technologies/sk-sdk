/** Synthetic journey accounting: issued RPCs, HTTP requests and subscriptions. */
import { Buffer } from "node:buffer";

const bytes = (value: unknown) =>
	Buffer.byteLength(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v)) ?? "");
export function startSealBreakEvidence() {
	const originalFetch = globalThis.fetch;
	const counts = {
		reducerCalls: 0,
		httpCalls: 0,
		subscriptions: 0,
		connections: 0,
		requestBytes: 0,
		responseBytes: 0,
	};
	globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
		counts.httpCalls++;
		const body = args[1]?.body;
		if (typeof body === "string") counts.requestBytes += Buffer.byteLength(body);
		const response = await originalFetch(...args);
		counts.responseBytes += Buffer.byteLength(await response.clone().text());
		return response;
	};
	const instrumentConnection = (connection: { reducers: object }) => {
		counts.connections++;
		for (const key of Object.getOwnPropertyNames(connection.reducers)) {
			const original: unknown = Reflect.get(connection.reducers, key);
			if (typeof original !== "function") continue;
			Reflect.set(connection.reducers, key, (...args: unknown[]) => {
				counts.reducerCalls++;
				counts.requestBytes += bytes(args);
				return Reflect.apply(original, connection.reducers, args);
			});
		}
	};
	return {
		instrumentConnection,
		instrumentWorld(world: {
			conn: { reducers: object };
			subscribeReaders: (...args: never[]) => Promise<void>;
		}) {
			instrumentConnection(world.conn);
			const subscribe = world.subscribeReaders;
			world.subscribeReaders = (...args: never[]) => {
				counts.subscriptions++;
				counts.requestBytes += bytes(args);
				return subscribe(...args);
			};
		},
		snapshot: () => ({
			...counts,
			calls: counts.reducerCalls + counts.httpCalls + counts.subscriptions + counts.connections,
			inferenceCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			images: 0,
			retries: 0,
			accounting:
				"Whole test, including setup; issued application requests and explicit subscriptions/connections. Bytes cover serialized reducer arguments and HTTP bodies, excluding websocket framing, pushed rows and headers. CLI subprocess argv/stdout are recorded separately. No inference or images; unaided discovery untested.",
		}),
		stop: () => {
			globalThis.fetch = originalFetch;
		},
	};
}
