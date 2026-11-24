// The one WorkOS call the gateway makes for "logout everywhere" (ADR-0161
// D-7, bead sk-jay0.5.14.5.4): `GET /user_management/users/<id>` with the API
// key, answering the user with its `metadata`. The login site writes
// `metadata.logout_after` (unix seconds) on sign-out; here a scenario sets it.
// Plain HTTP on an ephemeral 127.0.0.1 port; nothing under src/ is imported.

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeWorkosUsers {
	readonly url: string;
	readonly apiKey: string;
	/** User id -> metadata. */
	readonly metadata: Map<string, Record<string, string>>;
	/** How often the gateway asked for each user id. */
	readonly lookups: Map<string, number>;
	close(): Promise<void>;
}

export async function startFakeWorkosUsers(): Promise<FakeWorkosUsers> {
	const apiKey = `fake-workos-${randomBytes(12).toString("hex")}`;
	const metadata = new Map<string, Record<string, string>>();
	const lookups = new Map<string, number>();
	const server: Server = createServer((req, res) => {
		const match = /^\/user_management\/users\/([^/?]+)$/.exec(req.url ?? "");
		if (req.method !== "GET" || !match) {
			res.writeHead(404).end();
			return;
		}
		if (req.headers.authorization !== `Bearer ${apiKey}`) {
			res.writeHead(401, { "content-type": "application/json" });
			res.end(JSON.stringify({ message: "Unauthorized" }));
			return;
		}
		const id = decodeURIComponent(match[1] as string);
		lookups.set(id, (lookups.get(id) ?? 0) + 1);
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ object: "user", id, metadata: metadata.get(id) ?? {} }));
	});
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		apiKey,
		metadata,
		lookups,
		close() {
			server.closeAllConnections();
			return new Promise((done) => server.close(() => done()));
		},
	};
}
