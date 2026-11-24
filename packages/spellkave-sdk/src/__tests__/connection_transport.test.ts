import { STRICT_REDUCERS } from "../core/world-contract/strict-reducers.ts";
import { gzipSync } from "node:zlib";

import { afterEach, expect, it, vi } from "vitest";
import { connect, STRICT_TABLES } from "../connection";
import { servedSchema } from "./served_schema_fixture";

// Exercise the installed SpacetimeDB transport through the real shared builder.
// Back-to-back server frames need no sleeps or CPU load to expose 2.10.0's
// independent async decompression: an uncompressed delete overtakes a gzip insert.
afterEach(() => vi.unstubAllGlobals());

// keep(K2): inject adjacent compressed/uncompressed transport frames deterministically.
it("preserves WebSocket frame order at the cache boundary", async () => {
	let installedResolve!: () => void;
	const installed = new Promise<void>((resolve) => {
		installedResolve = resolve;
	});
	let socket!: ServerSocket;
	class ServerSocket {
		protocol = "v2.bsatn.spacetimedb";
		readyState = 1;
		binaryType = "arraybuffer";
		onopen?: () => void;
		onclose?: (event: { code: number; reason: string }) => void;
		onerror?: () => void;
		receive!: (event: { data: ArrayBuffer }) => void;
		readonly compression: string | null;
		constructor(url: string) {
			this.compression = new URL(url).searchParams.get("compression");
			socket = this;
		}
		set onmessage(handler: (event: { data: ArrayBuffer }) => void) {
			this.receive = handler;
			installedResolve();
		}
		send() {}
		close() {
			this.readyState = 3;
			this.onclose?.({ code: 1000, reason: "" });
		}
	}
	vi.stubGlobal("WebSocket", ServerSocket);
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: true,
			json: async () => servedSchema(STRICT_TABLES, STRICT_REDUCERS),
		}),
	);
	const session = await connect(
		{ url: "ws://localhost:3000", db: "transport-proof", token: null, connectedActorId: "0" },
		{ onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} },
	);
	// This transport probe never sends initial-subscription protocol frames.
	// Observe the lifecycle rejection when cleanup disconnects before hydration.
	session.ready.catch(() => {});
	try {
		await installed;
		// Observe at the transport/cache boundary before protocol decoding. This
		// private seam belongs to the upstream repro, not the production SDK API.
		const transport = (
			session.conn as unknown as {
				ws: { onmessage: (message: { data: Uint8Array }) => void };
			}
		).ws;
		let finishedResolve!: () => void;
		const finished = new Promise<void>((resolve) => {
			finishedResolve = resolve;
		});
		const delivered: number[] = [];
		const pending = new Set<number>();
		transport.onmessage = ({ data }) => {
			const operation = data[0];
			if (operation === undefined) throw new Error("missing transport operation");
			delivered.push(operation);
			if (operation === 1) pending.add(1);
			else pending.delete(1);
			if (delivered.length === 2) finishedResolve();
		};
		const insert = Buffer.from([1]);
		const frames = [
			socket.compression === "Gzip"
				? Buffer.concat([Buffer.from([2]), gzipSync(insert)])
				: Buffer.concat([Buffer.from([0]), insert]),
			Buffer.from([0, 2]),
		];
		for (const frame of frames) {
			const data = new Uint8Array(frame).buffer;
			socket.receive({ data });
		}
		await finished;
		expect(delivered).toEqual([1, 2]);
		expect([...pending]).toEqual([]);
	} finally {
		session.disconnect();
	}
});
